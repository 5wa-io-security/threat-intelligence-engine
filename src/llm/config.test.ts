import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LLM_MIN_CONFIDENCE,
  DEFAULT_GROQ_MODEL,
  DEFAULT_OLLAMA_MODEL,
  getConfiguredProviders,
  isLLMConfigured,
  loadLLMConfig,
} from './config.js';

test('loadLLMConfig uses the current Groq model and safe defaults', () => {
  const config = loadLLMConfig({});

  assert.equal(config.groqModel, DEFAULT_GROQ_MODEL);
  assert.equal(config.groqModel, 'openai/gpt-oss-20b');
  assert.equal(config.ollamaModel, DEFAULT_OLLAMA_MODEL);
  assert.equal(config.providerMode, 'auto');
  assert.equal(config.maxAttempts, 3);
  assert.equal(config.groqMinRequestIntervalMs, 2_000);
  assert.equal(config.minConfidence, DEFAULT_LLM_MIN_CONFIDENCE);
});

test('loadLLMConfig supports environment overrides and rejects invalid numeric values', () => {
  const config = loadLLMConfig({
    LLM_PROVIDER: 'ollama',
    GROQ_API_KEY: 'test-key',
    GROQ_MODEL: 'custom-groq-model',
    GROQ_BASE_URL: 'https://groq.example/v1',
    OLLAMA_URL: 'http://jetson.example:11434',
    OLLAMA_MODEL: 'llama3.1:8b-instruct-q4_K_M',
    LLM_REQUEST_TIMEOUT_MS: '45000',
    LLM_MAX_ATTEMPTS: 'not-a-number',
    LLM_MAX_COMPLETION_TOKENS: '1000',
    LLM_MIN_CONFIDENCE: '0.8',
  });

  assert.equal(config.providerMode, 'ollama');
  assert.equal(config.groqModel, 'custom-groq-model');
  assert.equal(config.ollamaModel, 'llama3.1:8b-instruct-q4_K_M');
  assert.equal(config.requestTimeoutMs, 45_000);
  assert.equal(config.maxAttempts, 3);
  assert.equal(config.maxCompletionTokens, 1_000);
  assert.equal(config.minConfidence, 0.8);
  assert.deepEqual(getConfiguredProviders(config), ['ollama']);
});

test('loadLLMConfig falls back when confidence threshold is outside 0 to 1', () => {
  const config = loadLLMConfig({ LLM_MIN_CONFIDENCE: '1.5' });

  assert.equal(config.minConfidence, DEFAULT_LLM_MIN_CONFIDENCE);
});

test('auto mode selects Groq first and Ollama second when both are configured', () => {
  const config = loadLLMConfig({
    GROQ_API_KEY: 'test-key',
    OLLAMA_URL: 'http://localhost:11434',
  });

  assert.deepEqual(getConfiguredProviders(config), ['groq', 'ollama']);
  assert.equal(isLLMConfigured(config), true);
});

test('provider-specific mode is not considered configured without its required setting', () => {
  const groqOnly = loadLLMConfig({ LLM_PROVIDER: 'groq' });
  const ollamaOnly = loadLLMConfig({ LLM_PROVIDER: 'ollama' });

  assert.deepEqual(getConfiguredProviders(groqOnly), []);
  assert.deepEqual(getConfiguredProviders(ollamaOnly), []);
  assert.equal(isLLMConfigured(groqOnly), false);
  assert.equal(isLLMConfigured(ollamaOnly), false);
});

test('invalid provider URLs are excluded and surfaced as warnings', () => {
  const config = loadLLMConfig({
    GROQ_API_KEY: 'test-key',
    GROQ_BASE_URL: 'not-a-url',
    OLLAMA_URL: 'http://jetson.local:11434',
  });

  assert.deepEqual(getConfiguredProviders(config), ['ollama']);
  assert.equal(isLLMConfigured(config), true);
});
