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
    return completionResponse('{"ok":true}', 'openai/gpt-oss-20b');
  };

  const client = new LLMClient({
    groqApiKey: 'test-key',
    fetchImpl,
    sleep: async () => undefined,
    now: () => 0,
  });

  const completion = await client.completeJson('system', 'user', JSON.parse);

  assert.equal(completion.provider, 'groq');
  assert.equal(completion.model, 'openai/gpt-oss-20b');
  assert.deepEqual(completion.content, { ok: true });
  assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');

  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer test-key');

  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.model, 'openai/gpt-oss-20b');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.max_completion_tokens, 300);
});

test('LLMClient enforces at least two seconds between Groq request starts', async () => {
  let now = 0;
  const delays: number[] = [];
  const fetchImpl: typeof fetch = async () =>
    completionResponse('{"ok":true}', 'openai/gpt-oss-20b');

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
    return completionResponse('{"ok":true}', 'openai/gpt-oss-20b');
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

test('LLMClient disables Groq on daily token quota exhaustion and falls back immediately', async () => {
  let groqCalls = 0;
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    urls.push(url);

    if (url.startsWith('https://api.groq.com/')) {
      groqCalls++;
      return new Response(
        JSON.stringify({
          error: {
            message:
              'Rate limit reached for model openai/gpt-oss-20b: tokens per day (TPD): Limit 200000, Used 199999, Requested 900',
          },
        }),
        { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '20' } }
      );
    }

    return completionResponse('{"ok":true}', 'llama3.1:8b');
  };

  const client = new LLMClient({
    groqApiKey: 'test-key',
    ollamaUrl: 'http://localhost:11434',
    fetchImpl,
    sleep: async () => {
      throw new Error('daily quota failure must not sleep before fallback');
    },
    now: () => 0,
  });

  const completion = await client.completeJson('system', 'user', JSON.parse);

  assert.equal(completion.provider, 'ollama');
  assert.equal(groqCalls, 1);
  assert.deepEqual(urls, [
    'https://api.groq.com/openai/v1/chat/completions',
    'http://localhost:11434/v1/chat/completions',
  ]);
  assert.equal(client.hasAvailableProvider(), true);
});

test('LLMClient uses Ollama when Groq output fails classifier validation', async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    urls.push(url);

    if (url.startsWith('https://api.groq.com/')) {
      return completionResponse('{"severity":99}', 'openai/gpt-oss-20b');
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

test('LLMClient health check validates configured models without sending prompt content', async () => {
  const calls: Array<{ url: string; method: string | undefined }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method });
    return new Response(
      JSON.stringify({
        data: [{ id: 'openai/gpt-oss-20b' }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const client = new LLMClient({
    groqApiKey: 'test-key',
    fetchImpl,
    sleep: async () => undefined,
    now: () => 0,
  });

  const health = await client.checkHealth();

  assert.deepEqual(health, [
    {
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
      reachable: true,
      modelAvailable: true,
      latencyMs: 0,
      error: undefined,
    },
  ]);
  assert.deepEqual(calls, [
    {
      url: 'https://api.groq.com/openai/v1/models',
      method: 'GET',
    },
  ]);
});

test('LLMClient supports Ollama-only mode without a Groq key', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
    if (init?.method === 'GET') {
      return new Response(
        JSON.stringify({ data: [{ id: 'llama3.1:8b' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return completionResponse('{"ok":true}', 'llama3.1:8b');
  };

  const client = new LLMClient({
    config: {
      providerMode: 'ollama',
      ollamaUrl: 'http://jetson.local:11434',
    },
    fetchImpl,
    sleep: async () => undefined,
    now: () => 0,
  });

  const health = await client.checkHealth();
  const completion = await client.completeJson('system', 'user', JSON.parse);

  assert.equal(health[0].provider, 'ollama');
  assert.equal(completion.provider, 'ollama');
  assert.deepEqual(completion.content, { ok: true });
  assert.deepEqual(calls, [
    'GET http://jetson.local:11434/v1/models',
    'POST http://jetson.local:11434/v1/chat/completions',
  ]);
});

test('LLMClient disables a provider whose health endpoint lacks the configured model', async () => {
  let postCalls = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    if (init?.method === 'POST') postCalls++;
    return new Response(
      JSON.stringify({ data: [{ id: 'some-other-model' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const client = new LLMClient({
    config: {
      providerMode: 'ollama',
      ollamaUrl: 'http://jetson.local:11434',
    },
    fetchImpl,
    sleep: async () => undefined,
    now: () => 0,
  });

  const health = await client.checkHealth();
  await assert.rejects(
    () => client.completeJson('system', 'user'),
    /All configured LLM providers are unavailable/
  );

  assert.equal(health[0].modelAvailable, false);
  assert.equal(postCalls, 0);
});

test('LLMClient normalizes Groq usage metadata', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        model: 'openai/gpt-oss-20b',
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: {
          prompt_tokens: 80,
          completion_tokens: 20,
          total_tokens: 100,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  const client = new LLMClient({
    groqApiKey: 'test-key',
    fetchImpl,
    sleep: async () => undefined,
    now: () => 0,
  });

  const completion = await client.completeJson('system', 'user', JSON.parse);

  assert.deepEqual(completion.usage, {
    promptTokens: 80,
    completionTokens: 20,
    totalTokens: 100,
    totalDurationMs: undefined,
    loadDurationMs: undefined,
    promptEvalCount: undefined,
    evalCount: undefined,
    promptEvalDurationMs: undefined,
    evalDurationMs: undefined,
  });
  assert.equal(completion.latencyMs, 0);
});

test('LLMClient normalizes Ollama timing and token counters', async () => {
  const fetchImpl: typeof fetch = async (_input, init) => {
    if (init?.method === 'GET') {
      return new Response(
        JSON.stringify({ data: [{ id: 'llama3.1:8b' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        model: 'llama3.1:8b',
        choices: [{ message: { content: '{"ok":true}' } }],
        total_duration: 12_000_000,
        load_duration: 3_000_000,
        prompt_eval_count: 80,
        eval_count: 20,
        prompt_eval_duration: 5_000_000,
        eval_duration: 4_000_000,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const client = new LLMClient({
    config: {
      providerMode: 'ollama',
      ollamaUrl: 'http://jetson.local:11434',
    },
    fetchImpl,
    sleep: async () => undefined,
    now: () => 0,
  });

  await client.checkHealth();
  const completion = await client.completeJson('system', 'user', JSON.parse);

  assert.deepEqual(completion.usage, {
    promptTokens: undefined,
    completionTokens: undefined,
    totalTokens: undefined,
    totalDurationMs: 12,
    loadDurationMs: 3,
    promptEvalCount: 80,
    evalCount: 20,
    promptEvalDurationMs: 5,
    evalDurationMs: 4,
  });
});
