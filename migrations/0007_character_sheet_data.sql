-- 0007_character_sheet_data.sql — preserve the ruleset-specific original sheet.
--
-- The Character row previously stored only id/player/room/name/concept/
-- attributes/confirmed, so two pieces of the original character sheet were lost
-- across a restart:
--   * selected_card_id — the Selected_Card on a Card_Based_Sheet (needed for
--     card-uniqueness dedup after hydration), and
--   * sheet_data — the ruleset-specific narrative fields the character screen
--     collected beyond name/concept (disposition, goal, card answers, …),
--     stored verbatim as one jsonb document (`{"narrativeFields": {...}}`).
--
-- Mutable in-session facts live in room_character_states (0006), never here.
-- Idempotent (IF NOT EXISTS) so re-applying is safe.

ALTER TABLE characters ADD COLUMN IF NOT EXISTS selected_card_id TEXT;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS sheet_data JSONB;
