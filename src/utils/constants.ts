/**
 * Constants and configuration for the Threat Intelligence Engine.
 * Defines keywords, attack type mappings, and data source URLs.
 */

// ─── Data Source URLs ────────────────────────────────────────────────────────

export const RSS_FEEDS: Record<string, string> = {
  CRYPTOSLATE: 'https://cryptoslate.com/feed/',
  COINTELEGRAPH: 'https://cointelegraph.com/rss',
  COINDESK: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
  THE_BLOCK: 'https://www.theblock.co/rss.xml',
  DECRYPT: 'https://decrypt.co/feed',
  BLEEPING_COMPUTER: 'https://www.bleepingcomputer.com/feed/',
  BITCOIN_MAGAZINE: 'https://bitcoinmagazine.com/.rss/full/',
  CRYPTONEWS: 'https://cryptonews.com/news/feed/',
};

export const GOOGLE_NEWS_QUERIES = [
  'crypto kidnapping',
  'bitcoin robbery',
  'crypto extortion',
  'crypto home invasion',
  'crypto physical attack',
  'bitcoin ransom',
  'cryptocurrency assault',
  'crypto trader kidnapped',
  'bitcoin holder robbed',
  'crypto wrench attack',
] as const;

export const REDDIT_SUBREDDITS = ['CryptoCurrency', 'Bitcoin', 'CryptoTechnology'] as const;

export const LOPP_LIST_URL =
  'https://raw.githubusercontent.com/jlopp/physical-bitcoin-attacks/master/README.md';

// ─── Dual-Group Keyword Matching ─────────────────────────────────────────────
// An article must match AT LEAST ONE keyword from EACH group to be stored.
// Group A: Physical threat indicators
// Group B: Crypto/financial context indicators
// This prevents false positives from generic crime news AND from crypto-only
// hacks/exploits that contain no physical threat language.

/**
 * Group A — Physical threat keywords.
 * At least one must appear in the article text.
 */
export const PHYSICAL_THREAT_KEYWORDS: readonly string[] = [
  // Kidnapping / abduction
  'kidnap',
  'kidnapping',
  'kidnapped',
  'abduct',
  'abducted',
  'abduction',
  'hostage',
  'held captive',
  'taken captive',
  'taken hostage',
  'held at gunpoint',
  // Robbery / theft
  'robbery',
  'robbed',
  'armed robbery',
  'mugging',
  'mugged',
  'hold-up',
  'holdup',
  'stick-up',
  'stickup',
  // Home invasion / break-in
  'home invasion',
  'break-in',
  'broke into',
  'burglary',
  'burglar',
  'forced entry',
  'invaded home',
  'home robbery',
  // Carjacking / vehicle
  'carjacking',
  'carjacked',
  'car-jacking',
  // Extortion / ransom
  'extortion',
  'extorted',
  'extort',
  'ransom',
  'ransom demand',
  'blackmail',
  'blackmailed',
  'death threat',
  'threatened to kill',
  // Physical violence
  'physical attack',
  'wrench attack',
  'assault',
  'assaulted',
  'beaten',
  'beat up',
  'stabbed',
  'stabbing',
  'shot',
  'shooting',
  'tortured',
  'torture',
  'gunpoint',
  'knifepoint',
  'tied up',
  'bound and gagged',
  'pistol-whipped',
  'murdered',
  'murder',
  'killed',
  'death',
  // Coercion
  'forced to transfer',
  'forced to send',
  'coerced',
  'threatened',
  'at gunpoint',
  'at knifepoint',
  'under duress',
];

/**
 * Group B — Crypto/financial context keywords.
 * At least one must appear in the article text alongside a Group A keyword.
 */
export const CRYPTO_CONTEXT_KEYWORDS: readonly string[] = [
  // Currencies
  'bitcoin',
  'btc',
  'ethereum',
  'eth',
  'crypto',
  'cryptocurrency',
  'cryptocurrencies',
  'digital currency',
  'digital asset',
  'altcoin',
  'stablecoin',
  'usdt',
  'usdc',
  'monero',
  'xmr',
  'litecoin',
  'ltc',
  'ripple',
  'xrp',
  'solana',
  'sol',
  // Wallets / storage
  'wallet',
  'hardware wallet',
  'ledger',
  'trezor',
  'seed phrase',
  'private key',
  'cold storage',
  'hot wallet',
  'crypto wallet',
  // Participants
  'trader',
  'investor',
  'holder',
  'whale',
  'miner',
  'hodler',
  'crypto owner',
  'bitcoin owner',
  'crypto user',
  'exchange',
  'otc',
  'defi',
  'nft',
  // Platforms
  'binance',
  'coinbase',
  'kraken',
  'bybit',
  'okx',
  'huobi',
  'gemini',
  'blockchain',
];

