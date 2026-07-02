-- 0009_room_blackboards.sql — durable per-room ScenarioBlackboard.
--
-- Stores the whole ScenarioBlackboard as one jsonb document per room, mirroring
-- room_scenes and room_character_states. Idempotent so re-applying is safe.

CREATE TABLE IF NOT EXISTS room_blackboards (
  room_id     TEXT PRIMARY KEY,
  blackboard  JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
