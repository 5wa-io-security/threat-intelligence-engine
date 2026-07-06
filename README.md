# 5WA Threat Intelligence Engine (TIE)

A data collection pipeline that aggregates, parses, and stores structured intelligence about physical cryptocurrency attacks and crimes from public sources.

Part of the [5WA ($5 Wrench Attack)](https://5wa.io) — Decentralized AI-Powered Physical Security Platform.

---

## Overview

The Threat Intelligence Engine automatically collects reports of physical attacks targeting cryptocurrency holders from multiple public sources, extracts structured data (location, attack type, amounts, victim profiles), and stores it in a PostgreSQL database via Supabase.

This data powers the 5WA platform's threat map, risk assessments, and security advisories.

### Data Sources

| Source | Type | Description |
|--------|------|-------------|
| CryptoSlate | RSS Feed | Security and crime-related articles |
| CoinTelegraph | RSS Feed | Crypto news with physical attack coverage |
| Reddit | Public API | r/CryptoCurrency, r/Bitcoin — keyword search |
| Lopp List | GitHub | Jameson Lopp's curated list of known physical Bitcoin attacks |

### Pipeline Flow

```
Sources → Collectors → Keyword Filter → Parsers → Deduplication → Supabase
```

1. **Collect** — Fetch raw data from RSS feeds, Reddit search, and GitHub
2. **Filter** — Only retain articles matching physical attack keywords
3. **Parse** — Extract structured fields (geo, amount, attack type, victim type)
4. **Deduplicate** — Check source_url against existing records
5. **Store** — Insert new incidents into the `threat_incidents` table

---

## Quick Start

### Prerequisites

- Node.js 18+ (recommended: 20 LTS)
- A [Supabase](https://supabase.com) project (free tier works)
- npm or pnpm

### Installation

```bash
git clone https://github.com/5wa-io-security/threat-intelligence-engine.git
cd threat-intelligence-engine
npm install
```

### Environment Setup

```bash
cp .env.example .env
```

Edit `.env` with your Supabase credentials:

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your-supabase-service-role-key
LOG_LEVEL=info
```

> **Note:** Use the **service role key** (not the anon key) for write access. Find it in your Supabase dashboard under Settings → API.

### Database Setup

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Paste the contents of `sql/schema.sql`
4. Click **Run**

This creates the `threat_incidents` table with all required columns, indexes, and RLS policies.

### Run Manually

```bash
npm run collect
```

This executes the full pipeline once and outputs structured JSON logs.

### Development Mode

```bash
npm run dev
```

Runs with file watching for development (auto-restarts on changes).

---

## Project Structure

```
threat-intelligence-engine/
├── src/
│   ├── index.ts              # Main entry — orchestrates the pipeline
│   ├── collectors/
│   │   ├── rss-collector.ts  # CryptoSlate + CoinTelegraph RSS feeds
│   │   ├── reddit-collector.ts # Reddit public search API
│   │   └── lopp-list-collector.ts # Jameson Lopp's GitHub list parser
│   ├── parsers/
│   │   ├── incident-parser.ts # Structured data extraction (attack type, amount, etc.)
│   │   └── geo-parser.ts     # Country/city extraction from text
│   ├── database/
│   │   ├── supabase-client.ts # Supabase connection singleton
│   │   └── operations.ts     # CRUD, deduplication, batch inserts
│   └── utils/
│       ├── logger.ts         # JSON structured logging
│       └── constants.ts      # Keywords, patterns, configuration
├── sql/
│   └── schema.sql            # Supabase table creation SQL
├── .github/
│   └── workflows/
│       └── collect-threats.yml # GitHub Actions daily cron
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

## Data Schema

### `threat_incidents` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key (auto-generated) |
| `title` | TEXT | Headline or summary of the incident |
| `source_url` | TEXT | Original article/post URL (unique constraint) |
| `source_name` | TEXT | Source identifier (CryptoSlate, Reddit, etc.) |
| `published_at` | TIMESTAMPTZ | When the incident was reported |
| `country` | TEXT | Country where the attack occurred |
| `city` | TEXT | City (nullable, if known) |
| `amount_usd` | NUMERIC | Stolen/demanded amount in USD (nullable) |
| `attack_type` | TEXT | Classification enum (see below) |
| `victim_type` | TEXT | Victim classification enum (see below) |
| `description` | TEXT | Brief summary of what happened |
| `raw_content` | TEXT | Full scraped text for reference |
| `tags` | TEXT[] | Array of relevant tags |
| `created_at` | TIMESTAMPTZ | Record creation time |
| `updated_at` | TIMESTAMPTZ | Last update time (auto-updated) |

### Attack Types

| Value | Description |
|-------|-------------|
| `kidnapping` | Victim abducted or held hostage |
| `home_invasion` | Attacker entered victim's residence |
| `robbery` | Theft with force or threat of force |
| `carjacking` | Vehicle-related attack |
| `extortion` | Blackmail or ransom demand |
| `assault` | Physical violence (including wrench attacks) |
| `other` | Unclassified physical attack |

### Victim Types

| Value | Description |
|-------|-------------|
| `individual` | General crypto holder/trader |
| `executive` | C-level or senior management |
| `founder` | Company/project founder |
| `employee` | Company employee |
| `exchange_staff` | Cryptocurrency exchange worker |
| `other` | Unclassified |

---

## GitHub Actions (Automated Collection)

The pipeline runs automatically every day at 00:00 UTC via GitHub Actions.

### Setup

1. Go to your repository **Settings → Secrets and variables → Actions**
2. Add the following repository secrets:

| Secret | Value |
|--------|-------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_KEY` | Your Supabase service role key |

### Manual Trigger

You can also trigger a collection run manually:

1. Go to **Actions** tab in GitHub
2. Select "Collect Threat Intelligence" workflow
3. Click **Run workflow**
4. Optionally select a log level (debug for verbose output)

### Workflow Schedule

- **Frequency:** Daily at 00:00 UTC
- **Timeout:** 15 minutes
- **Node.js:** v20 LTS

---

## Configuration

### Keywords

Physical attack keywords are defined in `src/utils/constants.ts`. The system uses these to:

1. **Filter** RSS/Reddit results (only store relevant articles)
2. **Classify** attack types based on keyword frequency
3. **Identify** victim types from contextual clues

### Rate Limiting

| Source | Delay | Notes |
|--------|-------|-------|
| Reddit | 2s between requests | Respects public API limits |
| RSS | 1s between feeds | Prevents aggressive crawling |
| Supabase | 50 records/batch | Avoids payload size limits |

### Logging

Set `LOG_LEVEL` environment variable:

- `debug` — All messages including parsed data details
- `info` — Pipeline progress and summaries (default)
- `warn` — Potential issues that don't stop execution
- `error` — Failures that may cause data loss

---

## How It Works

### Keyword Filtering

Articles must contain at least one physical attack keyword to be stored. This prevents cyber-only incidents (hacks, exploits, rug pulls) from polluting the dataset.

### Geo Parsing

The geo parser uses a predefined dictionary of countries and major cities. It scans text for location mentions and returns the first match. US state names are also recognized and mapped to "United States."

### Amount Extraction

Regex patterns detect monetary values in various formats:
- `$1,000,000` or `$1.5M`
- `1 million USD` or `500,000 dollars`
- `worth $2M` or `stole $50,000`

The largest amount found is stored (assumed to be the total loss).

### Attack Type Classification

Each attack type has associated keywords. The system counts keyword matches and assigns the type with the highest score. If no keywords match, the type defaults to `other`.

### Deduplication

Before inserting, the pipeline queries existing `source_url` values. Only new URLs are inserted. The database also has a unique constraint on `source_url` as a safety net.

---

## Future Roadmap

- [ ] **LLM-Powered Classification** — Use GPT/Claude for more accurate attack type and severity classification
- [ ] **Telegram Bot Integration** — Real-time alerts when new high-severity incidents are detected
- [ ] **Threat Map API** — RESTful API endpoint for the 5WA platform dashboard
- [ ] **Historical Backfill** — One-time import of all historical Lopp list entries
- [ ] **Additional Sources** — The Block, Decrypt, local news RSS feeds
- [ ] **Severity Scoring** — Automated risk scoring based on amount, weapon use, and outcome
- [ ] **Victim Notification** — Anonymous tip system for unreported incidents
- [ ] **Geospatial Analysis** — Heatmap generation and regional trend detection
- [ ] **Multi-language Support** — Parse non-English sources (Spanish, Portuguese, Russian)

---

## Contributing

This is an internal 5WA project. For security concerns or data corrections, contact [team@5wa.io](mailto:team@5wa.io).

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

Built with care by the [5WA Security Team](https://5wa.io) for a safer crypto ecosystem.
