-- 0003_scenario_metadata.sql — scenario-adaptive sheet metadata.
--
-- Adds genre/category/special-rules/system columns to the scenario catalog so a
-- scenario can drive a scenario-specific character sheet schema (universal
-- EZFudge vs. a custom sheet). Idempotent (IF NOT EXISTS / DEFAULTs) so
-- re-applying is safe.
-- Requirements: 3.1.

ALTER TABLE scenarios
  ADD COLUMN IF NOT EXISTS genre              TEXT    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS category           TEXT    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS has_special_rules  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS system             TEXT    NOT NULL DEFAULT 'EZFudge';

-- Backfill the seeded MVP scenario's metadata (R3.1). Idempotent.
UPDATE scenarios
SET genre = '판타지 던전 탐험',
    category = '판타지 액션·탐험',
    has_special_rules = false,
    system = 'EZFudge'
WHERE id = 'the-sunless-crypt';
