/**
 * Reddit Collector - Searches r/CryptoCurrency and r/Bitcoin for physical attack posts.
 * Uses Reddit's public JSON API (no OAuth required for read-only public search).
 */

import { createLogger } from '../utils/logger.js';
import {
  REDDIT_SUBREDDITS,
  REDDIT_SEARCH_QUERIES,
  SOURCE_NAMES,
  RATE_LIMITS,
  matchesDualGroupKeywords,
} from '../utils/constants.js';

const logger = createLogger('reddit-collector');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RedditPost {
  title: string;
  link: string;
  sourceName: string;
  publishedAt: string;
  content: string;
  snippet: string;
  subreddit: string;
  score: number;
}

interface RedditListingChild {
  kind: string;
  data: {
    title: string;
    selftext: string;
    url: string;
    permalink: string;
    created_utc: number;
    subreddit: string;
    score: number;
    num_comments: number;
    is_self: boolean;
    link_flair_text?: string;
  };
}

interface RedditListingResponse {
  kind: string;
  data: {
    children: RedditListingChild[];
    after: string | null;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Secondary filter: verify post content actually relates to physical crypto attacks.
 * Uses dual-group matching: must have physical threat + crypto context keywords.
 */
function isPhysicalAttackRelated(title: string, content: string): boolean {
  return matchesDualGroupKeywords(`${title} ${content}`);
}

// ─── Reddit API ──────────────────────────────────────────────────────────────

/**
 * Search a subreddit for posts matching a query.
 * Uses Reddit's public JSON API endpoint.
 */
async function searchSubreddit(
  subreddit: string,
  query: string,
  timeFilter: string = 'month'
): Promise<RedditPost[]> {
  const url = new URL(`https://www.reddit.com/r/${subreddit}/search.json`);
  url.searchParams.set('q', query);
  url.searchParams.set('restrict_sr', '1');
  url.searchParams.set('sort', 'new');
  url.searchParams.set('t', timeFilter);
  url.searchParams.set('limit', '25');

  logger.debug('Searching Reddit', { subreddit, query, timeFilter });

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': '5WA-ThreatIntelligenceEngine/1.0 (by /u/5wa_security)',
        Accept: 'application/json',
      },
    });

    if (response.status === 429) {
      logger.warn('Reddit rate limit hit, backing off', { subreddit, query });
      await sleep(RATE_LIMITS.RETRY_DELAY_MS * 2);
      return [];
    }

    if (!response.ok) {
      logger.error('Reddit API error', {
        status: response.status,
        statusText: response.statusText,
        subreddit,
        query,
      });
      return [];
    }

    const data = (await response.json()) as RedditListingResponse;
    const posts: RedditPost[] = [];

    for (const child of data.data.children) {
      const post = child.data;

      // Apply secondary physical attack filter
      if (!isPhysicalAttackRelated(post.title, post.selftext)) {
        continue;
      }

      posts.push({
        title: post.title,
        link: `https://www.reddit.com${post.permalink}`,
        sourceName: SOURCE_NAMES.REDDIT,
        publishedAt: new Date(post.created_utc * 1000).toISOString(),
        content: post.selftext.slice(0, 10000),
        snippet: post.selftext.slice(0, 500) || post.title,
        subreddit: post.subreddit,
        score: post.score,
      });
    }

    return posts;
  } catch (error) {
    logger.error('Reddit search failed', {
      subreddit,
      query,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

// ─── Main Collector ──────────────────────────────────────────────────────────

/**
 * Collect posts from all configured subreddits and search queries.
 * Deduplicates by URL before returning.
 */
export async function collectFromReddit(): Promise<RedditPost[]> {
  logger.info('Starting Reddit collection');

  const allPosts: RedditPost[] = [];
  const seenUrls = new Set<string>();

  for (const subreddit of REDDIT_SUBREDDITS) {
    for (const query of REDDIT_SEARCH_QUERIES) {
      const posts = await searchSubreddit(subreddit, query, 'month');

      for (const post of posts) {
        if (!seenUrls.has(post.link)) {
          seenUrls.add(post.link);
          allPosts.push(post);
        }
      }

      // Respect rate limits between requests
      await sleep(RATE_LIMITS.REDDIT_DELAY_MS);
    }
  }

  logger.info('Reddit collection complete', {
    totalPosts: allPosts.length,
    uniqueUrls: seenUrls.size,
  });

  return allPosts;
}
