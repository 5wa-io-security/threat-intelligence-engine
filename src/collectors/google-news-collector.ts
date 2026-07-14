/**
 * Google News RSS Collector.
 *
 * Queries Google News RSS search endpoint for each configured keyword phrase.
 * Google News aggregates articles from thousands of publishers, giving us
 * broad coverage of recent events that specialist crypto feeds may miss.
 *
 * Endpoint: https://news.google.com/rss/search?q=<query>&hl=en&gl=US&ceid=US:en
 *
 * Note: Google News RSS returns article titles and source names but limited
 * body text. We use the title + snippet for keyword matching and store the
 * original publisher URL (extracted from the Google redirect URL).
 */

import Parser from 'rss-parser';
import { createLogger } from '../utils/logger.js';
import {
  GOOGLE_NEWS_QUERIES,
  SOURCE_NAMES,
  RATE_LIMITS,
  matchesDualGroupKeywords,
} from '../utils/constants.js';

const logger = createLogger('google-news-collector');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GoogleNewsArticle {
  title: string;
  link: string;
  sourceName: string;
  publishedAt: string;
  content: string;
  snippet: string;
  /** The actual publisher name extracted from the Google News item */
  publisher: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
 * Build the Google News RSS search URL for a given query.
 */
function buildGoogleNewsUrl(query: string): string {
  const params = new URLSearchParams({
    q: query,
    hl: 'en',
    gl: 'US',
    ceid: 'US:en',
  });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

/**
 * Extract the publisher name from a Google News RSS item.
 * Google News includes the source in the title as "Headline - Publisher Name"
 * or in a <source> element.
 */
function extractPublisher(title: string, sourceTag?: string): string {
  if (sourceTag) return sourceTag.trim();

  // Google News titles often end with " - Publisher Name"
  const dashMatch = title.match(/\s[-–]\s([^-–]+)$/);
  if (dashMatch) return dashMatch[1].trim();

  return 'Unknown';
}

/**
 * Clean a Google News title by removing the trailing " - Publisher" suffix.
 */
function cleanTitle(title: string): string {
  return title.replace(/\s[-–]\s[^-–]+$/, '').trim();
}

// ─── Feed Fetcher ─────────────────────────────────────────────────────────────

const rssParser = new Parser({
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; 5WA-ThreatIntelligenceEngine/1.0; +https://5wa.io)',
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  },
  customFields: {
    item: [['source', 'sourceTag']],
  },
});

/**
 * Fetch and parse a single Google News RSS query.
 */
async function fetchGoogleNewsQuery(query: string): Promise<GoogleNewsArticle[]> {
  const url = buildGoogleNewsUrl(query);
  logger.debug('Fetching Google News query', { query, url });

  try {
    const feed = await rssParser.parseURL(url);
    const articles: GoogleNewsArticle[] = [];

    for (const item of feed.items ?? []) {
      const rawTitle = item.title ?? '';
      const itemAny = item as unknown as Record<string, unknown>;
      const publisher = extractPublisher(
        rawTitle,
        itemAny['sourceTag'] as string | undefined
      );
      const title = cleanTitle(rawTitle);
      const snippet = stripHtml(item.contentSnippet ?? item.content ?? '').slice(0, 500);
      const combinedText = `${title} ${snippet}`;

      // Apply dual-group keyword filter
      if (!matchesDualGroupKeywords(combinedText)) {
        continue;
      }

      // Use the Google News redirect URL as-is (unique per article)
      const link = item.link ?? '';
      if (!link) continue;

      articles.push({
        title,
        link,
        sourceName: SOURCE_NAMES.GOOGLE_NEWS,
        publishedAt: item.isoDate ?? item.pubDate ?? new Date().toISOString(),
        content: snippet,
        snippet,
        publisher,
      });
    }

    logger.debug('Google News query complete', {
      query,
      matched: articles.length,
      total: feed.items?.length ?? 0,
    });

    return articles;
  } catch (error) {
    logger.error('Google News query failed', {
      query,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

// ─── Main Collector ──────────────────────────────────────────────────────────

/**
 * Collect articles from Google News RSS for all configured search queries.
 * Deduplicates by URL within the batch before returning.
 */
export async function collectFromGoogleNews(): Promise<GoogleNewsArticle[]> {
  logger.info('Starting Google News collection', { queryCount: GOOGLE_NEWS_QUERIES.length });

  const allArticles: GoogleNewsArticle[] = [];
  const seenLinks = new Set<string>();

  for (const query of GOOGLE_NEWS_QUERIES) {
    const articles = await fetchGoogleNewsQuery(query);

    for (const article of articles) {
      if (!seenLinks.has(article.link)) {
        seenLinks.add(article.link);
        allArticles.push(article);
      }
    }

    await sleep(RATE_LIMITS.GOOGLE_NEWS_DELAY_MS);
  }

  logger.info('Google News collection complete', {
    totalArticles: allArticles.length,
    uniqueLinks: seenLinks.size,
  });

  return allArticles;
}
