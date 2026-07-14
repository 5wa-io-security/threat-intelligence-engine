/**
 * Database CRUD operations for the threat_incidents table.
 *
 * Deduplication strategy (two layers):
 *
 * Layer 1 — URL dedup: exact match on source_url (fast, catches same article
 *   re-fetched across runs).
 *
 * Layer 2 — Semantic dedup (cross-source): detects the same real-world event
 *   reported by multiple outlets. Uses a combination of:
 *   - Normalised title similarity (Jaccard on word tokens, threshold 0.45)
 *   - Date proximity (within ±3 days)
 *   - Country match (if both known)
 *   This prevents "Crypto trader kidnapped in London" from being stored 8 times
 *   when every major outlet covers the same story.
 */

import { getSupabaseClient } from './supabase-client.js';
import { createLogger } from '../utils/logger.js';
import { RATE_LIMITS } from '../utils/constants.js';
import type { AttackType, VictimType } from '../utils/constants.js';

const logger = createLogger('db-operations');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ThreatIncident {
  title: string;
  source_url: string;
  source_name: string;
  published_at: string;
  country: string;
  city: string | null;
  amount_usd: number | null;
  attack_type: AttackType;
  victim_type: VictimType;
  description: string;
  raw_content: string;
  tags: string[];
}

export interface ThreatIncidentRow extends ThreatIncident {
  id: string;
  created_at: string;
  updated_at: string;
}

// ─── Title Similarity ─────────────────────────────────────────────────────────

/** Stop-words to ignore when comparing titles */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were', 'be', 'been',
  'has', 'have', 'had', 'it', 'its', 'this', 'that', 'as', 'into', 'over',
  'after', 'about', 'up', 'out', 'who', 'how', 'he', 'she', 'they', 'his',
  'her', 'their', 'after', 'after',
]);

/**
 * Tokenise a title into a set of meaningful lowercase words.
 */
function tokenise(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  );
}

/**
 * Jaccard similarity between two token sets.
 * Returns a value in [0, 1]; higher = more similar.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

/** Threshold above which two titles are considered the same event */
const TITLE_SIMILARITY_THRESHOLD = 0.45;
/** Max days apart for two articles to be considered the same event */
const DATE_PROXIMITY_DAYS = 3;

/**
 * Returns true if two incidents likely describe the same real-world event.
 */
function isSameEvent(a: ThreatIncident, b: ThreatIncident): boolean {
  // Country must match if both are known
  if (
    a.country !== 'Unknown' &&
    b.country !== 'Unknown' &&
    a.country !== b.country
  ) {
    return false;
  }

  // Date proximity check
  const dateA = new Date(a.published_at).getTime();
  const dateB = new Date(b.published_at).getTime();
  const diffDays = Math.abs(dateA - dateB) / (1000 * 60 * 60 * 24);
  if (diffDays > DATE_PROXIMITY_DAYS) return false;

  // Title similarity check
  const tokensA = tokenise(a.title);
  const tokensB = tokenise(b.title);
  const similarity = jaccardSimilarity(tokensA, tokensB);

  return similarity >= TITLE_SIMILARITY_THRESHOLD;
}

/**
 * Deduplicate a batch of incidents against each other (in-memory, cross-source).
 * When two incidents are considered the same event, keeps the one with more
 * content (longer description / raw_content), preferring named sources.
 */
export function deduplicateInMemory(incidents: ThreatIncident[]): ThreatIncident[] {
  const kept: ThreatIncident[] = [];

  for (const candidate of incidents) {
    let isDuplicate = false;

    for (let i = 0; i < kept.length; i++) {
      if (isSameEvent(candidate, kept[i])) {
        isDuplicate = true;

        // Keep whichever has richer content
        const candidateScore =
          candidate.raw_content.length + candidate.description.length;
        const existingScore =
          kept[i].raw_content.length + kept[i].description.length;

        if (candidateScore > existingScore) {
          kept[i] = candidate; // Replace with richer version
        }
        break;
      }
    }

    if (!isDuplicate) {
      kept.push(candidate);
    }
  }

  const removed = incidents.length - kept.length;
  if (removed > 0) {
    logger.info('In-memory cross-source dedup complete', {
      before: incidents.length,
      after: kept.length,
      removed,
    });
  }

  return kept;
}

// ─── URL-Based Deduplication (DB) ────────────────────────────────────────────

/**
 * Check if a source URL already exists in the database.
 */
export async function urlExists(sourceUrl: string): Promise<boolean> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('threat_incidents')
    .select('id')
    .eq('source_url', sourceUrl)
    .limit(1);

  if (error) {
    logger.error('Error checking URL existence', { error: error.message, url: sourceUrl });
    return false;
  }

  return (data?.length ?? 0) > 0;
}

/**
 * Filter out incidents whose source_url already exists in the database.
 * Performs batch checking for efficiency.
 */
export async function filterNewIncidents(incidents: ThreatIncident[]): Promise<ThreatIncident[]> {
  if (incidents.length === 0) return [];

  const supabase = getSupabaseClient();
  const urls = incidents.map((i) => i.source_url);

  const { data, error } = await supabase
    .from('threat_incidents')
    .select('source_url')
    .in('source_url', urls);

  if (error) {
    logger.error('Error batch-checking URLs', { error: error.message });
    return incidents;
  }

  const existingUrls = new Set((data ?? []).map((row) => row.source_url));
  const newIncidents = incidents.filter((i) => !existingUrls.has(i.source_url));

  logger.info('URL deduplication complete', {
    total: incidents.length,
    existingUrls: existingUrls.size,
    new: newIncidents.length,
  });

  return newIncidents;
}

