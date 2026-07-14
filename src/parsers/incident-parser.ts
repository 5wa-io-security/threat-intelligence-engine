/**
 * Incident Parser - Extracts structured incident data from raw text.
 * Uses keyword matching and heuristics to classify attack type, victim type,
 * extract monetary amounts, and generate tags.
 */

import { createLogger } from '../utils/logger.js';
import {
  ATTACK_TYPE_KEYWORDS,
  VICTIM_TYPE_KEYWORDS,
  AMOUNT_PATTERNS,
  MULTIPLIERS,
  type AttackType,
  type VictimType,
} from '../utils/constants.js';
import { parseGeoLocation, type GeoLocation } from './geo-parser.js';
import type { ThreatIncident } from '../database/operations.js';
import type { RawArticle } from '../collectors/rss-collector.js';
import type { RedditPost } from '../collectors/reddit-collector.js';
import type { LoppListEntry } from '../collectors/lopp-list-collector.js';

const logger = createLogger('incident-parser');

// ─── Types ───────────────────────────────────────────────────────────────────

type RawInput = RawArticle | RedditPost | LoppListEntry;

// ─── Attack Type Classification ──────────────────────────────────────────────

/**
 * Classify the attack type based on keyword matching.
 * Returns the most relevant attack type found in the text.
 */
export function classifyAttackType(text: string): AttackType {
  const lowerText = text.toLowerCase();
  const scores: Partial<Record<AttackType, number>> = {};

  for (const [attackType, keywords] of Object.entries(ATTACK_TYPE_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        score++;
      }
    }
    if (score > 0) {
      scores[attackType as AttackType] = score;
    }
  }

  // Return the attack type with the highest score
  const entries = Object.entries(scores) as [AttackType, number][];
  if (entries.length === 0) return 'other';

  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

// ─── Victim Type Classification ──────────────────────────────────────────────

/**
 * Classify the victim type based on keyword matching.
 */
export function classifyVictimType(text: string): VictimType {
  const lowerText = text.toLowerCase();
  const scores: Partial<Record<VictimType, number>> = {};

  for (const [victimType, keywords] of Object.entries(VICTIM_TYPE_KEYWORDS)) {
    if (victimType === 'other') continue;
    let score = 0;
    for (const keyword of keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        score++;
      }
    }
    if (score > 0) {
      scores[victimType as VictimType] = score;
    }
  }

  const entries = Object.entries(scores) as [VictimType, number][];
  if (entries.length === 0) return 'individual'; // Default to individual

  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

// ─── Amount Extraction ───────────────────────────────────────────────────────

/**
 * Extract the largest USD amount mentioned in the text.
 * Handles various formats: $1M, $1,000,000, 1 million USD, etc.
 */
export function extractAmount(text: string): number | null {
  const amounts: number[] = [];

  for (const pattern of AMOUNT_PATTERNS) {
    // Reset regex state
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const numStr = match[1].replace(/,/g, '');
      const multiplierStr = (match[2] ?? '').toLowerCase();

      let value = parseFloat(numStr);
      if (isNaN(value)) continue;

      if (multiplierStr && MULTIPLIERS[multiplierStr]) {
        value *= MULTIPLIERS[multiplierStr];
      }

      // Sanity check: ignore unreasonably large amounts (> $100B)
      if (value > 0 && value < 100_000_000_000) {
        amounts.push(value);
      }
    }
  }

  if (amounts.length === 0) return null;

  // Return the largest amount found (most likely the total stolen/demanded)
  return Math.max(...amounts);
}

// ─── Tag Generation ──────────────────────────────────────────────────────────

/**
 * Generate relevant tags from the incident text.
 */
