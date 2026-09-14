import assert from 'node:assert/strict';
import test from 'node:test';
import type { ThreatIncident } from '../database/operations.js';
import {
  enrichWithLLM,
  parseIncidentLLMEnrichment,
  type IncidentLLMClient,
} from './classifier.js';

function makeIncident(overrides: Partial<ThreatIncident> = {}): ThreatIncident {
  return {
    title: 'Crypto holder robbed after home invasion',
    source_url: 'https://example.com/incident',
    source_name: 'Example News',
    published_at: '2026-08-15T00:00:00.000Z',
    country: 'United States',
    city: null,
    latitude: null,
    longitude: null,
    amount_usd: 100_000,
    attack_type: 'other',
    victim_type: 'individual',
    description: 'A crypto holder was robbed at home.',
    raw_content: 'Attackers entered the victim home at gunpoint and forced a crypto transfer.',
    tags: ['other', 'individual', 'bitcoin', 'armed'],
    severity: null,
    ai_summary: null,
    confidence_score: null,
    llm_model: null,
    ...overrides,
  };
}

function makeSuccessClient(response: string, model = 'openai/gpt-oss-20b'): IncidentLLMClient {
  return {
    async completeJson<T>(
      _systemPrompt: string,
      _userPrompt: string,
      parseResponse: (content: string) => T
    ) {
      return {
        content: parseResponse(response),
        model,
        provider: 'groq',
      };
    },
  };
}

test('parseIncidentLLMEnrichment accepts valid bounded output', () => {
  const parsed = parseIncidentLLMEnrichment(`\`\`\`json
  {
    "severity": 7,
    "attack_type": "home_invasion",
    "victim_type": "individual",
    "ai_summary": "Armed intruders forced a crypto holder to transfer funds during a home invasion.",
    "confidence_score": 0.97
  }
  \`\`\``);

  assert.deepEqual(parsed, {
    severity: 7,
    attack_type: 'home_invasion',
    victim_type: 'individual',
    ai_summary: 'Armed intruders forced a crypto holder to transfer funds during a home invasion.',
    confidence_score: 0.97,
  });
});

test('parseIncidentLLMEnrichment rejects invalid ranges and enum values', () => {
  assert.throws(
    () =>
      parseIncidentLLMEnrichment(
        JSON.stringify({
          severity: 11,
          attack_type: 'cyber_hack',
          victim_type: 'individual',
          ai_summary: 'Invalid output.',
          confidence_score: 1.2,
        })
      ),
    /severity/
  );
});

test('enrichWithLLM applies validated values and synchronizes classification tags', async () => {
  const incident = makeIncident();
  const client = makeSuccessClient(
    JSON.stringify({
      severity: 7,
      attack_type: 'home_invasion',
      victim_type: 'individual',
      ai_summary: 'Armed intruders forced a crypto holder to transfer funds during a home invasion.',
      confidence_score: 0.97,
    })
  );

  const [result] = await enrichWithLLM([incident], client);

  assert.equal(result.severity, 7);
  assert.equal(result.attack_type, 'home_invasion');
  assert.equal(result.ai_summary, 'Armed intruders forced a crypto holder to transfer funds during a home invasion.');
  assert.equal(result.confidence_score, 0.97);
  assert.equal(result.llm_model, 'openai/gpt-oss-20b');
  assert.deepEqual(result.tags, ['home_invasion', 'individual', 'bitcoin', 'armed']);
  assert.equal(incident.attack_type, 'other', 'the source incident must not be mutated');
});

test('enrichWithLLM preserves heuristic data below the configured confidence gate', async () => {
  const incident = makeIncident();
  const client = makeSuccessClient(
    JSON.stringify({
      severity: 8,
      attack_type: 'home_invasion',
      victim_type: 'individual',
      ai_summary: 'The model identified a likely home invasion.',
      confidence_score: 0.64,
    })
  );

  const [result] = await enrichWithLLM([incident], client, { minConfidence: 0.65 });

  assert.strictEqual(result, incident);
  assert.equal(result.attack_type, 'other');
  assert.equal(result.severity, null);
  assert.equal(result.ai_summary, null);
  assert.equal(result.confidence_score, null);
  assert.equal(result.llm_model, null);
});

test('enrichWithLLM preserves the original incident when a call fails', async () => {
  const incident = makeIncident();
  const failingClient: IncidentLLMClient = {
    async completeJson<_T>(): Promise<never> {
      throw new Error('provider unavailable');
    },
  };

  const [result] = await enrichWithLLM([incident], failingClient);

  assert.strictEqual(result, incident);
  assert.equal(result.severity, null);
  assert.equal(result.ai_summary, null);
  assert.equal(result.confidence_score, null);
  assert.equal(result.llm_model, null);
});

test('enrichWithLLM preserves the remaining incidents after providers are exhausted', async () => {
  const incidents = [makeIncident(), makeIncident({ title: 'Second incident' })];
  let calls = 0;
  const exhaustedClient: IncidentLLMClient = {
    hasAvailableProvider: () => calls === 0,
    async completeJson<_T>(): Promise<never> {
      calls++;
      throw new Error('daily quota exhausted');
    },
  };

  const result = await enrichWithLLM(incidents, exhaustedClient);

  assert.equal(calls, 1);
  assert.strictEqual(result[0], incidents[0]);
  assert.strictEqual(result[1], incidents[1]);
});
