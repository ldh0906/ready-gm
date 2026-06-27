/**
 * Pure row <-> entity mapping for the Postgres persistence layer.
 *
 * These functions translate between domain entities and database rows, plus the
 * ordered parameter arrays for parameterized inserts. They are deliberately
 * free of any `pg` dependency so the mapping can be unit-tested against canned
 * rows with no database.
 *
 * Column naming convention: `snake_case` in SQL, `camelCase` on the entity.
 * JSON-shaped columns (`attributes`, Turn_State `state`, QA `payload`) are
 * stored as `jsonb`; insert helpers stringify them and the repositories cast
 * with `::jsonb`.
 */
import {
  deserializeTurnState,
  serializeTurnState,
  type TurnState,
} from "../core/turn-state.js";
import type { Character, Player, Room, RoomState } from "../services/types.js";
import type { Scenario } from "../services/scenario-service.js";
import type { QaEvent } from "../observability/events.js";
import type { QueryResultRow } from "./pg-client.js";
import type { SessionSummaryRecord } from "./types.js";

/* ----------------------------- value helpers ------------------------------ */

/**
 * Coerce a timestamp column to an ISO-8601 string. `pg` returns `timestamptz`
 * columns as {@link Date} objects; ISO strings pass through unchanged. Any other
 * type is a programming error and throws.
 */
export function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  throw new TypeError(`Expected a Date or ISO string, got ${typeof value}`);
}

/**
 * Read a `json`/`jsonb` column. `pg` parses these to objects automatically, but
 * accept a raw JSON string too (and for stringified test fixtures).
 */
export function parseJsonColumn<T>(value: unknown): T {
  return (typeof value === "string" ? (JSON.parse(value) as T) : (value as T));
}

/** Serialize a value for a `json`/`jsonb` parameter. */
export function toJsonParam(value: unknown): string {
  return JSON.stringify(value);
}

/* ---------------------------------- Room ----------------------------------- */

export function roomToRow(room: Room): unknown[] {
  return [
    room.id,
    room.inviteToken,
    room.hostPlayerId,
    room.scenarioId,
    room.state,
    room.maxPlayers,
    room.createdAt,
  ];
}

export function rowToRoom(row: QueryResultRow): Room {
  return {
    id: row.id as string,
    inviteToken: row.invite_token as string,
    hostPlayerId: row.host_player_id as string,
    scenarioId: (row.scenario_id as string | null) ?? null,
    state: row.state as RoomState,
    maxPlayers: Number(row.max_players),
    createdAt: toIso(row.created_at),
  };
}

/* --------------------------------- Player ---------------------------------- */

export function playerToRow(player: Player): unknown[] {
  return [
    player.id,
    player.roomId,
    player.displayName,
    player.isHost,
    player.characterId,
    player.connectionStatus,
  ];
}

export function rowToPlayer(row: QueryResultRow): Player {
  return {
    id: row.id as string,
    roomId: row.room_id as string,
    displayName: row.display_name as string,
    isHost: Boolean(row.is_host),
    characterId: (row.character_id as string | null) ?? null,
    connectionStatus: row.connection_status as Player["connectionStatus"],
  };
}

/* -------------------------------- Character -------------------------------- */

export function characterToRow(character: Character): unknown[] {
  return [
    character.id,
    character.playerId,
    character.roomId,
    character.name,
    character.concept,
    toJsonParam(character.attributes),
    character.confirmed,
  ];
}

export function rowToCharacter(row: QueryResultRow): Character {
  return {
    id: row.id as string,
    playerId: row.player_id as string,
    roomId: row.room_id as string,
    name: row.name as string,
    concept: row.concept as string,
    attributes: parseJsonColumn(row.attributes),
    confirmed: Boolean(row.confirmed),
  };
}

/* -------------------------------- Scenario --------------------------------- */

export function scenarioToRow(scenario: Scenario): unknown[] {
  return [
    scenario.id,
    scenario.title,
    scenario.summary,
    scenario.openingSeed,
    scenario.endingCondition,
  ];
}

export function rowToScenario(row: QueryResultRow): Scenario {
  return {
    id: row.id as string,
    title: row.title as string,
    summary: row.summary as string,
    openingSeed: row.opening_seed as string,
    endingCondition: row.ending_condition as string,
  };
}

/* ----------------------------- SessionSummary ------------------------------ */

export function sessionSummaryToRow(summary: SessionSummaryRecord): unknown[] {
  return [summary.roomId, summary.closingNarration, summary.summaryText, summary.createdAt];
}

export function rowToSessionSummary(row: QueryResultRow): SessionSummaryRecord {
  return {
    roomId: row.room_id as string,
    closingNarration: row.closing_narration as string,
    summaryText: row.summary_text as string,
    createdAt: toIso(row.created_at),
  };
}

/* -------------------------------- TurnState -------------------------------- */

/** Serialize Turn_State for the `state` jsonb column (room id is param $1). */
export function turnStateToRow(turnState: TurnState): unknown[] {
  return [turnState.roomId, serializeTurnState(turnState)];
}

export function rowToTurnState(row: QueryResultRow): TurnState {
  const state = row.state;
  const json = typeof state === "string" ? state : JSON.stringify(state);
  return deserializeTurnState(json);
}

/* -------------------------------- QA events -------------------------------- */

/**
 * Ordered params for inserting a QA event: the correlation envelope split into
 * columns, with the entire event preserved verbatim in the `payload` jsonb.
 */
export function qaEventToRow(event: QaEvent): unknown[] {
  return [
    event.eventId,
    event.sessionId,
    event.roundNo,
    event.eventType,
    toIso(event.timestamp),
    toJsonParam(event),
  ];
}

/** Reconstruct a QA event from its stored `payload` column. */
export function rowToQaEvent(row: QueryResultRow): QaEvent {
  return parseJsonColumn<QaEvent>(row.payload);
}
