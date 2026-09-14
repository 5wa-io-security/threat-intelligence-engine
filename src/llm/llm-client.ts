import { createLogger } from '../utils/logger.js';
import {
  DEFAULT_GROQ_BASE_URL,
  DEFAULT_GROQ_MODEL,
  DEFAULT_OLLAMA_MODEL,
  type LLMConfig,
  getConfiguredProviders,
  loadLLMConfig,
} from './config.js';

const logger = createLogger('llm-client');

// Backward-compatible exports for callers that imported the original constants.
export const GROQ_BASE_URL = DEFAULT_GROQ_BASE_URL;
export const GROQ_MODEL = DEFAULT_GROQ_MODEL;
export const OLLAMA_MODEL = DEFAULT_OLLAMA_MODEL;

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

interface ChatCompletionResponse {
  model?: unknown;
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  usage?: Record<string, unknown>;
  total_duration?: unknown;
  load_duration?: unknown;
  prompt_eval_count?: unknown;
  eval_count?: unknown;
  prompt_eval_duration?: unknown;
  eval_duration?: unknown;
}

interface ErrorResponse {
  error?: {
    message?: unknown;
  };
}

export interface LLMCompletion<T = string> {
  content: T;
  model: string;
  provider: 'groq' | 'ollama';
  latencyMs?: number;
  usage?: LLMUsage;
}

export interface LLMProviderHealth {
  provider: 'groq' | 'ollama';
  model: string;
  reachable: boolean;
  modelAvailable: boolean | null;
  latencyMs: number | null;
  error?: string;
}

export interface LLMUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  totalDurationMs?: number;
  loadDurationMs?: number;
  promptEvalCount?: number;
  evalCount?: number;
  promptEvalDurationMs?: number;
  evalDurationMs?: number;
}

export interface LLMClientOptions {
  config?: Partial<LLMConfig>;
  groqApiKey?: string;
  ollamaUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  requestTimeoutMs?: number;
}

class ProviderRequestError extends Error {
  constructor(
    message: string,
    readonly provider: 'groq' | 'ollama',
    readonly status?: number,
    readonly retryAfterMs?: number,
    readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'ProviderRequestError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');

