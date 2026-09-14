import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LLMClient } from '../src/llm/llm-client.js';

type ResponseSpec = {
  status: number;
  body?: unknown;
  retryAfter?: string;
  delayMs?: number;
};

type RecordedRequest = {
  method: string;
  url: string;
  authorization: string | undefined;
  body: Record<string, unknown> | undefined;
};

type FakeProvider = {
  baseUrl: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
};

function jsonResponse(response: ServerResponse, status: number, body: unknown, retryAfter?: string): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  if (retryAfter !== undefined) response.setHeader('Retry-After', retryAfter);
  response.end(JSON.stringify(body));
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function startFakeProvider(model: string, postResponses: ResponseSpec[]): Promise<FakeProvider> {
  const requests: RecordedRequest[] = [];
  let postCount = 0;

  const server: Server = createServer(async (request, response) => {
    const bodyText = request.method === 'POST' ? await readRequestBody(request) : '';
    let body: Record<string, unknown> | undefined;
    if (bodyText) {
      try {
        const parsed = JSON.parse(bodyText) as unknown;
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          body = parsed as Record<string, unknown>;
        }
      } catch {
        jsonResponse(response, 400, { error: { message: 'invalid json' } });
        return;
      }
    }

    requests.push({
      method: request.method ?? 'GET',
      url: request.url ?? '/',
      authorization: request.headers.authorization,
      body,
    });

    if (request.method === 'GET' && request.url === '/v1/models') {
      jsonResponse(response, 200, { object: 'list', data: [{ id: model }] });
      return;
    }

    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      const configured = postResponses[Math.min(postCount, postResponses.length - 1)];
      postCount++;
      const spec = configured ?? {
        status: 200,
        body: {
          model,
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
        },
      };

      if (spec.delayMs) {
        await new Promise<void>((resolve) => setTimeout(resolve, spec.delayMs));
      }

      if (spec.status >= 200 && spec.status < 300) {
        jsonResponse(
          response,
          spec.status,
          spec.body ?? {
            model,
            choices: [{ message: { content: '{"ok":true}' } }],
            usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
          },
          spec.retryAfter
        );
      } else {
        jsonResponse(
          response,
          spec.status,
          spec.body ?? { error: { message: `fake provider status ${spec.status}` } },
          spec.retryAfter
        );
      }
      return;
    }

    jsonResponse(response, 404, { error: { message: 'not found' } });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function runOllamaContract(): Promise<number> {
  const provider = await startFakeProvider('llama3.1:8b', []);
  try {
    const client = new LLMClient({
      config: {
        providerMode: 'ollama',
        ollamaUrl: provider.baseUrl,
        ollamaApiKey: 'smoke-ollama-secret',
        maxAttempts: 1,
        requestTimeoutMs: 1_000,
      },
    });

    const health = await client.checkHealth();
    assert.equal(health.length, 1);
    assert.equal(health[0]?.provider, 'ollama');
    assert.equal(health[0]?.reachable, true);
    assert.equal(health[0]?.modelAvailable, true);

    const completion = await client.completeJson(
      'contract system prompt',
      'contract user prompt',
      JSON.parse
    );
    assert.equal(completion.provider, 'ollama');
    assert.equal(completion.model, 'llama3.1:8b');
    assert.deepEqual(completion.content, { ok: true });
    assert.deepEqual(completion.usage, {
      promptTokens: 12,
      completionTokens: 4,
      totalTokens: 16,
      totalDurationMs: undefined,
      loadDurationMs: undefined,
      promptEvalCount: undefined,
      evalCount: undefined,
      promptEvalDurationMs: undefined,
      evalDurationMs: undefined,
    });

    const getRequest = provider.requests[0];
    const postRequest = provider.requests[1];
    assert.equal(getRequest?.method, 'GET');
    assert.equal(getRequest?.url, '/v1/models');
    assert.equal(postRequest?.method, 'POST');
    assert.equal(postRequest?.url, '/v1/chat/completions');
    assert.equal(postRequest?.authorization, 'Bearer smoke-ollama-secret');
    assert.equal(postRequest?.body?.model, 'llama3.1:8b');
    assert.deepEqual(postRequest?.body?.response_format, { type: 'json_object' });
    assert.equal(postRequest?.body?.max_tokens, 300);

    return provider.requests.length;
  } finally {
    await provider.close();
  }
}

async function runFallbackContract(): Promise<number> {
  const groq = await startFakeProvider('openai/gpt-oss-20b', [
    { status: 503, body: { error: { message: 'temporary Groq outage' } } },
  ]);
  const ollama = await startFakeProvider('llama3.1:8b', []);

  try {
    const client = new LLMClient({
      config: {
        providerMode: 'auto',
        groqBaseUrl: groq.baseUrl,
        groqApiKey: 'smoke-groq-secret',
        ollamaUrl: ollama.baseUrl,
        maxAttempts: 1,
        requestTimeoutMs: 1_000,
      },
    });

    const completion = await client.completeJson('system', 'user', JSON.parse);
    assert.equal(completion.provider, 'ollama');
    assert.equal(groq.requests.filter((request) => request.method === 'POST').length, 1);
    assert.equal(ollama.requests.filter((request) => request.method === 'POST').length, 1);

    return groq.requests.length + ollama.requests.length;
  } finally {
    await Promise.all([groq.close(), ollama.close()]);
  }
}

async function runRetryContract(): Promise<number> {
  const provider = await startFakeProvider('llama3.1:8b', [
    { status: 429, retryAfter: '0' },
    {
      status: 200,
      body: {
        model: 'llama3.1:8b',
        choices: [{ message: { content: '{"retried":true}' } }],
      },
    },
  ]);
  const delays: number[] = [];

  try {
    const client = new LLMClient({
      config: {
        providerMode: 'ollama',
        ollamaUrl: provider.baseUrl,
        maxAttempts: 2,
        maxRetryDelayMs: 1_000,
        requestTimeoutMs: 1_000,
      },
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });

    const completion = await client.completeJson('system', 'user', JSON.parse);
    assert.deepEqual(completion.content, { retried: true });
    assert.equal(provider.requests.filter((request) => request.method === 'POST').length, 2);
    assert.deepEqual(delays, [1_000]);

    return provider.requests.length;
  } finally {
    await provider.close();
  }
}

async function runTimeoutContract(): Promise<number> {
  const provider = await startFakeProvider('llama3.1:8b', [
    { status: 200, delayMs: 100, body: { choices: [{ message: { content: '{"late":true}' } }] } },
  ]);

  try {
    const client = new LLMClient({
      config: {
        providerMode: 'ollama',
        ollamaUrl: provider.baseUrl,
        maxAttempts: 1,
        requestTimeoutMs: 25,
      },
    });

    await assert.rejects(
      () => client.completeJson('system', 'user'),
      /timed out after 25 ms/
    );
    return provider.requests.length;
  } finally {
    await provider.close();
  }
}

async function main(): Promise<void> {
  const requestCounts = {
    ollama: await runOllamaContract(),
    fallback: await runFallbackContract(),
    retry: await runRetryContract(),
    timeout: await runTimeoutContract(),
  };

  console.log(`LLM provider contract smoke passed (${JSON.stringify(requestCounts)})`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