export function generateTags(text: string, attackType: AttackType, victimType: VictimType): string[] {
  const tags: string[] = [attackType, victimType];
  const lowerText = text.toLowerCase();

  // Crypto-specific tags
  const cryptoTags: Record<string, string> = {
    bitcoin: 'bitcoin',
    btc: 'bitcoin',
    ethereum: 'ethereum',
    eth: 'ethereum',
    crypto: 'cryptocurrency',
    cryptocurrency: 'cryptocurrency',
    'hardware wallet': 'hardware-wallet',
    ledger: 'hardware-wallet',
    trezor: 'hardware-wallet',
    exchange: 'exchange',
    defi: 'defi',
    nft: 'nft',
    'seed phrase': 'seed-phrase',
    'private key': 'private-key',
  };

  for (const [keyword, tag] of Object.entries(cryptoTags)) {
    if (lowerText.includes(keyword) && !tags.includes(tag)) {
      tags.push(tag);
    }
  }

  // Severity indicators
  if (lowerText.includes('death') || lowerText.includes('killed') || lowerText.includes('murder')) {
    tags.push('fatal');
  }
  if (lowerText.includes('armed') || lowerText.includes('gun') || lowerText.includes('weapon')) {
    tags.push('armed');
  }
  if (lowerText.includes('gang') || lowerText.includes('organized') || lowerText.includes('group of')) {
    tags.push('organized-crime');
  }

  return [...new Set(tags)]; // Deduplicate
}

// ─── Description Generation ──────────────────────────────────────────────────

/**
 * Generate a concise description/summary of the incident.
 */
function generateDescription(title: string, content: string, _geo: GeoLocation, _attackType: AttackType): string {
  // If content is short enough, use it directly
  if (content.length <= 300) {
    return content || title;
  }

  // Extract the first meaningful sentences (up to 300 chars)
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 20);
  let description = '';

  for (const sentence of sentences) {
    if (description.length + sentence.length > 300) break;
    description += sentence.trim() + '. ';
  }

  return description.trim() || title;
}

// ─── Main Parser ─────────────────────────────────────────────────────────────

/**
 * Parse a raw article/post into a structured ThreatIncident.
 */
export function parseIncident(raw: RawInput): ThreatIncident {
  const combinedText = `${raw.title} ${raw.content}`;

  // Extract location
  const locationText = 'location' in raw ? `${raw.location} ${raw.content}` : combinedText;
  const geo = parseGeoLocation(locationText);

  // Classify attack type
  const attackType = classifyAttackType(combinedText);

  // Classify victim type
  const victimText = 'victim' in raw ? `${raw.victim} ${raw.content}` : combinedText;
  const victimType = classifyVictimType(victimText);

  // Extract amount
  const amountUsd = extractAmount(combinedText);

  // Generate tags
  const tags = generateTags(combinedText, attackType, victimType);

  // Generate description
  const description = generateDescription(raw.title, raw.snippet || raw.content, geo, attackType);

  const incident: ThreatIncident = {
    title: raw.title.slice(0, 500),
    source_url: raw.link,
    source_name: raw.sourceName,
    published_at: raw.publishedAt,
    country: geo.country,
    city: geo.city,
    latitude: geo.latitude,
    longitude: geo.longitude,
    amount_usd: amountUsd,
    attack_type: attackType,
    victim_type: victimType,
    description: description.slice(0, 1000),
    raw_content: raw.content.slice(0, 10000),
    tags,
  };

  logger.debug('Parsed incident', {
    title: incident.title.slice(0, 80),
    attackType,
    victimType,
    country: geo.country,
    amountUsd,
  });

  return incident;
}

/**
 * Parse multiple raw inputs into structured incidents.
 */
export function parseIncidents(rawInputs: RawInput[]): ThreatIncident[] {
  logger.info('Parsing incidents', { count: rawInputs.length });

  const incidents: ThreatIncident[] = [];

  for (const raw of rawInputs) {
    try {
      const incident = parseIncident(raw);
      incidents.push(incident);
    } catch (error) {
      logger.error('Failed to parse incident', {
        title: raw.title?.slice(0, 80),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('Parsing complete', {
    total: rawInputs.length,
    parsed: incidents.length,
    failed: rawInputs.length - incidents.length,
  });

  return incidents;
}
