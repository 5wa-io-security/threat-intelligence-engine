/**
 * Lopp List Collector - Parses Jameson Lopp's physical Bitcoin attacks list from GitHub.
 * Source: https://github.com/jlopp/physical-bitcoin-attacks
 *
 * The list is a Markdown file with entries in a table format:
 * | Date | Victim | Location | Description | Source |
 */

import { createLogger } from '../utils/logger.js';
import { LOPP_LIST_URL, SOURCE_NAMES } from '../utils/constants.js';

const logger = createLogger('lopp-list-collector');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LoppListEntry {
  title: string;
  link: string;
  sourceName: string;
  publishedAt: string;
  content: string;
  snippet: string;
  location: string;
  victim: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse a date string from the Lopp list format.
 * Handles formats like "January 2, 2024" or "2024-01-02" or "February 2024"
 */
function parseDate(dateStr: string): string {
  const trimmed = dateStr.trim();

  // Try ISO format first
  const isoDate = new Date(trimmed);
  if (!isNaN(isoDate.getTime())) {
    return isoDate.toISOString();
  }

  // Try "Month Year" format (no day)
  const monthYearMatch = trimmed.match(/^(\w+)\s+(\d{4})$/);
  if (monthYearMatch) {
    const parsed = new Date(`${monthYearMatch[1]} 1, ${monthYearMatch[2]}`);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  // Try "Month Day, Year" format
  const fullDateMatch = trimmed.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (fullDateMatch) {
    const parsed = new Date(`${fullDateMatch[1]} ${fullDateMatch[2]}, ${fullDateMatch[3]}`);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  // Fallback: return current date
  logger.debug('Could not parse date, using current', { dateStr: trimmed });
  return new Date().toISOString();
}

/**
 * Extract the URL from a Markdown link [text](url) or plain URL.
 */
function extractUrl(text: string): string {
  // Markdown link format: [text](url)
  const mdLinkMatch = text.match(/\[([^\]]*)\]\(([^)]+)\)/);
  if (mdLinkMatch) {
    return mdLinkMatch[2];
  }

  // Plain URL
  const urlMatch = text.match(/(https?:\/\/[^\s)]+)/);
  if (urlMatch) {
    return urlMatch[1];
  }

  return '';
}

/**
 * Extract link text from Markdown link [text](url).
 */
function extractLinkText(text: string): string {
  const mdLinkMatch = text.match(/\[([^\]]*)\]\([^)]+\)/);
  if (mdLinkMatch) {
    return mdLinkMatch[1];
  }
  return text.replace(/\[|\]|\(|\)/g, '').trim();
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse the Markdown table from Lopp's physical attacks list.
 * The table has columns: Date | Victim(s) | Location | Description | Source
 */
function parseMarkdownTable(markdown: string): LoppListEntry[] {
  const entries: LoppListEntry[] = [];
  const lines = markdown.split('\n');

  let inTable = false;
  let headerParsed = false;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Detect table rows (start with |)
    if (!trimmedLine.startsWith('|')) {
      if (inTable && headerParsed) {
        // Table ended
        inTable = false;
        headerParsed = false;
      }
      continue;
    }

    // Skip separator rows (|---|---|...)
    if (trimmedLine.match(/^\|[\s-:|]+\|$/)) {
      inTable = true;
      continue;
    }

    // Skip header row
    if (!headerParsed && inTable) {
      // Check if this looks like a header
      if (trimmedLine.toLowerCase().includes('date') || trimmedLine.toLowerCase().includes('victim')) {
        headerParsed = true;
        continue;
      }
      headerParsed = true;
    }

    if (!inTable) {
      // First | row we encounter starts the table
      if (trimmedLine.toLowerCase().includes('date') || trimmedLine.toLowerCase().includes('victim')) {
        inTable = true;
        headerParsed = true;
        continue;
      }
      inTable = true;
    }

    // Parse data row
    const cells = trimmedLine
      .split('|')
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0);

    if (cells.length < 4) continue;

    const [dateCell, victimCell, locationCell, descriptionCell, sourceCell] = cells;

    const sourceUrl = extractUrl(sourceCell ?? descriptionCell ?? '');
    const description = extractLinkText(descriptionCell ?? '');
    const victim = extractLinkText(victimCell ?? '');
    const location = extractLinkText(locationCell ?? '');

    // Build a meaningful title
    const title = description
      ? `${description.slice(0, 120)}`
      : `Physical attack on ${victim} in ${location}`;

    if (!sourceUrl && !description) continue; // Skip empty/invalid rows

    entries.push({
      title,
      link: sourceUrl || `https://github.com/jlopp/physical-bitcoin-attacks#${dateCell?.replace(/\s/g, '-')}`,
      sourceName: SOURCE_NAMES.LOPP_LIST,
      publishedAt: parseDate(dateCell ?? ''),
      content: `Victim: ${victim}. Location: ${location}. ${description}`,
      snippet: `${victim} - ${location}: ${description}`.slice(0, 500),
      location,
      victim,
    });
  }

  return entries;
}

// ─── Main Collector ──────────────────────────────────────────────────────────

/**
 * Fetch and parse Jameson Lopp's physical Bitcoin attacks list from GitHub.
 */
export async function collectFromLoppList(): Promise<LoppListEntry[]> {
  logger.info('Starting Lopp list collection', { url: LOPP_LIST_URL });

  try {
    const response = await fetch(LOPP_LIST_URL, {
      headers: {
        'User-Agent': '5WA-ThreatIntelligenceEngine/1.0 (+https://5wa.io)',
        Accept: 'text/plain',
      },
    });

    if (!response.ok) {
      logger.error('Failed to fetch Lopp list', {
        status: response.status,
        statusText: response.statusText,
      });
      return [];
    }

    const markdown = await response.text();
    logger.info('Lopp list fetched', { contentLength: markdown.length });

    const entries = parseMarkdownTable(markdown);

    logger.info('Lopp list parsing complete', { totalEntries: entries.length });

    return entries;
  } catch (error) {
    logger.error('Lopp list collection failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
