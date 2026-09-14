import type { ThreatIncident } from '../database/operations.js';
import type { AttackType, VictimType } from '../utils/constants.js';
import { createLogger } from '../utils/logger.js';
import { DEFAULT_LLM_MIN_CONFIDENCE, loadLLMConfig } from './config.js';
import {
  LLMClient,
  type LLMCompletion,
  type LLMProviderHealth,
} from './llm-client.js';
import {
  INCIDENT_ENRICHMENT_SYSTEM_PROMPT,
  buildIncidentEnrichmentPrompt,
} from './prompts.js';

const logger = createLogger('llm-classifier');

const ATTACK_TYPES = new Set<AttackType>([
  'kidnapping',
  'home_invasion',
  'robbery',
  'carjacking',
  'extortion',
  'assault',
  'other',
]);

const VICTIM_TYPES = new Set<VictimType>([
  'individual',
  'executive',
  'founder',
  'employee',
  'exchange_staff',
  'other',
]);

export interface IncidentLLMEnrichment {
  severity: number;
  attack_type: AttackType;
  victim_type: VictimType;
  ai_summary: string;
  confidence_score: number;
}

export interface EnrichmentCompletionMetadata {
  provider: 'groq' | 'ollama';
  model: string;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface IncidentLLMClient {
  completeJson<T>(
    systemPrompt: string,
    userPrompt: string,
    parseResponse: (content: string) => T
  ): Promise<LLMCompletion<T>>;
  checkHealth?: () => Promise<LLMProviderHealth[]>;
}

export interface EnrichmentOptions {
  /** Minimum model confidence required before replacing heuristic fields. */
  minConfidence?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const withoutFence = trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    try {
      return JSON.parse(withoutFence);
    } catch {
      const firstBrace = withoutFence.indexOf('{');
      const lastBrace = withoutFence.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        return JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1));
      }
      throw new Error('LLM response was not valid JSON');
    }
  }
}

