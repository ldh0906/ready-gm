-- 0005_scenario_form.sql — scenario play-form column.
--
-- Adds a `form` column to the scenario catalog so the Scenario play form
-- (one-shot "원샷" vs campaign "캠페인") can be persisted and surfaced in the
-- lobby scenario picker without silent drift. `form` is TEXT NOT NULL DEFAULT
-- '원샷' — everything ships as a one-shot for now, so existing rows backfill to
-- the default. Additive only — the existing columns are left untouched.
-- Idempotent (ADD COLUMN IF NOT EXISTS) so re-applying is safe.
-- Requirements: scenario form metadata in the lobby scenario picker.

ALTER TABLE scenarios
  ADD COLUMN IF NOT EXISTS form TEXT NOT NULL DEFAULT '원샷';
