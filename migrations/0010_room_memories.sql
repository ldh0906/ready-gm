-- 0010_room_memories.sql — durable per-room Memory Clerk records.
--
-- Stores the room's summarized MemoryRecord list as one jsonb document per
-- room, mirroring room_blackboards. Idempotent so re-applying is safe.

CREATE TABLE IF NOT EXISTS room_memories (
  room_id     TEXT PRIMARY KEY,
  records     JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
