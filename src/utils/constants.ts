/**
 * Constants and configuration for the Threat Intelligence Engine.
 * Defines keywords, attack type mappings, and data source URLs.
 */

// ─── Data Source URLs ────────────────────────────────────────────────────────

export const RSS_FEEDS = {
  CRYPTOSLATE: 'https://cryptoslate.com/feed/',
  COINTELEGRAPH: 'https://cointelegraph.com/rss',
} as const;

export const REDDIT_SUBREDDITS = ['CryptoCurrency', 'Bitcoin'] as const;

export const LOPP_LIST_URL =
  'https://raw.githubusercontent.com/jlopp/physical-bitcoin-attacks/master/README.md';

// ─── Physical Attack Keywords ────────────────────────────────────────────────
// Used to filter articles that are specifically about physical attacks
// (as opposed to hacks, exploits, or other cyber-only incidents)

export const PHYSICAL_ATTACK_KEYWORDS = [
  'physical attack',
  'robbery',
  'kidnapping',
  'kidnapped',
  'wrench attack',
  'extortion',
  'home invasion',
  'armed robbery',
  'carjacking',
  'assault',
  'abduction',
  'ransom',
  'hostage',
  'torture',
  'threatened',
  'gunpoint',
  'knifepoint',
  'forced',
  'violent',
  'beaten',
  'tied up',
  'held at',
  'break-in',
  'burglary',
  'mugging',
  'stolen crypto',
  'crypto theft physical',
  'bitcoin robbery',
  'crypto kidnap',
  'crypto ransom',
  'home robbery crypto',
  'crypto executive attack',
  'crypto trader attacked',
] as const;

// Reddit-specific search queries (shorter for API compatibility)
export const REDDIT_SEARCH_QUERIES = [
  'physical attack crypto',
  'robbery bitcoin',
  'kidnapping crypto',
  'wrench attack',
  'extortion crypto',
  'home invasion crypto',
] as const;

// ─── Attack Type Classification ──────────────────────────────────────────────

export type AttackType =
  | 'kidnapping'
  | 'home_invasion'
  | 'robbery'
  | 'carjacking'
  | 'extortion'
  | 'assault'
  | 'other';

export const ATTACK_TYPE_KEYWORDS: Record<AttackType, string[]> = {
  kidnapping: ['kidnap', 'abduct', 'hostage', 'held captive', 'taken hostage', 'snatched'],
  home_invasion: ['home invasion', 'break-in', 'broke into', 'burglary', 'burglar', 'invaded home', 'forced entry'],
  robbery: ['robbery', 'robbed', 'mugging', 'mugged', 'holdup', 'hold-up', 'stick-up', 'armed robbery', 'gunpoint'],
  carjacking: ['carjack', 'car-jack', 'vehicle theft', 'forced from car', 'ambushed in car'],
  extortion: ['extortion', 'extort', 'blackmail', 'ransom demand', 'pay or else', 'threatened to release'],
  assault: ['assault', 'beaten', 'attacked', 'stabbed', 'shot', 'tortured', 'violence', 'wrench attack'],
  other: [],
};

// ─── Victim Type Classification ──────────────────────────────────────────────

export type VictimType =
  | 'individual'
  | 'executive'
  | 'founder'
  | 'employee'
  | 'exchange_staff'
  | 'other';

export const VICTIM_TYPE_KEYWORDS: Record<VictimType, string[]> = {
  executive: ['ceo', 'cto', 'cfo', 'coo', 'chief', 'executive', 'director', 'vp', 'vice president', 'president'],
  founder: ['founder', 'co-founder', 'cofounder', 'creator', 'created'],
  employee: ['employee', 'worker', 'staff member', 'developer', 'engineer'],
  exchange_staff: ['exchange employee', 'exchange worker', 'binance staff', 'coinbase employee', 'exchange operator'],
  individual: ['trader', 'investor', 'holder', 'owner', 'user', 'miner', 'individual', 'person', 'man', 'woman', 'victim'],
  other: [],
};

// ─── Amount Parsing ──────────────────────────────────────────────────────────

export const AMOUNT_PATTERNS = [
  // $1,000,000 or $1000000 or $1.5M
  /\$\s?([\d,]+(?:\.\d+)?)\s*(million|mil|m|billion|bil|b|thousand|k)?/gi,
  // 1,000,000 USD or 1000000 dollars
  /([\d,]+(?:\.\d+)?)\s*(million|mil|m|billion|bil|b|thousand|k)?\s*(?:usd|dollars?|us dollars?)/gi,
  // X BTC/ETH worth $Y
  /worth\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(million|mil|m|billion|bil|b|thousand|k)?/gi,
  // stole/stolen X amount
  /(?:stole|stolen|took|demanded|ransom of)\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(million|mil|m|billion|bil|b|thousand|k)?/gi,
] as const;

export const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  m: 1_000_000,
  mil: 1_000_000,
  million: 1_000_000,
  b: 1_000_000_000,
  bil: 1_000_000_000,
  billion: 1_000_000_000,
};

// ─── Rate Limiting ───────────────────────────────────────────────────────────

export const RATE_LIMITS = {
  REDDIT_DELAY_MS: 2000,       // 2 seconds between Reddit requests
  RSS_DELAY_MS: 1000,          // 1 second between RSS fetches
  BATCH_INSERT_SIZE: 50,       // Max records per batch insert
  MAX_RETRIES: 3,              // Max retry attempts for failed requests
  RETRY_DELAY_MS: 5000,        // 5 seconds between retries
} as const;

// ─── Source Names ────────────────────────────────────────────────────────────

export const SOURCE_NAMES = {
  CRYPTOSLATE: 'CryptoSlate',
  COINTELEGRAPH: 'CoinTelegraph',
  REDDIT: 'Reddit',
  LOPP_LIST: 'Lopp Physical Attacks List',
} as const;
