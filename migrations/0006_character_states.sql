-- 0006_character_states.sql — durable per-room mutable Character State.
--
-- The Living Character Sheet loop (AI proposes CharacterDelta -> server reducer
-- validates/applies -> next round's AI context) previously kept its applied
-- state only in the in-process CharacterStateStore, so it survived across
-- rounds but not across a process restart. This stores the room's whole
-- CharacterState array as one jsonb document per room (upserted on change),
-- mirroring the room_clocks / room_scenes tables, and is hydrated on startup.
--
-- Idempotent (IF NOT EXISTS) so re-applying is safe.

CREATE TABLE IF NOT EXISTS room_character_states (
  room_id     TEXT PRIMARY KEY,
  states      JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