// ─── Dual-Group Matcher Function ────────────────────────────────────────────

/**
 * Returns true if the text contains at least one keyword from Group A
 * (physical threat) AND at least one keyword from Group B (crypto context).
 *
 * This dual-group approach prevents:
 * - Generic crime news with no crypto angle
 * - Crypto hack/exploit news with no physical threat
 */
export function matchesDualGroupKeywords(text: string): boolean {
  const lower = text.toLowerCase();
  const hasPhysical = PHYSICAL_THREAT_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
  if (!hasPhysical) return false;
  const hasCrypto = CRYPTO_CONTEXT_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
  return hasCrypto;
}

// Legacy combined list — kept for backward compatibility with Lopp list collector
// (which doesn't need dual-group matching since all entries are already crypto-related)
export const PHYSICAL_ATTACK_KEYWORDS: readonly string[] = [
  ...PHYSICAL_THREAT_KEYWORDS,
  'physical attack',
  'robbery',
  'kidnapping',
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
  'gunpoint',
  'knifepoint',
  'break-in',
  'burglary',
  'mugging',
  'stolen crypto',
  'crypto theft physical',
  'bitcoin robbery',
  'crypto kidnap',
  'crypto ransom',
];

// Reddit-specific search queries (shorter for API compatibility)
export const REDDIT_SEARCH_QUERIES = [
  'physical attack crypto',
  'robbery bitcoin',
  'kidnapping crypto',
  'wrench attack',
  'extortion crypto',
  'home invasion crypto',
  'ransom bitcoin',
  'crypto trader robbed',
  'bitcoin holder kidnapped',
  'crypto assault',
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
  kidnapping: [
    'kidnap', 'kidnapping', 'kidnapped', 'abduct', 'abducted', 'abduction',
    'hostage', 'held captive', 'taken hostage', 'taken captive', 'snatched',
  ],
  home_invasion: [
    'home invasion', 'break-in', 'broke into', 'burglary', 'burglar',
    'invaded home', 'forced entry', 'home robbery', 'broke into home',
  ],
  robbery: [
    'robbery', 'robbed', 'mugging', 'mugged', 'holdup', 'hold-up',
    'stick-up', 'stickup', 'armed robbery', 'gunpoint', 'knifepoint',
  ],
  carjacking: [
    'carjack', 'carjacking', 'carjacked', 'car-jack', 'car-jacking',
    'vehicle theft', 'forced from car', 'ambushed in car',
  ],
  extortion: [
    'extortion', 'extorted', 'extort', 'blackmail', 'blackmailed',
    'ransom demand', 'ransom', 'pay or else', 'threatened to release',
    'death threat', 'threatened to kill',
  ],
  assault: [
    'assault', 'assaulted', 'beaten', 'beat up', 'attacked', 'stabbed',
    'stabbing', 'shot', 'shooting', 'tortured', 'torture', 'violence',
    'wrench attack', 'pistol-whipped', 'murdered', 'killed',
  ],
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
  executive: [
    'ceo', 'cto', 'cfo', 'coo', 'chief', 'executive', 'director',
    'vp', 'vice president', 'president', 'managing director', 'c-suite',
  ],
  founder: ['founder', 'co-founder', 'cofounder', 'creator', 'co-creator'],
  employee: ['employee', 'worker', 'staff member', 'developer', 'engineer', 'analyst'],
  exchange_staff: [
    'exchange employee', 'exchange worker', 'binance staff', 'coinbase employee',
    'exchange operator', 'exchange manager',
  ],
  individual: [
    'trader', 'investor', 'holder', 'owner', 'user', 'miner', 'individual',
    'person', 'man', 'woman', 'victim', 'whale', 'hodler', 'otc trader',
  ],
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
  RSS_DELAY_MS: 1500,          // 1.5 seconds between RSS fetches
  GOOGLE_NEWS_DELAY_MS: 2000,  // 2 seconds between Google News queries
  BATCH_INSERT_SIZE: 50,       // Max records per batch insert
  MAX_RETRIES: 3,              // Max retry attempts for failed requests
  RETRY_DELAY_MS: 5000,        // 5 seconds between retries
} as const;

// ─── Source Names ────────────────────────────────────────────────────────────

export const SOURCE_NAMES = {
  CRYPTOSLATE: 'CryptoSlate',
  COINTELEGRAPH: 'CoinTelegraph',
  COINDESK: 'CoinDesk',
  THE_BLOCK: 'The Block',
  DECRYPT: 'Decrypt',
  BLEEPING_COMPUTER: 'BleepingComputer',
  BITCOIN_MAGAZINE: 'Bitcoin Magazine',
  CRYPTONEWS: 'CryptoNews',
  GOOGLE_NEWS: 'Google News',
  REDDIT: 'Reddit',
  LOPP_LIST: 'Lopp Physical Attacks List',
} as const;
