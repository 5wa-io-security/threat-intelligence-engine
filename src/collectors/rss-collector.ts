/**
 * RSS Feed Collector for CryptoSlate and CoinTelegraph.
 * Fetches articles from RSS feeds and filters for physical attack-related content.
 */

import Parser from 'rss-parser';
import { createLogger } from '../utils/logger.js';
import {
  RSS_FEEDS,
  PHYSICAL_ATTACK_KEYWORDS,
  SOURCE_NAMES,
  RATE_LIMITS,
} from '../utils/constants.js';

const logger = createLogger('rss-collector');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RawArticle {
  title: string;
  link: string;
  sourceName: string;
  publishedAt: string;
  content: string;
  snippet: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check if text contains any physical attack keywords.
 */
function matchesPhysicalAttackKeywords(text: string): boolean {
  const lowerText = text.toLowerCase();
  return PHYSICAL_ATTACK_KEYWORDS.some((keyword) => lowerText.includes(keyword.toLowerCase()));
}

/**
 * Strip HTML tags from text content.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sleep for a specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main Collector ──────────────────────────────────────────────────────────

/**
 * Fetch and filter articles from a single RSS feed.
 */
async function fetchFeed(
  feedUrl: string,
  sourceName: string
): Promise<RawArticle[]> {
  const parser = new Parser({
    timeout: 30000,
    headers: {
      'User-Agent': '5WA-ThreatIntelligenceEngine/1.0 (+https://5wa.io)',
      Accept: 'application/rss+xml, application/xml, text/xml',
    },
  });

  logger.info(`Fetching RSS feed`, { source: sourceName, url: feedUrl });

  try {
    const feed = await parser.parseURL(feedUrl);
    const articles: RawArticle[] = [];

    logger.info(`Feed fetched successfully`, {
      source: sourceName,
      totalItems: feed.items?.length ?? 0,
    });

    for (const item of feed.items ?? []) {
      const title = item.title ?? '';
      const content = stripHtml(item['content:encoded'] ?? item.content ?? item.contentSnippet ?? '');
      const snippet = item.contentSnippet ?? stripHtml(item.content ?? '').slice(0, 500);
      const combinedText = `${title} ${content} ${snippet}`;

      // Filter: only include articles about physical attacks
      if (matchesPhysicalAttackKeywords(combinedText)) {
        articles.push({
          title: title.trim(),
          link: item.link ?? '',
          sourceName,
          publishedAt: item.isoDate ?? item.pubDate ?? new Date().toISOString(),
          content: content.slice(0, 10000), // Cap raw content at 10k chars
          snippet: snippet.slice(0, 500),
        });
      }
    }

    logger.info(`Filtered articles from feed`, {
      source: sourceName,
      matched: articles.length,
      total: feed.items?.length ?? 0,
    });

    return articles;
  } catch (error) {
    logger.error(`Failed to fetch RSS feed`, {
      source: sourceName,
      url: feedUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Collect articles from all configured RSS feeds.
 * Returns raw articles that match physical attack keywords.
 */
export async function collectFromRSS(): Promise<RawArticle[]> {
  logger.info('Starting RSS collection');

  const allArticles: RawArticle[] = [];

  // Fetch CryptoSlate
  const cryptoslateArticles = await fetchFeed(
    RSS_FEEDS.CRYPTOSLATE,
    SOURCE_NAMES.CRYPTOSLATE
  );
  allArticles.push(...cryptoslateArticles);

  // Rate limit between feeds
  await sleep(RATE_LIMITS.RSS_DELAY_MS);

  // Fetch CoinTelegraph
  const cointelegraphArticles = await fetchFeed(
    RSS_FEEDS.COINTELEGRAPH,
    SOURCE_NAMES.COINTELEGRAPH
  );
  allArticles.push(...cointelegraphArticles);

  logger.info('RSS collection complete', {
    totalArticles: allArticles.length,
    sources: {
      [SOURCE_NAMES.CRYPTOSLATE]: cryptoslateArticles.length,
      [SOURCE_NAMES.COINTELEGRAPH]: cointelegraphArticles.length,
    },
  });

  return allArticles;
}