export function parseIncidentLLMEnrichment(content: string): IncidentLLMEnrichment {
  let parsed: unknown;

  try {
    parsed = parseJsonObject(content);
  } catch (error) {
    throw new Error(
      `Could not parse LLM enrichment JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!isRecord(parsed)) {
    throw new Error('LLM enrichment must be a JSON object');
  }

  const severity = parsed.severity;
  const attackType = parsed.attack_type;
  const victimType = parsed.victim_type;
  const summary = parsed.ai_summary;
  const confidence = parsed.confidence_score;

  if (typeof severity !== 'number' || !Number.isInteger(severity) || severity < 1 || severity > 10) {
    throw new Error('LLM severity must be an integer from 1 to 10');
  }

  if (typeof attackType !== 'string' || !ATTACK_TYPES.has(attackType as AttackType)) {
    throw new Error('LLM attack_type is not an allowed value');
  }

  if (typeof victimType !== 'string' || !VICTIM_TYPES.has(victimType as VictimType)) {
    throw new Error('LLM victim_type is not an allowed value');
  }

  if (typeof summary !== 'string' || summary.trim() === '') {
    throw new Error('LLM ai_summary must be a non-empty string');
  }

  if (
    typeof confidence !== 'number' ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    throw new Error('LLM confidence_score must be a number from 0 to 1');
  }

  return {
    severity,
    attack_type: attackType as AttackType,
    victim_type: victimType as VictimType,
    ai_summary: summary.trim().slice(0, 1_000),
    confidence_score: confidence,
  };
}

function syncClassificationTags(
  tags: string[],
  attackType: AttackType,
  victimType: VictimType
): string[] {
  const classificationTags = new Set<string>([
    ...ATTACK_TYPES,
    ...VICTIM_TYPES,
  ]);
  const preservedTags = tags.filter((tag) => !classificationTags.has(tag));

  return [...new Set([attackType, victimType, ...preservedTags])];
}

function resolveMinConfidence(value: number | undefined): number {
  const configured = value ?? loadLLMConfig().minConfidence ?? DEFAULT_LLM_MIN_CONFIDENCE;
  if (!Number.isFinite(configured) || configured < 0 || configured > 1) {
    throw new Error('LLM minimum confidence must be a number from 0 to 1');
  }

  return configured;
}

export async function enrichIncidentWithLLM(
  incident: ThreatIncident,
  client: IncidentLLMClient,
  onCompletion?: (metadata: EnrichmentCompletionMetadata) => void,
  options: EnrichmentOptions = {}
): Promise<ThreatIncident> {
  const userPrompt = buildIncidentEnrichmentPrompt({
    title: incident.title,
    content: incident.raw_content.slice(0, 500),
    heuristicAttackType: incident.attack_type,
    heuristicVictimType: incident.victim_type,
    amountUsd: incident.amount_usd,
  });

  const completion = await client.completeJson(
    INCIDENT_ENRICHMENT_SYSTEM_PROMPT,
    userPrompt,
    parseIncidentLLMEnrichment
  );
  const enrichment = completion.content;
  const minConfidence = resolveMinConfidence(options.minConfidence);

  const promptTokens = completion.usage?.promptTokens ?? completion.usage?.promptEvalCount;
  const completionTokens =
    completion.usage?.completionTokens ?? completion.usage?.evalCount;
  onCompletion?.({
    provider: completion.provider,
    model: completion.model,
    latencyMs: completion.latencyMs,
    promptTokens,
    completionTokens,
    totalTokens:
      completion.usage?.totalTokens ??
      (promptTokens !== undefined && completionTokens !== undefined
        ? promptTokens + completionTokens
        : undefined),
  });

  if (enrichment.confidence_score < minConfidence) {
    throw new Error(
      `LLM confidence ${enrichment.confidence_score.toFixed(2)} is below minimum ${minConfidence.toFixed(2)}`
    );
  }

  return {
    ...incident,
    attack_type: enrichment.attack_type,
    victim_type: enrichment.victim_type,
    severity: enrichment.severity,
    ai_summary: enrichment.ai_summary,
    confidence_score: enrichment.confidence_score,
    llm_model: completion.model,
    tags: syncClassificationTags(
      incident.tags,
      enrichment.attack_type,
      enrichment.victim_type
    ),
  };
}

export async function enrichWithLLM(
  incidents: ThreatIncident[],
  client: IncidentLLMClient = new LLMClient(),
  options: EnrichmentOptions = {}
): Promise<ThreatIncident[]> {
  if (incidents.length === 0) return [];

  const minConfidence = resolveMinConfidence(options.minConfidence);

  logger.info('Starting sequential LLM enrichment', {
    count: incidents.length,
    minConfidence,
  });

  if (client.checkHealth) {
    try {
      const health = await client.checkHealth();
      logger.info('LLM provider health check complete', {
        providers: health.map((item: LLMProviderHealth) => ({
          provider: item.provider,
          model: item.model,
          reachable: item.reachable,
          modelAvailable: item.modelAvailable,
          latencyMs: item.latencyMs,
          error: item.error,
        })),
      });
    } catch (error) {
      // Health checks are observability/preflight only. The normal completion
      // path still owns fallback and graceful per-incident degradation.
      logger.warn('LLM provider health check failed; continuing to completion path', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const enrichedIncidents: ThreatIncident[] = [];
  let enriched = 0;
  let failed = 0;
  const providerCounts: Record<string, number> = {};
  const modelCounts: Record<string, number> = {};
  let totalLatencyMs = 0;
  let latencySamples = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;

  const recordCompletion = (metadata: EnrichmentCompletionMetadata): void => {
    providerCounts[metadata.provider] = (providerCounts[metadata.provider] ?? 0) + 1;
    modelCounts[metadata.model] = (modelCounts[metadata.model] ?? 0) + 1;

    if (metadata.latencyMs !== undefined) {
      totalLatencyMs += metadata.latencyMs;
      latencySamples++;
    }
    if (metadata.promptTokens !== undefined) totalPromptTokens += metadata.promptTokens;
    if (metadata.completionTokens !== undefined) {
      totalCompletionTokens += metadata.completionTokens;
    }
    if (metadata.totalTokens !== undefined) totalTokens += metadata.totalTokens;
  };

  // Sequential processing is intentional. LLMClient also enforces at least
  // two seconds between Groq request starts, including retry attempts.
  for (let index = 0; index < incidents.length; index++) {
    const incident = incidents[index];

    try {
      const enrichedIncident = await enrichIncidentWithLLM(
        incident,
        client,
        recordCompletion,
        { minConfidence }
      );
      enrichedIncidents.push(enrichedIncident);
      enriched++;

      logger.debug('Incident enriched with LLM', {
        position: index + 1,
        total: incidents.length,
        source: incident.source_name,
        model: enrichedIncident.llm_model,
        severity: enrichedIncident.severity,
        confidenceScore: enrichedIncident.confidence_score,
        attackTypeChanged: incident.attack_type !== enrichedIncident.attack_type,
        victimTypeChanged: incident.victim_type !== enrichedIncident.victim_type,
      });
    } catch (error) {
      failed++;
      enrichedIncidents.push(incident);
      logger.warn('LLM enrichment failed; preserving heuristic incident', {
        position: index + 1,
        total: incidents.length,
        source: incident.source_name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('LLM enrichment complete', {
    total: incidents.length,
    enriched,
    failed,
    providerCounts,
    modelCounts,
    averageLatencyMs: latencySamples > 0 ? Math.round(totalLatencyMs / latencySamples) : null,
    promptTokens: totalPromptTokens,
    completionTokens: totalCompletionTokens,
    totalTokens,
  });

  return enrichedIncidents;
}
