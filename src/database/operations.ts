/**
 * Database CRUD operations for the threat_incidents table.
 * Handles deduplication, batch inserts, and upserts.
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

// ─── Deduplication ───────────────────────────────────────────────────────────

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
    return false; // Assume it doesn't exist to avoid data loss
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
    // On error, return all incidents (better to attempt insert and handle conflicts)
    return incidents;
  }

  const existingUrls = new Set((data ?? []).map((row) => row.source_url));
  const newIncidents = incidents.filter((i) => !existingUrls.has(i.source_url));

  logger.info('Deduplication complete', {
    total: incidents.length,
    existing: existingUrls.size,
    new: newIncidents.length,
  });

  return newIncidents;
}

// ─── Insert Operations ───────────────────────────────────────────────────────

/**
 * Insert a single incident into the database.
 * Returns true if successful, false otherwise.
 */
export async function insertIncident(incident: ThreatIncident): Promise<boolean> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('threat_incidents')
    .insert(incident);

  if (error) {
    // Handle unique constraint violation gracefully (duplicate)
    if (error.code === '23505') {
      logger.debug('Duplicate incident skipped', { url: incident.source_url });
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
 * Batch insert incidents with deduplication.
 * Splits into chunks to respect Supabase limits.
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

  // First, filter out existing records
  const newIncidents = await filterNewIncidents(incidents);
  stats.skipped = incidents.length - newIncidents.length;

  if (newIncidents.length === 0) {
    logger.info('All incidents already exist in database');
    return stats;
  }

  // Insert in batches
  const supabase = getSupabaseClient();
  const batchSize = RATE_LIMITS.BATCH_INSERT_SIZE;

  for (let i = 0; i < newIncidents.length; i += batchSize) {
    const batch = newIncidents.slice(i, i + batchSize);

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
      logger.info('Batch inserted successfully', {
        count: data?.length ?? batch.length,
        batchIndex: Math.floor(i / batchSize) + 1,
      });
    }
  }

  logger.info('Batch insert complete', stats);
  return stats;
}

// ─── Query Operations ────────────────────────────────────────────────────────

/**
 * Get the most recent incidents from the database.
 */
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

/**
 * Get total count of incidents in the database.
 */
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
