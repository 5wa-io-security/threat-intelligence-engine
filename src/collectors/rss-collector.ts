/**
 * RSS Feed Collector — CryptoSlate, CoinTelegraph, CoinDesk, The Block,
 * Decrypt, BleepingComputer, Bitcoin Magazine, CryptoNews.
 *
 * Uses dual-group keyword matching: an article must contain at least one
 * physical-threat keyword AND at least one crypto-context keyword.
 */

import Parser from 'rss-parser';
import { createLogger } from '../utils/logger.js';
import {
  RSS_FEEDS,
  SOURCE_NAMES,
  RATE_LIMITS,
  matchesDualGroupKeywords,
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
 * Strip HTML tags and decode common HTML entities.
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Feed Fetcher ─────────────────────────────────────────────────────────────

const rssParser = new Parser({
  timeout: 30000,
  headers: {
    'User-Agent': '5WA-ThreatIntelligenceEngine/1.0 (+https://5wa.io)',
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  },
  customFields: {
    item: [['media:content', 'mediaContent'], ['content:encoded', 'contentEncoded']],
  },
});

/**
 * Fetch and filter articles from a single RSS feed URL.
 */
async function fetchFeed(feedUrl: string, sourceName: string): Promise<RawArticle[]> {
  logger.info('Fetching RSS feed', { source: sourceName, url: feedUrl });

  try {
    const feed = await rssParser.parseURL(feedUrl);
    const articles: RawArticle[] = [];

    logger.debug('Feed fetched', { source: sourceName, items: feed.items?.length ?? 0 });

    for (const item of feed.items ?? []) {
      const title = item.title ?? '';
      const itemAny = item as unknown as Record<string, unknown>;
      const rawContent =
        itemAny['contentEncoded'] as string ??
        itemAny['content:encoded'] as string ??
        item.content ??
        '';
      const content = stripHtml(rawContent);
      const snippet = item.contentSnippet ?? content.slice(0, 500);
      const combinedText = `${title} ${content} ${snippet}`;

      if (matchesDualGroupKeywords(combinedText)) {
        articles.push({
          title: title.trim(),
          link: item.link ?? '',
          sourceName,
          publishedAt: item.isoDate ?? item.pubDate ?? new Date().toISOString(),
          content: content.slice(0, 10000),
          snippet: snippet.slice(0, 500),
        });
      }
    }

    logger.info('Feed filtered', {
      source: sourceName,
      matched: articles.length,
      total: feed.items?.length ?? 0,
    });

    return articles;
  } catch (error) {
    logger.error('Failed to fetch RSS feed', {
      source: sourceName,
      url: feedUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

// ─── Main Collector ──────────────────────────────────────────────────────────

// Map source key → source name for all configured feeds
const FEED_MAP: Array<{ url: string; name: string }> = [
  { url: RSS_FEEDS.CRYPTOSLATE,       name: SOURCE_NAMES.CRYPTOSLATE },
  { url: RSS_FEEDS.COINTELEGRAPH,     name: SOURCE_NAMES.COINTELEGRAPH },
  { url: RSS_FEEDS.COINDESK,          name: SOURCE_NAMES.COINDESK },
  { url: RSS_FEEDS.THE_BLOCK,         name: SOURCE_NAMES.THE_BLOCK },
  { url: RSS_FEEDS.DECRYPT,           name: SOURCE_NAMES.DECRYPT },
  { url: RSS_FEEDS.BLEEPING_COMPUTER, name: SOURCE_NAMES.BLEEPING_COMPUTER },
  { url: RSS_FEEDS.BITCOIN_MAGAZINE,  name: SOURCE_NAMES.BITCOIN_MAGAZINE },
  { url: RSS_FEEDS.CRYPTONEWS,        name: SOURCE_NAMES.CRYPTONEWS },
];

/**
 * Collect articles from all configured RSS feeds.
 * Returns raw articles that pass dual-group keyword matching.
 */
export async function collectFromRSS(): Promise<RawArticle[]> {
  logger.info('Starting RSS collection', { feedCount: FEED_MAP.length });

  const allArticles: RawArticle[] = [];
  const perSourceCounts: Record<string, number> = {};

  for (const feed of FEED_MAP) {
    const articles = await fetchFeed(feed.url, feed.name);
    allArticles.push(...articles);
    perSourceCounts[feed.name] = articles.length;

    // Respect rate limits between feeds
    await sleep(RATE_LIMITS.RSS_DELAY_MS);
  }

  logger.info('RSS collection complete', {
    totalArticles: allArticles.length,
    perSource: perSourceCounts,
  });

  return allArticles;
}
