-- ═══════════════════════════════════════════════════════════════════════════════
-- 5WA Threat Intelligence Engine - Database Schema
-- Run this SQL in your Supabase SQL Editor to create the required table.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Enable UUID extension (usually already enabled in Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Create the threat_incidents table ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS threat_incidents (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Core fields
  title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_name TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,

  -- Location
  country TEXT NOT NULL DEFAULT 'Unknown',
  city TEXT,

  -- Incident details
  amount_usd NUMERIC,
  attack_type TEXT NOT NULL DEFAULT 'other'
    CHECK (attack_type IN ('kidnapping', 'home_invasion', 'robbery', 'carjacking', 'extortion', 'assault', 'other')),
  victim_type TEXT NOT NULL DEFAULT 'individual'
    CHECK (victim_type IN ('individual', 'executive', 'founder', 'employee', 'exchange_staff', 'other')),

  -- Content
  description TEXT NOT NULL,
  raw_content TEXT,
  tags TEXT[] DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique constraint on source URL to prevent duplicates
  CONSTRAINT unique_source_url UNIQUE (source_url)
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

-- Index for deduplication lookups
CREATE INDEX IF NOT EXISTS idx_threat_incidents_source_url
  ON threat_incidents (source_url);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_threat_incidents_published_at
  ON threat_incidents (published_at DESC);

-- Index for filtering by attack type
CREATE INDEX IF NOT EXISTS idx_threat_incidents_attack_type
  ON threat_incidents (attack_type);

-- Index for filtering by country
CREATE INDEX IF NOT EXISTS idx_threat_incidents_country
  ON threat_incidents (country);

-- Index for filtering by source
CREATE INDEX IF NOT EXISTS idx_threat_incidents_source_name
  ON threat_incidents (source_name);

-- GIN index for tag-based queries
CREATE INDEX IF NOT EXISTS idx_threat_incidents_tags
  ON threat_incidents USING GIN (tags);

-- ─── Auto-update updated_at trigger ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_threat_incidents_updated_at
  BEFORE UPDATE ON threat_incidents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─── Row Level Security (RLS) ────────────────────────────────────────────────
-- Enable RLS but allow service role full access

ALTER TABLE threat_incidents ENABLE ROW LEVEL SECURITY;

-- Policy: Allow service role to do everything
CREATE POLICY "Service role has full access"
  ON threat_incidents
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Policy: Allow anonymous read access (for public dashboard)
CREATE POLICY "Public read access"
  ON threat_incidents
  FOR SELECT
  USING (true);

-- ─── Comments ────────────────────────────────────────────────────────────────

COMMENT ON TABLE threat_incidents IS '5WA Threat Intelligence Engine - Stores structured data about physical crypto attacks and crimes.';
COMMENT ON COLUMN threat_incidents.attack_type IS 'Type of physical attack: kidnapping, home_invasion, robbery, carjacking, extortion, assault, other';
COMMENT ON COLUMN threat_incidents.victim_type IS 'Type of victim: individual, executive, founder, employee, exchange_staff, other';
COMMENT ON COLUMN threat_incidents.amount_usd IS 'Estimated USD value stolen or demanded (nullable if unknown)';
COMMENT ON COLUMN threat_incidents.tags IS 'Array of relevant tags for categorization and search';
