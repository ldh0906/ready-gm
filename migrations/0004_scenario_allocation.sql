-- 0004_scenario_allocation.sql — scenario allocation & attribute-proposal flag.
--
-- Adds allocation/attribute_proposal_disabled columns to the scenario catalog so
-- the two optional Scenario fields (allocation rule + attribute-proposal toggle)
-- can be persisted without silent drift. `allocation` is jsonb and nullable (no
-- default); `attribute_proposal_disabled` is boolean NOT NULL DEFAULT false.
-- Additive only — the existing 9 columns are left untouched. Idempotent
-- (ADD COLUMN IF NOT EXISTS) so re-applying is safe.
-- Requirements: 1.1, 1.2, 1.3, 1.4.

ALTER TABLE scenarios
  ADD COLUMN IF NOT EXISTS allocation                   JSONB,
  ADD COLUMN IF NOT EXISTS attribute_proposal_disabled  BOOLEAN NOT NULL DEFAULT false;
