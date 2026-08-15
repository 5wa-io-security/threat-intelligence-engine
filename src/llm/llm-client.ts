import { createLogger } from '../utils/logger.js';

const logger = createLogger('llm-client');

export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const GROQ_MODEL = 'llama-3.1-8b-instant';
export const OLLAMA_MODEL = 'llama3.1:8b';

const GROQ_MIN_REQUEST_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_COMPLETION_TOKENS = 300;

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
}

export interface LLMClientOptions {
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

function parseRetryAfter(value: string | null, now: () => number): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, MAX_RETRY_DELAY_MS);
  }

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.min(Math.max(0, dateMs - now()), MAX_RETRY_DELAY_MS);
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

function getCompletionContent(payload: unknown): { content: string; model?: string } {
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
  };
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export class LLMClient {
  private readonly groqApiKey: string | undefined;
  private readonly ollamaUrl: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly requestTimeoutMs: number;
  private lastGroqRequestAt: number | null = null;
  private groqDisabledForRun = false;

  constructor(options: LLMClientOptions = {}) {
    this.groqApiKey = options.groqApiKey?.trim() || process.env.GROQ_API_KEY?.trim();
    this.ollamaUrl = options.ollamaUrl?.trim() || process.env.OLLAMA_URL?.trim();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
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

    let groqError: unknown;

    if (this.groqApiKey && !this.groqDisabledForRun) {
      try {
        const completion = await this.requestWithRetries({
          provider: 'groq',
          url: `${GROQ_BASE_URL}/chat/completions`,
          model: GROQ_MODEL,
          apiKey: this.groqApiKey,
          messages,
        });
        return this.parseCompletion(completion, parseResponse);
      } catch (error) {
        groqError = error;

        if (
          error instanceof ProviderRequestError &&
          (error.status === 401 || error.status === 403)
        ) {
          this.groqDisabledForRun = true;
          logger.warn('Groq authentication failed; disabling Groq for the rest of this run');
        } else {
          logger.warn('Groq request failed; checking optional Ollama fallback', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    if (this.ollamaUrl) {
      const completion = await this.requestWithRetries({
        provider: 'ollama',
        url: buildChatCompletionsUrl(this.ollamaUrl),
        model: OLLAMA_MODEL,
        messages,
      });
      return this.parseCompletion(completion, parseResponse);
    }

    if (groqError instanceof Error) {
      throw groqError;
    }

    if (!this.groqApiKey) {
      throw new Error('No LLM provider is configured');
    }

    throw new Error('Groq is unavailable and OLLAMA_URL is not configured');
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

  private async requestWithRetries(input: {
    provider: 'groq' | 'ollama';
    url: string;
    model: string;
    apiKey?: string;
    messages: ChatMessage[];
  }): Promise<LLMCompletion<string>> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        if (input.provider === 'groq') {
          await this.throttleGroq();
        }

        return await this.sendRequest(input);
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof ProviderRequestError ? error.retryable : true;

        if (!retryable || attempt === MAX_ATTEMPTS) {
          break;
        }

        const exponentialDelay = Math.min(1_000 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
        const retryAfterMs =
          error instanceof ProviderRequestError ? error.retryAfterMs ?? 0 : 0;
        const delayMs = Math.max(exponentialDelay, retryAfterMs);

        logger.warn('Transient LLM request failure; retrying', {
          provider: input.provider,
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

    throw new Error(`${input.provider} request failed`);
  }

  private async throttleGroq(): Promise<void> {
    if (this.lastGroqRequestAt !== null) {
      const elapsed = this.now() - this.lastGroqRequestAt;
      if (elapsed < GROQ_MIN_REQUEST_INTERVAL_MS) {
        await this.sleep(GROQ_MIN_REQUEST_INTERVAL_MS - elapsed);
      }
    }

    this.lastGroqRequestAt = this.now();
  }

  private async sendRequest(input: {
    provider: 'groq' | 'ollama';
    url: string;
    model: string;
    apiKey?: string;
    messages: ChatMessage[];
  }): Promise<LLMCompletion<string>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (input.apiKey) {
        headers.Authorization = `Bearer ${input.apiKey}`;
      }

      const body: Record<string, unknown> = {
        model: input.model,
        messages: input.messages,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      };

      if (input.provider === 'groq') {
        body.max_completion_tokens = MAX_COMPLETION_TOKENS;
      } else {
        body.max_tokens = MAX_COMPLETION_TOKENS;
      }

      const response = await this.fetchImpl(input.url, {
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
          `${input.provider} returned non-JSON content`,
          input.provider,
          response.status,
          undefined,
          response.status >= 500
        );
      }

      if (!response.ok) {
        const fallback = `${input.provider} request failed with HTTP ${response.status}`;
        throw new ProviderRequestError(
          getErrorMessage(payload, fallback),
          input.provider,
          response.status,
          parseRetryAfter(response.headers.get('retry-after'), this.now),
          isRetryableStatus(response.status)
        );
      }

      let parsed: { content: string; model?: string };
      try {
        parsed = getCompletionContent(payload);
      } catch (error) {
        throw new ProviderRequestError(
          error instanceof Error ? error.message : String(error),
          input.provider,
          response.status,
          undefined,
          false
        );
      }

      return {
        content: parsed.content,
        model: parsed.model ?? input.model,
        provider: input.provider,
      };
    } catch (error) {
      if (error instanceof ProviderRequestError) {
        throw error;
      }

      const isTimeout = error instanceof Error && error.name === 'AbortError';
      throw new ProviderRequestError(
        isTimeout
          ? `${input.provider} request timed out after ${this.requestTimeoutMs} ms`
          : `${input.provider} network request failed: ${error instanceof Error ? error.message : String(error)}`,
        input.provider,
        undefined,
        undefined,
        true
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
