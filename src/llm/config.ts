export type LLMProviderMode = 'auto' | 'groq' | 'ollama';

export const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-20b';
export const DEFAULT_OLLAMA_MODEL = 'llama3.1:8b';
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;
export const DEFAULT_MAX_COMPLETION_TOKENS = 300;
export const DEFAULT_GROQ_MIN_REQUEST_INTERVAL_MS = 2_000;
export const DEFAULT_LLM_MIN_CONFIDENCE = 0.65;

export interface LLMConfig {
  providerMode: LLMProviderMode;
  groqApiKey?: string;
  groqBaseUrl: string;
  groqModel: string;
  ollamaUrl?: string;
  ollamaApiKey?: string;
  ollamaModel: string;
  requestTimeoutMs: number;
  maxAttempts: number;
  maxRetryDelayMs: number;
  maxCompletionTokens: number;
  groqMinRequestIntervalMs: number;
  minConfidence: number;
}

function readString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value || undefined;
}

function readPositiveInteger(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const raw = readString(env, key);
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return fallback;
  }

  return parsed;
}

function readFraction(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const raw = readString(env, key);
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return fallback;
  }

  return parsed;
}

function readProviderMode(env: NodeJS.ProcessEnv): LLMProviderMode {
  const value = readString(env, 'LLM_PROVIDER')?.toLowerCase();

  if (value === 'groq' || value === 'ollama' || value === 'auto') {
    return value;
  }

  return 'auto';
}

export function loadLLMConfig(env: NodeJS.ProcessEnv = process.env): LLMConfig {
  return {
    providerMode: readProviderMode(env),
    groqApiKey: readString(env, 'GROQ_API_KEY'),
    groqBaseUrl: readString(env, 'GROQ_BASE_URL') ?? DEFAULT_GROQ_BASE_URL,
    groqModel: readString(env, 'GROQ_MODEL') ?? DEFAULT_GROQ_MODEL,
    ollamaUrl: readString(env, 'OLLAMA_URL'),
    ollamaApiKey: readString(env, 'OLLAMA_API_KEY'),
    ollamaModel: readString(env, 'OLLAMA_MODEL') ?? DEFAULT_OLLAMA_MODEL,
    requestTimeoutMs: readPositiveInteger(
      env,
      'LLM_REQUEST_TIMEOUT_MS',
      DEFAULT_REQUEST_TIMEOUT_MS,
      1_000,
      120_000
    ),
    maxAttempts: readPositiveInteger(env, 'LLM_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS, 1, 5),
    maxRetryDelayMs: readPositiveInteger(
      env,
      'LLM_MAX_RETRY_DELAY_MS',
      DEFAULT_MAX_RETRY_DELAY_MS,
      0,
      120_000
    ),
    maxCompletionTokens: readPositiveInteger(
      env,
      'LLM_MAX_COMPLETION_TOKENS',
      DEFAULT_MAX_COMPLETION_TOKENS,
      32,
      2_000
    ),
    groqMinRequestIntervalMs: readPositiveInteger(
      env,
      'GROQ_MIN_REQUEST_INTERVAL_MS',
      DEFAULT_GROQ_MIN_REQUEST_INTERVAL_MS,
      0,
      60_000
    ),
    minConfidence: readFraction(env, 'LLM_MIN_CONFIDENCE', DEFAULT_LLM_MIN_CONFIDENCE),
  };
}

export function getConfiguredProviders(config: LLMConfig): Array<'groq' | 'ollama'> {
  if (config.providerMode === 'groq') {
    return config.groqApiKey && isHttpUrl(config.groqBaseUrl) ? ['groq'] : [];
  }

  if (config.providerMode === 'ollama') {
    return config.ollamaUrl && isHttpUrl(config.ollamaUrl) ? ['ollama'] : [];
  }

  const providers: Array<'groq' | 'ollama'> = [];
  if (config.groqApiKey && isHttpUrl(config.groqBaseUrl)) providers.push('groq');
  if (config.ollamaUrl && isHttpUrl(config.ollamaUrl)) providers.push('ollama');
  return providers;
}

function isHttpUrl(value: string | undefined): boolean {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getLLMConfigWarnings(config: LLMConfig = loadLLMConfig()): string[] {
  const warnings: string[] = [];

  if (config.groqApiKey && !isHttpUrl(config.groqBaseUrl)) {
    warnings.push('GROQ_BASE_URL must be an http:// or https:// URL; Groq will be skipped.');
  }

  if (config.ollamaUrl && !isHttpUrl(config.ollamaUrl)) {
    warnings.push('OLLAMA_URL must be an http:// or https:// URL; Ollama will be skipped.');
  }

  if (config.ollamaUrl?.startsWith('http://')) {
    warnings.push(
      'OLLAMA_URL uses unencrypted HTTP; keep it on localhost/private VPN or put it behind HTTPS and authentication.'
    );
  }

  return warnings;
}

export function isLLMConfigured(config: LLMConfig = loadLLMConfig()): boolean {
  return getConfiguredProviders(config).length > 0;
}
