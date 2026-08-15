import assert from 'node:assert/strict';
import test from 'node:test';
import { LLMClient } from './llm-client.js';

function completionResponse(content: string, model: string): Response {
  return new Response(
    JSON.stringify({
      model,
      choices: [{ message: { content } }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

test('LLMClient sends Groq an OpenAI-compatible JSON-mode request', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return completionResponse('{"ok":true}', 'llama-3.1-8b-instant');
  };

  const client = new LLMClient({
    groqApiKey: 'test-key',
    fetchImpl,
    sleep: async () => undefined,
    now: () => 0,
  });

  const completion = await client.completeJson('system', 'user', JSON.parse);

  assert.equal(completion.provider, 'groq');
  assert.equal(completion.model, 'llama-3.1-8b-instant');
  assert.deepEqual(completion.content, { ok: true });
  assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');

  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer test-key');

  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.model, 'llama-3.1-8b-instant');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.max_completion_tokens, 300);
});

test('LLMClient enforces at least two seconds between Groq request starts', async () => {
  let now = 0;
  const delays: number[] = [];
  const fetchImpl: typeof fetch = async () =>
    completionResponse('{"ok":true}', 'llama-3.1-8b-instant');

  const client = new LLMClient({
    groqApiKey: 'test-key',
    fetchImpl,
    now: () => now,
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
      now += milliseconds;
    },
  });

  await client.completeJson('system', 'first');
  await client.completeJson('system', 'second');

  assert.deepEqual(delays, [2_000]);
  assert.equal(now, 2_000);
});

test('LLMClient honors Retry-After on a transient Groq failure', async () => {
  let now = 0;
  let callCount = 0;
  const delays: number[] = [];
  const fetchImpl: typeof fetch = async () => {
    callCount++;
    if (callCount === 1) {
      return new Response(
        JSON.stringify({ error: { message: 'rate limit exceeded' } }),
        { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '3' } }
      );
    }
    return completionResponse('{"ok":true}', 'llama-3.1-8b-instant');
  };

  const client = new LLMClient({
    groqApiKey: 'test-key',
    fetchImpl,
    now: () => now,
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
      now += milliseconds;
    },
  });

  const completion = await client.completeJson('system', 'user', JSON.parse);

  assert.deepEqual(completion.content, { ok: true });
  assert.equal(callCount, 2);
  assert.deepEqual(delays, [3_000]);
});

test('LLMClient uses Ollama when Groq output fails classifier validation', async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    urls.push(url);

    if (url.startsWith('https://api.groq.com/')) {
      return completionResponse('{"severity":99}', 'llama-3.1-8b-instant');
    }

    return completionResponse('{"severity":7}', 'llama3.1:8b');
  };

  const client = new LLMClient({
    groqApiKey: 'test-key',
    ollamaUrl: 'http://localhost:11434',
    fetchImpl,
    sleep: async () => undefined,
    now: () => 0,
  });

  const completion = await client.completeJson(
    'system',
    'user',
    (content) => {
      const parsed = JSON.parse(content) as { severity?: number };
      if (parsed.severity !== 7) throw new Error('invalid severity');
      return parsed;
    }
  );

  assert.equal(completion.provider, 'ollama');
  assert.equal(completion.model, 'llama3.1:8b');
  assert.deepEqual(completion.content, { severity: 7 });
  assert.deepEqual(urls, [
    'https://api.groq.com/openai/v1/chat/completions',
    'http://localhost:11434/v1/chat/completions',
  ]);
});