  if (trimmed.endsWith('/chat/completions')) {
    return trimmed;
  }

  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/chat/completions`;
  }

  return `${trimmed}/v1/chat/completions`;
}

function buildModelsUrl(baseUrl: string): string {
  const chatCompletionsUrl = buildChatCompletionsUrl(baseUrl);
  return chatCompletionsUrl.replace(/\/chat\/completions$/, '/models');
}

function extractModelIds(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];

  return payload.data.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string') return [];
    return [item.id];
  });
}

function parseRetryAfter(value: string | null, now: () => number, maxDelayMs: number): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, maxDelayMs);
  }

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.min(Math.max(0, dateMs - now()), maxDelayMs);
  }

  return undefined;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;

  const error = (payload as ErrorResponse).error;
  if (!error || typeof error.message !== 'string' || error.message.trim() === '') {
    return fallback;
  }

  return error.message;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function nanosecondsToMilliseconds(value: unknown): number | undefined {
  const number = nonNegativeNumber(value);
  return number === undefined ? undefined : Math.round(number / 1_000_000);
}

function parseUsage(payload: unknown): LLMUsage | undefined {
  if (!isRecord(payload)) return undefined;

  const response = payload as ChatCompletionResponse;
  const usage = isRecord(response.usage) ? response.usage : undefined;
  const parsed: LLMUsage = {
    promptTokens: nonNegativeNumber(usage?.prompt_tokens),
    completionTokens: nonNegativeNumber(usage?.completion_tokens),
    totalTokens: nonNegativeNumber(usage?.total_tokens),
    totalDurationMs: nanosecondsToMilliseconds(response.total_duration),
    loadDurationMs: nanosecondsToMilliseconds(response.load_duration),
    promptEvalCount: nonNegativeNumber(response.prompt_eval_count),
    evalCount: nonNegativeNumber(response.eval_count),
    promptEvalDurationMs: nanosecondsToMilliseconds(response.prompt_eval_duration),
    evalDurationMs: nanosecondsToMilliseconds(response.eval_duration),
  };

  return Object.values(parsed).some((value) => value !== undefined) ? parsed : undefined;
}

function getCompletionContent(payload: unknown): {
  content: string;
  model?: string;
  usage?: LLMUsage;
} {
  if (!isRecord(payload)) {
    throw new Error('LLM response was not a JSON object');
  }

  const response = payload as ChatCompletionResponse;
  const content = response.choices?.[0]?.message?.content;

  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('LLM response did not contain message content');
  }

  return {
    content: content.trim(),
    model: typeof response.model === 'string' ? response.model : undefined,
    usage: parseUsage(payload),
  };
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export class LLMClient {
  private readonly config: LLMConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private lastGroqRequestAt: number | null = null;
  private readonly disabledProviders = new Set<'groq' | 'ollama'>();

  constructor(options: LLMClientOptions = {}) {
    const environmentConfig = loadLLMConfig();
    const configuredOverrides = options.config ?? {};

    this.config = {
      ...environmentConfig,
      ...configuredOverrides,
      groqApiKey: optionalString(
        options.groqApiKey ?? configuredOverrides.groqApiKey ?? environmentConfig.groqApiKey
      ),
      ollamaUrl: optionalString(
        options.ollamaUrl ?? configuredOverrides.ollamaUrl ?? environmentConfig.ollamaUrl
      ),
      requestTimeoutMs: options.requestTimeoutMs ??
        configuredOverrides.requestTimeoutMs ?? environmentConfig.requestTimeoutMs,
    };
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  async checkHealth(): Promise<LLMProviderHealth[]> {
    const providers = getConfiguredProviders(this.config).filter(
      (provider) => !this.disabledProviders.has(provider)
    );

    const healthResults: LLMProviderHealth[] = [];
    for (const provider of providers) {
      healthResults.push(await this.checkProviderHealth(provider));
    }

    return healthResults;
  }

  private async checkProviderHealth(
    provider: 'groq' | 'ollama'
  ): Promise<LLMProviderHealth> {
    const isGroq = provider === 'groq';
    const model = isGroq ? this.config.groqModel : this.config.ollamaModel;
    const baseUrl = isGroq ? this.config.groqBaseUrl : this.config.ollamaUrl;
    const startedAt = this.now();

    if (!baseUrl) {
      return {
        provider,
        model,
        reachable: false,
        modelAvailable: false,
        latencyMs: null,
        error: `${provider} is not configured`,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const headers: Record<string, string> = {};
      if (isGroq && this.config.groqApiKey) {
        headers.Authorization = `Bearer ${this.config.groqApiKey}`;
      } else if (!isGroq && this.config.ollamaApiKey) {
        headers.Authorization = `Bearer ${this.config.ollamaApiKey}`;
      }

      const response = await this.fetchImpl(buildModelsUrl(baseUrl), {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      const responseText = await response.text();
      let payload: unknown = {};

      try {
        payload = responseText === '' ? {} : JSON.parse(responseText);
      } catch {
        throw new Error(`${provider} health endpoint returned non-JSON content`);
      }

      if (!response.ok) {
        throw new ProviderRequestError(
          getErrorMessage(payload, `${provider} health check failed with HTTP ${response.status}`),
          provider,
          response.status,
          undefined,
          false
        );
      }

      const modelIds = extractModelIds(payload);
      const modelAvailable = modelIds.length === 0 ? null : modelIds.includes(model);

      if (modelAvailable === false) {
        this.disabledProviders.add(provider);
      }

      return {
        provider,
        model,
        reachable: true,
        modelAvailable,
        latencyMs: Math.max(0, this.now() - startedAt),
        error: modelAvailable === false ? `Model ${model} is not available` : undefined,
      };
    } catch (error) {
      this.disabledProviders.add(provider);
      const message = error instanceof Error ? error.message : String(error);

      return {
        provider,
        model,
        reachable: false,
        modelAvailable: false,
        latencyMs: Math.max(0, this.now() - startedAt),
        error: message,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async completeJson<T = string>(
    systemPrompt: string,
    userPrompt: string,
    parseResponse?: (content: string) => T
  ): Promise<LLMCompletion<T>> {
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const configuredProviders = getConfiguredProviders(this.config);
    const providers = configuredProviders.filter(
      (provider) => !this.disabledProviders.has(provider)
    );

    if (providers.length === 0) {
      if (configuredProviders.length > 0) {
        throw new Error('All configured LLM providers are unavailable');
      }

      throw new Error(
        this.config.providerMode === 'groq'
          ? 'LLM_PROVIDER=groq requires GROQ_API_KEY'
          : this.config.providerMode === 'ollama'
            ? 'LLM_PROVIDER=ollama requires OLLAMA_URL'
            : 'No LLM provider is configured'
      );
    }

    const errors: string[] = [];

    for (const provider of providers) {
      try {
        const completion = await this.requestWithRetries(provider, messages);
        return this.parseCompletion(completion, parseResponse);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${provider}: ${message}`);

        if (
          provider === 'groq' &&
          error instanceof ProviderRequestError &&
          (error.status === 401 || error.status === 403)
        ) {
          this.disabledProviders.add('groq');
          logger.warn('Groq authentication failed; disabling Groq for the rest of this run');
        } else {
          logger.warn('LLM provider failed; checking the next configured provider', {
            provider,
            error: message,
          });
        }
      }
    }

    throw new Error(`All configured LLM providers failed: ${errors.join(' | ')}`);
  }

  private parseCompletion<T>(
    completion: LLMCompletion<string>,
    parseResponse?: (content: string) => T
  ): LLMCompletion<T> {
    return {
      ...completion,
      content: parseResponse
        ? parseResponse(completion.content)
        : (completion.content as unknown as T),
    };
  }

  private async requestWithRetries(
    provider: 'groq' | 'ollama',
    messages: ChatMessage[]
  ): Promise<LLMCompletion<string>> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      try {
        if (provider === 'groq') {
          await this.throttleGroq();
        }

        return await this.sendRequest(provider, messages);
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof ProviderRequestError ? error.retryable : true;

        if (!retryable || attempt === this.config.maxAttempts) {
          break;
        }

        const exponentialDelay = Math.min(
          1_000 * 2 ** (attempt - 1),
          this.config.maxRetryDelayMs
        );
        const retryAfterMs =
          error instanceof ProviderRequestError ? error.retryAfterMs ?? 0 : 0;
        const delayMs = Math.max(exponentialDelay, retryAfterMs);

        logger.warn('Transient LLM request failure; retrying', {
          provider,
          attempt,
          nextAttempt: attempt + 1,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.sleep(delayMs);
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }

    throw new Error(`${provider} request failed`);
  }

  private async throttleGroq(): Promise<void> {
    if (this.lastGroqRequestAt !== null) {
      const elapsed = this.now() - this.lastGroqRequestAt;
      if (elapsed < this.config.groqMinRequestIntervalMs) {
        await this.sleep(this.config.groqMinRequestIntervalMs - elapsed);
      }
    }

    this.lastGroqRequestAt = this.now();
  }

  private async sendRequest(
    provider: 'groq' | 'ollama',
    messages: ChatMessage[]
  ): Promise<LLMCompletion<string>> {
    const controller = new AbortController();
    const startedAt = this.now();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    const isGroq = provider === 'groq';
    const model = isGroq ? this.config.groqModel : this.config.ollamaModel;
    const baseUrl = isGroq ? this.config.groqBaseUrl : this.config.ollamaUrl;

    if (!baseUrl) {
      throw new ProviderRequestError(
        `${provider} is not configured`,
        provider,
        undefined,
        undefined,
        false
      );
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (isGroq && this.config.groqApiKey) {
        headers.Authorization = `Bearer ${this.config.groqApiKey}`;
      } else if (!isGroq && this.config.ollamaApiKey) {
        headers.Authorization = `Bearer ${this.config.ollamaApiKey}`;
      }

      const body: Record<string, unknown> = {
        model,
        messages,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      };

      if (isGroq) {
        body.max_completion_tokens = this.config.maxCompletionTokens;
      } else {
        body.max_tokens = this.config.maxCompletionTokens;
      }

      const response = await this.fetchImpl(buildChatCompletionsUrl(baseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const responseText = await response.text();
      let payload: unknown;

      try {
        payload = responseText === '' ? {} : JSON.parse(responseText);
      } catch {
        throw new ProviderRequestError(
          `${provider} returned non-JSON content`,
          provider,
          response.status,
          undefined,
          response.status >= 500
        );
      }

      if (!response.ok) {
        const fallback = `${provider} request failed with HTTP ${response.status}`;
        throw new ProviderRequestError(
          getErrorMessage(payload, fallback),
          provider,
          response.status,
          parseRetryAfter(
            response.headers.get('retry-after'),
            this.now,
            this.config.maxRetryDelayMs
          ),
          isRetryableStatus(response.status)
        );
      }

      let parsed: { content: string; model?: string; usage?: LLMUsage };
      try {
        parsed = getCompletionContent(payload);
      } catch (error) {
        throw new ProviderRequestError(
          error instanceof Error ? error.message : String(error),
          provider,
          response.status,
          undefined,
          false
        );
      }

      return {
        content: parsed.content,
        model: parsed.model ?? model,
        provider,
        latencyMs: Math.max(0, this.now() - startedAt),
        usage: parsed.usage,
      };
    } catch (error) {
      if (error instanceof ProviderRequestError) {
        throw error;
      }

      const isTimeout = error instanceof Error && error.name === 'AbortError';
      throw new ProviderRequestError(
        isTimeout
          ? `${provider} request timed out after ${this.config.requestTimeoutMs} ms`
          : `${provider} network request failed: ${error instanceof Error ? error.message : String(error)}`,
        provider,
        undefined,
        undefined,
        true
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