// ─── Semantic Dedup Against DB ───────────────────────────────────────────────

/**
 * For each candidate incident, check if a semantically similar incident
 * already exists in the database (same event, different source).
 *
 * Fetches recent incidents (last 7 days) from DB and runs in-memory comparison.
 * This is intentionally lightweight — we only check recent records to keep
 * the DB query fast.
 */
export async function filterSemanticDuplicates(
  incidents: ThreatIncident[]
): Promise<ThreatIncident[]> {
  if (incidents.length === 0) return [];

  const supabase = getSupabaseClient();

  // Fetch incidents from the last 7 days for comparison
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('threat_incidents')
    .select('title, published_at, country, source_url, description, raw_content')
    .gte('published_at', sevenDaysAgo)
    .order('published_at', { ascending: false })
    .limit(500);

  if (error) {
    logger.warn('Could not fetch recent incidents for semantic dedup', {
      error: error.message,
    });
    return incidents; // Proceed without semantic dedup on error
  }

  const recentDbIncidents = (data ?? []) as ThreatIncident[];

  if (recentDbIncidents.length === 0) {
    return incidents; // Nothing to compare against
  }

  const filtered: ThreatIncident[] = [];
  let semanticDupsFound = 0;

  for (const candidate of incidents) {
    const isSemanticDup = recentDbIncidents.some((existing) =>
      isSameEvent(candidate, existing)
    );

    if (isSemanticDup) {
      semanticDupsFound++;
      logger.debug('Semantic duplicate detected (already in DB)', {
        title: candidate.title.slice(0, 80),
      });
    } else {
      filtered.push(candidate);
    }
  }

  if (semanticDupsFound > 0) {
    logger.info('Semantic dedup against DB complete', {
      candidates: incidents.length,
      semanticDupsFound,
      remaining: filtered.length,
    });
  }

  return filtered;
}

// ─── Insert Operations ───────────────────────────────────────────────────────

/**
 * Insert a single incident into the database.
 */
export async function insertIncident(incident: ThreatIncident): Promise<boolean> {
  const supabase = getSupabaseClient();

  const { error } = await supabase.from('threat_incidents').insert(incident);

  if (error) {
    if (error.code === '23505') {
      logger.debug('Duplicate incident skipped (unique constraint)', {
        url: incident.source_url,
      });
      return false;
    }
    logger.error('Error inserting incident', {
      error: error.message,
      code: error.code,
      url: incident.source_url,
    });
    return false;
  }

  logger.debug('Incident inserted', { title: incident.title, url: incident.source_url });
  return true;
}

/**
 * Full deduplication + batch insert pipeline:
 * 1. In-memory cross-source dedup (Jaccard title similarity)
 * 2. URL dedup against DB
 * 3. Semantic dedup against recent DB records
 * 4. Batch insert remaining new incidents
 */
export async function batchInsertIncidents(incidents: ThreatIncident[]): Promise<{
  inserted: number;
  skipped: number;
  errors: number;
}> {
  const stats = { inserted: 0, skipped: 0, errors: 0 };

  if (incidents.length === 0) {
    logger.info('No incidents to insert');
    return stats;
  }

  // Step 1: In-memory cross-source dedup
  const afterInMemoryDedup = deduplicateInMemory(incidents);
  stats.skipped += incidents.length - afterInMemoryDedup.length;

  // Step 2: URL dedup against DB
  const afterUrlDedup = await filterNewIncidents(afterInMemoryDedup);
  stats.skipped += afterInMemoryDedup.length - afterUrlDedup.length;

  // Step 3: Semantic dedup against recent DB records
  const afterSemanticDedup = await filterSemanticDuplicates(afterUrlDedup);
  stats.skipped += afterUrlDedup.length - afterSemanticDedup.length;

  if (afterSemanticDedup.length === 0) {
    logger.info('All incidents are duplicates — nothing new to insert', { skipped: stats.skipped });
    return stats;
  }

  // Step 4: Batch insert
  const supabase = getSupabaseClient();
  const batchSize = RATE_LIMITS.BATCH_INSERT_SIZE;

  for (let i = 0; i < afterSemanticDedup.length; i += batchSize) {
    const batch = afterSemanticDedup.slice(i, i + batchSize);

    const { error, data } = await supabase
      .from('threat_incidents')
      .insert(batch)
      .select('id');

    if (error) {
      logger.error('Batch insert error', {
        error: error.message,
        batchStart: i,
        batchSize: batch.length,
      });
      // Fall back to individual inserts for this batch
      for (const incident of batch) {
        const success = await insertIncident(incident);
        if (success) {
          stats.inserted++;
        } else {
          stats.errors++;
        }
      }
    } else {
      stats.inserted += data?.length ?? batch.length;
      logger.info('Batch inserted', {
        count: data?.length ?? batch.length,
        batchIndex: Math.floor(i / batchSize) + 1,
      });
    }
  }

  logger.info('Batch insert complete', stats);
  return stats;
}

// ─── Query Operations ────────────────────────────────────────────────────────

export async function getRecentIncidents(limit: number = 20): Promise<ThreatIncidentRow[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('threat_incidents')
    .select('*')
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('Error fetching recent incidents', { error: error.message });
    return [];
  }

  return (data ?? []) as ThreatIncidentRow[];
}

export async function getIncidentCount(): Promise<number> {
  const supabase = getSupabaseClient();

  const { count, error } = await supabase
    .from('threat_incidents')
    .select('*', { count: 'exact', head: true });

  if (error) {
    logger.error('Error fetching incident count', { error: error.message });
    return -1;
  }

  return count ?? 0;
}
