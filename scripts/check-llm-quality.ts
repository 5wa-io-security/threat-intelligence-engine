import assert from 'node:assert/strict';
import type { ThreatIncident } from '../src/database/operations.js';
import {
  enrichIncidentWithLLM,
  enrichWithLLM,
  parseIncidentLLMEnrichment,
  type IncidentLLMClient,
} from '../src/llm/classifier.js';
import { LLM_QUALITY_FIXTURES, type LLMQualityFixture } from '../src/llm/quality-fixtures.js';

function makeIncident(fixture: LLMQualityFixture): ThreatIncident {
  return {
    title: fixture.title,
    source_url: `https://quality-fixture.invalid/${fixture.id}`,
    source_name: 'quality-fixture',
    published_at: '2026-09-09T00:00:00.000Z',
    country: 'Unknown',
    city: null,
    latitude: null,
    longitude: null,
    amount_usd: null,
    attack_type: fixture.heuristicAttackType,
    victim_type: fixture.heuristicVictimType,
    description: fixture.content,
    raw_content: fixture.content,
    tags: [fixture.heuristicAttackType, fixture.heuristicVictimType, 'fixture'],
    severity: null,
    ai_summary: null,
    confidence_score: null,
    llm_model: null,
  };
}

function makeFixtureClient(fixture: LLMQualityFixture): IncidentLLMClient {
  return {
    async completeJson<T>(
      _systemPrompt: string,
      _userPrompt: string,
      parseResponse: (content: string) => T,
    ) {
      return {
        content: parseResponse(fixture.response),
        model: 'fixture-model',
        provider: 'ollama',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        latencyMs: 1,
      };
    },
  };
}

async function main(): Promise<void> {
  for (const fixture of LLM_QUALITY_FIXTURES) {
    assert.deepEqual(parseIncidentLLMEnrichment(fixture.response), fixture.expected, fixture.id);

    const incident = makeIncident(fixture);
    const result = await enrichIncidentWithLLM(
      incident,
      makeFixtureClient(fixture),
      undefined,
      { minConfidence: 0.65 },
    );

    assert.equal(result.severity, fixture.expected.severity, fixture.id);
    assert.equal(result.attack_type, fixture.expected.attack_type, fixture.id);
    assert.equal(result.victim_type, fixture.expected.victim_type, fixture.id);
    assert.equal(result.ai_summary, fixture.expected.ai_summary, fixture.id);
    assert.equal(result.confidence_score, fixture.expected.confidence_score, fixture.id);
    assert.equal(result.llm_model, 'fixture-model', fixture.id);
    assert.deepEqual(result.tags.slice(0, 2), [fixture.expected.attack_type, fixture.expected.victim_type]);
  }

  const lowConfidenceFixture: LLMQualityFixture = {
    ...LLM_QUALITY_FIXTURES[0],
    id: 'low-confidence-preserves-heuristic',
    response: JSON.stringify({
      ...LLM_QUALITY_FIXTURES[0].expected,
      confidence_score: 0.64,
    }),
  };
  const lowConfidenceIncident = makeIncident(lowConfidenceFixture);
  const [preserved] = await enrichWithLLM(
    [lowConfidenceIncident],
    makeFixtureClient(lowConfidenceFixture),
    { minConfidence: 0.65 },
  );

  assert.strictEqual(preserved, lowConfidenceIncident);
  assert.equal(preserved.llm_model, null);
  assert.equal(preserved.confidence_score, null);

  console.log(
    `LLM quality regression passed (${LLM_QUALITY_FIXTURES.length} fixtures, confidence gate 1)`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
