-- 0002_clocks_scenes.sql — durable per-room Progress Clocks and Scene State.
--
-- The blackboard's Progress Clocks and Scene State were in-memory only; this
-- adds their durable tables so they survive restarts alongside the Turn_State.
-- Each is stored as a single jsonb document per room (the clocks array, or the
-- scene object), upserted on change — mirroring the turn_states table.
--
-- Idempotent (IF NOT EXISTS) so re-applying is safe.

-- Per-room active Progress Clocks (the whole array as one jsonb document).
CREATE TABLE IF NOT EXISTS room_clocks (
  room_id     TEXT PRIMARY KEY,
  clocks      JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-room current Scene State (one jsonb document per room).
CREATE TABLE IF NOT EXISTS room_scenes (
  room_id     TEXT PRIMARY KEY,
  scene       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
