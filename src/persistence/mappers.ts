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

/**
 * Column order: 0 id, 1 player_id, 2 room_id, 3 name, 4 concept,
 * 5 attributes (jsonb), 6 confirmed, 7 selected_card_id, 8 sheet_data (jsonb).
 * The two optional original-sheet columns (migration 0007) are appended at the
 * tail; absence maps to `null` and {@link rowToCharacter} omits the keys again
 * so a round-trip yields a structurally-equal character.
 */
export function characterToRow(character: Character): unknown[] {
  return [
    character.id,
    character.playerId,
    character.roomId,
    character.name,
    character.concept,
    toJsonParam(character.attributes),
    character.confirmed,
    character.selectedCardId ?? null,
    character.sheetData !== undefined ? toJsonParam(character.sheetData) : null,
  ];
}

export function rowToCharacter(row: QueryResultRow): Character {
  const character: Character = {
    id: row.id as string,
    playerId: row.player_id as string,
    roomId: row.room_id as string,
    name: row.name as string,
    concept: row.concept as string,
    attributes: parseJsonColumn(row.attributes),
    confirmed: Boolean(row.confirmed),
  };
  if (typeof row.selected_card_id === "string" && row.selected_card_id.length > 0) {
    character.selectedCardId = row.selected_card_id;
  }
  if (row.sheet_data !== null && row.sheet_data !== undefined) {
    character.sheetData = parseJsonColumn(row.sheet_data);
  }
  return character;
}

/* -------------------------------- Scenario --------------------------------- */

/**
 * Scenario_Column_List alignment (Column_Ordering_Convention).
 *
 * The value order produced by {@link scenarioToRow} and the columns read by
 * {@link rowToScenario} MUST match `SCENARIO_INSERT_COLUMNS`
 * (pg-scenario-repository.ts) and the migration DDL
 * (`migrations/0004_scenario_allocation.sql`), in this order:
 *
 *   0 id, 1 title, 2 summary, 3 opening_seed, 4 ending_condition,
 *   5 genre, 6 category, 7 has_special_rules, 8 system,
 *   9 allocation (jsonb), 10 attribute_proposal_disabled, 11 form.
 *
 * Existing columns keep their order; the two optional fields (`allocation`,
 * `attributeProposalDisabled`) are appended at the tail, followed by `form`.
 * `form` is always present in the row mapping (like genre/category),
 * defaulting to "원샷" when the column is absent. The
 * Column_Param_Arity_Guard test asserts
 * `scenarioToRow(s).length === SCENARIO_INSERT_COLUMNS.length`.
 *
 * Optional-field round-trip: absence is preserved. A scenario without these
 * fields maps to `null` / `false` columns, and `rowToScenario` OMITS the keys
 * again so a round-trip yields a structurally-equal scenario. The `allocation`
 * payload is stored and read verbatim (no structural validation), so the
 * mapper never throws on arbitrary/invalid allocation JSON.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 5.1, 5.3.
 */
export function scenarioToRow(scenario: Scenario): unknown[] {
  return [
    scenario.id,
    scenario.title,
    scenario.summary,
    scenario.openingSeed,
    scenario.endingCondition,
    scenario.genre,
    scenario.category,
    scenario.hasSpecialRules,
    scenario.system,
    scenario.allocation !== undefined ? toJsonParam(scenario.allocation) : null,
    scenario.attributeProposalDisabled === true,
    scenario.form ?? "원샷",
  ];
}

export function rowToScenario(row: QueryResultRow): Scenario {
  const scenario: Scenario = {
    id: row.id as string,
    title: row.title as string,
    summary: row.summary as string,
    openingSeed: row.opening_seed as string,
    endingCondition: row.ending_condition as string,
    genre: (row.genre as string | undefined) ?? "",
    category: (row.category as string | undefined) ?? "",
    hasSpecialRules: (row.has_special_rules as boolean | undefined) ?? false,
    system: (row.system as string | undefined) ?? "EZFudge",
    form: (row.form as string | undefined) ?? "원샷",
  };
  // Optional allocation: preserved verbatim; key omitted when column is absent.
  if (row.allocation !== null && row.allocation !== undefined) {
    scenario.allocation = parseJsonColumn(row.allocation);
  }
  // Optional Attribute_Proposal_Disabled: only set when truthy; otherwise omit.
  if (row.attribute_proposal_disabled) {
    scenario.attributeProposalDisabled = true;
  }
  return scenario;
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
