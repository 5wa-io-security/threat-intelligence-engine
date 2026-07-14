/**
 * 5WA Threat Intelligence Engine — Main Entry Point
 *
 * Collection pipeline:
 *   1. Fetch data from all sources (RSS feeds, Google News, Reddit, Lopp list)
 *   2. Parse and structure the raw data
 *   3. Deduplicate (in-memory cross-source → URL → semantic)
 *   4. Store new incidents in Supabase
 *
 * @see https://github.com/5wa-io-security/threat-intelligence-engine
 */

import 'dotenv/config';

import { createLogger } from './utils/logger.js';
import { collectFromRSS } from './collectors/rss-collector.js';
import { collectFromGoogleNews } from './collectors/google-news-collector.js';
import { collectFromReddit } from './collectors/reddit-collector.js';
import { collectFromLoppList } from './collectors/lopp-list-collector.js';
import { parseIncidents } from './parsers/incident-parser.js';
import { testConnection } from './database/supabase-client.js';
import { batchInsertIncidents, getIncidentCount } from './database/operations.js';

const logger = createLogger('main');

// ─── Pipeline ────────────────────────────────────────────────────────────────

interface CollectionStats {
  rssArticles: number;
  googleNewsArticles: number;
  redditPosts: number;
  loppEntries: number;
  totalRaw: number;
  totalParsed: number;
  inserted: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

async function runPipeline(): Promise<CollectionStats> {
  const startTime = Date.now();
  const stats: CollectionStats = {
    rssArticles: 0,
    googleNewsArticles: 0,
    redditPosts: 0,
    loppEntries: 0,
    totalRaw: 0,
    totalParsed: 0,
    inserted: 0,
    skipped: 0,
    errors: 0,
    durationMs: 0,
  };

  // ─── Step 1: Test Database Connection ────────────────────────────────────
  logger.info('Step 1/4: Testing database connection...');
  const isConnected = await testConnection();
  if (!isConnected) {
    throw new Error(
      'Failed to connect to Supabase. Check SUPABASE_URL and SUPABASE_KEY environment variables.'
    );
  }

  const countBefore = await getIncidentCount();
  logger.info('Database connected', { existingRecords: countBefore });

  // ─── Step 2: Collect from All Sources ────────────────────────────────────
  logger.info('Step 2/4: Collecting from all sources...');

  // Run all collectors concurrently — each handles its own rate limiting
  const [rssArticles, googleNewsArticles, redditPosts, loppEntries] = await Promise.all([
    collectFromRSS().catch((err: Error) => {
      logger.error('RSS collection failed', { error: err.message });
      return [];
    }),
    collectFromGoogleNews().catch((err: Error) => {
      logger.error('Google News collection failed', { error: err.message });
      return [];
    }),
    collectFromReddit().catch((err: Error) => {
      logger.error('Reddit collection failed', { error: err.message });
      return [];
    }),
    collectFromLoppList().catch((err: Error) => {
      logger.error('Lopp list collection failed', { error: err.message });
      return [];
    }),
  ]);

  stats.rssArticles = rssArticles.length;
  stats.googleNewsArticles = googleNewsArticles.length;
  stats.redditPosts = redditPosts.length;
  stats.loppEntries = loppEntries.length;
  stats.totalRaw =
    rssArticles.length +
    googleNewsArticles.length +
    redditPosts.length +
    loppEntries.length;

  logger.info('Collection complete', {
    rss: stats.rssArticles,
    googleNews: stats.googleNewsArticles,
    reddit: stats.redditPosts,
    lopp: stats.loppEntries,
    total: stats.totalRaw,
  });

  if (stats.totalRaw === 0) {
    logger.warn('No raw data collected from any source. Pipeline ending early.');
    stats.durationMs = Date.now() - startTime;
    return stats;
  }

  // ─── Step 3: Parse Raw Data into Structured Incidents ────────────────────
  logger.info('Step 3/4: Parsing raw data...');

  const allRawInputs = [
    ...rssArticles,
    ...googleNewsArticles,
    ...redditPosts,
    ...loppEntries,
  ];
  const incidents = parseIncidents(allRawInputs);
  stats.totalParsed = incidents.length;

  logger.info('Parsing complete', { parsed: stats.totalParsed });

  if (incidents.length === 0) {
    logger.warn('No incidents parsed. Pipeline ending early.');
    stats.durationMs = Date.now() - startTime;
    return stats;
  }

  // ─── Step 4: Deduplicate and Store in Database ───────────────────────────
  logger.info('Step 4/4: Deduplicating and storing incidents...');

  const insertResult = await batchInsertIncidents(incidents);
  stats.inserted = insertResult.inserted;
  stats.skipped = insertResult.skipped;
  stats.errors = insertResult.errors;

  const countAfter = await getIncidentCount();
  stats.durationMs = Date.now() - startTime;

  logger.info('Pipeline complete', {
    ...stats,
    dbCountBefore: countBefore,
    dbCountAfter: countAfter,
    newRecords: countAfter - countBefore,
  });

  return stats;
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info('═══════════════════════════════════════════════════════════════');
  logger.info('5WA Threat Intelligence Engine — Starting collection pipeline');
  logger.info('═══════════════════════════════════════════════════════════════');

  try {
    const stats = await runPipeline();

    logger.info('═══════════════════════════════════════════════════════════════');
    logger.info('Pipeline Summary', {
      sources: {
        rss: stats.rssArticles,
        googleNews: stats.googleNewsArticles,
        reddit: stats.redditPosts,
        lopp: stats.loppEntries,
      },
      results: {
        totalRaw: stats.totalRaw,
        totalParsed: stats.totalParsed,
        inserted: stats.inserted,
        skipped: stats.skipped,
        errors: stats.errors,
      },
      duration: `${(stats.durationMs / 1000).toFixed(1)}s`,
    });
    logger.info('═══════════════════════════════════════════════════════════════');

    if (stats.totalRaw > 0 && stats.inserted === 0 && stats.errors > 0) {
      logger.error('Pipeline completed with errors — no data was stored');
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    logger.error('Pipeline failed with fatal error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

main();
