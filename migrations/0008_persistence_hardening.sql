-- 0008_persistence_hardening.sql — relationship, uniqueness, RLS, checks, timestamps.
--
-- Hardens the durable schema after the initial additive migrations: FK/cascade
-- behavior, DB-level uniqueness/capacity helpers, lifecycle CHECK constraints,
-- RLS/privilege posture, audit timestamps, and hot-path indexes. Written in the
-- existing idempotent style so re-applying is safe.

ALTER TABLE rooms
  ALTER COLUMN created_at SET DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE scenarios
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE scenario_selections
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE session_summaries
  ALTER COLUMN created_at SET DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE turn_states
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE room_clocks
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE room_scenes
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE room_character_states
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE qa_events
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Host is inserted in the same transaction as its room. The FK is DEFERRABLE so
-- the room row may be inserted before the host player, and ON DELETE SET NULL
-- avoids a circular delete when a room cascades to its players.
ALTER TABLE rooms ALTER COLUMN host_player_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rooms_host_player') THEN
    ALTER TABLE rooms
      ADD CONSTRAINT fk_rooms_host_player
      FOREIGN KEY (host_player_id) REFERENCES players(id)
      ON DELETE SET NULL
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_players_room') THEN
    ALTER TABLE players
      ADD CONSTRAINT fk_players_room
      FOREIGN KEY (room_id) REFERENCES rooms(id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_characters_room') THEN
    ALTER TABLE characters
      ADD CONSTRAINT fk_characters_room
      FOREIGN KEY (room_id) REFERENCES rooms(id)
      ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_characters_player') THEN
    ALTER TABLE characters
      ADD CONSTRAINT fk_characters_player
      FOREIGN KEY (player_id) REFERENCES players(id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_scenario_selections_room') THEN
    ALTER TABLE scenario_selections
      ADD CONSTRAINT fk_scenario_selections_room
      FOREIGN KEY (room_id) REFERENCES rooms(id)
      ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_session_summaries_room') THEN
    ALTER TABLE session_summaries
      ADD CONSTRAINT fk_session_summaries_room
      FOREIGN KEY (room_id) REFERENCES rooms(id)
      ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_turn_states_room') THEN
    ALTER TABLE turn_states
      ADD CONSTRAINT fk_turn_states_room
      FOREIGN KEY (room_id) REFERENCES rooms(id)
      ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_room_clocks_room') THEN
    ALTER TABLE room_clocks
      ADD CONSTRAINT fk_room_clocks_room
      FOREIGN KEY (room_id) REFERENCES rooms(id)
      ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_room_scenes_room') THEN
    ALTER TABLE room_scenes
      ADD CONSTRAINT fk_room_scenes_room
      FOREIGN KEY (room_id) REFERENCES rooms(id)
      ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_room_character_states_room') THEN
    ALTER TABLE room_character_states
      ADD CONSTRAINT fk_room_character_states_room
      FOREIGN KEY (room_id) REFERENCES rooms(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_players_room_display_name_norm
  ON players (room_id, lower(btrim(display_name)));

CREATE UNIQUE INDEX IF NOT EXISTS uq_characters_room_name_norm
  ON characters (room_id, lower(btrim(name)));

CREATE UNIQUE INDEX IF NOT EXISTS uq_characters_room_player
  ON characters (room_id, player_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_characters_room_selected_card_confirmed
  ON characters (room_id, selected_card_id)
  WHERE confirmed = true AND selected_card_id IS NOT NULL AND btrim(selected_card_id) <> '';

CREATE INDEX IF NOT EXISTS idx_characters_player ON characters (player_id);
CREATE INDEX IF NOT EXISTS idx_scenario_selections_scenario ON scenario_selections (scenario_id);
CREATE INDEX IF NOT EXISTS idx_session_summaries_room ON session_summaries (room_id);
CREATE INDEX IF NOT EXISTS idx_turn_states_room ON turn_states (room_id);
CREATE INDEX IF NOT EXISTS idx_room_clocks_room ON room_clocks (room_id);
CREATE INDEX IF NOT EXISTS idx_room_scenes_room ON room_scenes (room_id);
CREATE INDEX IF NOT EXISTS idx_room_character_states_room ON room_character_states (room_id);
CREATE INDEX IF NOT EXISTS idx_players_room_connected
  ON players (room_id, connection_status);
CREATE INDEX IF NOT EXISTS idx_characters_room_confirmed
  ON characters (room_id, confirmed);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rooms_state') THEN
    ALTER TABLE rooms
      ADD CONSTRAINT chk_rooms_state
      CHECK (state IN ('lobby', 'in_session', 'ended'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rooms_max_players') THEN
    ALTER TABLE rooms
      ADD CONSTRAINT chk_rooms_max_players
      CHECK (max_players BETWEEN 1 AND 12);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_players_connection_status') THEN
    ALTER TABLE players
      ADD CONSTRAINT chk_players_connection_status
      CHECK (connection_status IN ('connected', 'disconnected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_qa_events_round_no') THEN
    ALTER TABLE qa_events
      ADD CONSTRAINT chk_qa_events_round_no
      CHECK (round_no >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_qa_events_event_type') THEN
    ALTER TABLE qa_events
      ADD CONSTRAINT chk_qa_events_event_type
      CHECK (event_type IN (
        'dice_roll',
        'state_mutation',
        'ai_call',
        'round_timing',
        'ai_output',
        'gm_procedure'
      ));
  END IF;
END $$;

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE turn_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_clocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_character_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE
      rooms, players, characters, scenarios, scenario_selections,
      session_summaries, turn_states, room_clocks, room_scenes,
      room_character_states, qa_events
    FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE
      rooms, players, characters, scenarios, scenario_selections,
      session_summaries, turn_states, room_clocks, room_scenes,
      room_character_states, qa_events
    FROM authenticated;
  END IF;
END $$;
