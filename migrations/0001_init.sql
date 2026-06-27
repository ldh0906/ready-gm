-- 0001_init.sql — initial schema for the TRPG Session Engine durable store.
--
-- Creates the durable entity tables (rooms, players, characters, scenarios,
-- scenario_selections, session_summaries), the durable Turn_State table, and
-- the queryable QA event log. Seeds the single MVP scenario.
--
-- Written to be idempotent (IF NOT EXISTS / ON CONFLICT) so re-applying is safe.
-- Requirements: 3.1, 12.3, 15.3, 18.1, 18.2.

-- Durable entity: Room (R1.1, R1.2, R5.x, R15.6).
CREATE TABLE IF NOT EXISTS rooms (
  id              TEXT PRIMARY KEY,
  invite_token    TEXT NOT NULL UNIQUE,
  host_player_id  TEXT NOT NULL,
  scenario_id     TEXT,
  state           TEXT NOT NULL,
  max_players     INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL
);

-- Durable entity: Player (R2.6, R9.4, R13.3).
CREATE TABLE IF NOT EXISTS players (
  id                 TEXT PRIMARY KEY,
  room_id            TEXT NOT NULL,
  display_name       TEXT NOT NULL,
  is_host            BOOLEAN NOT NULL,
  character_id       TEXT,
  connection_status  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_players_room ON players (room_id);

-- Durable entity: Character (R4.2, R4.4, R4.6).
CREATE TABLE IF NOT EXISTS characters (
  id          TEXT PRIMARY KEY,
  player_id   TEXT NOT NULL,
  room_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  concept     TEXT NOT NULL,
  attributes  JSONB NOT NULL,
  confirmed   BOOLEAN NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_characters_room ON characters (room_id);

-- Durable entity: Scenario catalog (R3.1).
CREATE TABLE IF NOT EXISTS scenarios (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  summary           TEXT NOT NULL,
  opening_seed      TEXT NOT NULL,
  ending_condition  TEXT NOT NULL
);

-- Per-room scenario selection (R3.2). One selection per room.
CREATE TABLE IF NOT EXISTS scenario_selections (
  room_id      TEXT PRIMARY KEY,
  scenario_id  TEXT NOT NULL
);

-- Durable entity: Session_Summary (R15.3). One summary per room.
CREATE TABLE IF NOT EXISTS session_summaries (
  room_id            TEXT PRIMARY KEY,
  closing_narration  TEXT NOT NULL,
  summary_text       TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL
);

-- Durable Turn_State, persisted on every tracked change (R12.3). Stored as the
-- canonical serialized JSON in a jsonb column. One row per room.
CREATE TABLE IF NOT EXISTS turn_states (
  room_id     TEXT PRIMARY KEY,
  state       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Queryable QA event log (R18.1, R18.2). The correlation envelope is split into
-- columns; the full event is preserved verbatim in `payload`. `seq` gives a
-- monotonic insertion order for stable chronological tie-breaking.
CREATE TABLE IF NOT EXISTS qa_events (
  seq          BIGSERIAL,
  event_id     TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  round_no     INTEGER NOT NULL,
  event_type   TEXT NOT NULL,
  ts           TIMESTAMPTZ NOT NULL,
  payload      JSONB NOT NULL
);

-- Primary access path: any session's events per round in chronological order.
CREATE INDEX IF NOT EXISTS idx_qa_events_session_round_ts
  ON qa_events (session_id, round_no, ts, seq);

-- Seed the single team-authored MVP scenario (R3.1). Idempotent.
INSERT INTO scenarios (id, title, summary, opening_seed, ending_condition)
VALUES (
  'the-sunless-crypt',
  'The Sunless Crypt',
  'The village''s children have vanished into the old crypt beneath the chapel. A one-shot dungeon delve for 2-6 heroes, roughly two hours.',
  'Dusk over a fearful village; the chapel''s crypt stairs descend into cold dark. The party gathers at the broken seal where the children were last seen.',
  'The party escapes the crypt with the missing children, or the crypt claims them.'
)
ON CONFLICT (id) DO NOTHING;
