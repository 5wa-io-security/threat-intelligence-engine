-- Add nullable LLM enrichment fields to threat incidents.
-- Existing records remain valid and will keep NULL values until backfilled.

ALTER TABLE threat_incidents ADD COLUMN IF NOT EXISTS severity integer;
ALTER TABLE threat_incidents ADD COLUMN IF NOT EXISTS ai_summary text;
ALTER TABLE threat_incidents ADD COLUMN IF NOT EXISTS confidence_score float;
ALTER TABLE threat_incidents ADD COLUMN IF NOT EXISTS llm_model text;
