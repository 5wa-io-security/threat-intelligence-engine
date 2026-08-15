import type { ThreatIncident } from '../database/operations.js';
import type { AttackType, VictimType } from '../utils/constants.js';
import { createLogger } from '../utils/logger.js';
import { LLMClient, type LLMCompletion } from './llm-client.js';
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

export interface IncidentLLMClient {
  completeJson<T>(
    systemPrompt: string,
    userPrompt: string,
    parseResponse: (content: string) => T
  ): Promise<LLMCompletion<T>>;
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

export async function enrichIncidentWithLLM(
  incident: ThreatIncident,
  client: IncidentLLMClient
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
  client: IncidentLLMClient = new LLMClient()
): Promise<ThreatIncident[]> {
  if (incidents.length === 0) return [];

  logger.info('Starting sequential LLM enrichment', { count: incidents.length });

  const enrichedIncidents: ThreatIncident[] = [];
  let enriched = 0;
  let failed = 0;

  // Sequential processing is intentional. LLMClient also enforces at least
  // two seconds between Groq request starts, including retry attempts.
  for (let index = 0; index < incidents.length; index++) {
    const incident = incidents[index];

    try {
      const enrichedIncident = await enrichIncidentWithLLM(incident, client);
      enrichedIncidents.push(enrichedIncident);
      enriched++;

      logger.debug('Incident enriched with LLM', {
        position: index + 1,
        total: incidents.length,
        title: incident.title.slice(0, 80),
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
        title: incident.title.slice(0, 80),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('LLM enrichment complete', {
    total: incidents.length,
    enriched,
    failed,
  });

  return enrichedIncidents;
}
