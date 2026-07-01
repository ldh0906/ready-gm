/**
 * Persistence-layer interfaces: async durable repositories and the queryable
 * QA event sink.
 *
 * The synchronous service interfaces ({@link RoomStore}, {@link TurnStateStore},
 * {@link ScenarioStore}) stay as-is; this layer exposes async repositories that
 * do the real Postgres I/O, plus a {@link QueryableEventSink} that adds durable
 * time-ordered queries on top of the best-effort {@link EventSink}.
 *
 * Requirements: 3.1 (scenario listing), 12.3 (Turn_State persisted on change),
 * 15.3 (Session_Summary persisted per room), 18.1, 18.2 (queryable QA events).
 */
import type { Character, Player, Room } from "../services/types.js";
import type { Scenario } from "../services/scenario-service.js";
import type { TurnState } from "../core/turn-state.js";
import type { ProgressClock } from "../core/progress-clock.js";
import type { SceneState } from "../core/scene-state.js";
import type { EventSink } from "../observability/event-sink.js";
import type { QaEvent } from "../observability/events.js";

/**
 * The end-of-session recap persisted with a Room (Requirement 15.3). Mirrors the
 * design's `SessionSummary` durable entity.
 */
export interface SessionSummaryRecord {
  /** The Room this summary belongs to (1:1 with the ended Room). */
  roomId: string;
  /** The AI GM's Korean closing narration (Requirement 15.1). */
  closingNarration: string;
  /** The AI GM's recap of the session's key events (Requirement 15.2). */
  summaryText: string;
  /** ISO timestamp of when the summary was persisted (Requirement 15.3). */
  createdAt: string;
}

/**
 * Async durable repository for {@link Room}, {@link Player}, and
 * {@link Character} records — the Postgres analogue of the synchronous
 * {@link RoomStore}. Saves upsert on the primary key so repeated writes are
 * idempotent. `listRooms`/`listAllPlayers`/`listAllCharacters` support hydrating
 * the live cache on startup.
 */
export interface RoomRepository {
  saveRoom(room: Room): Promise<void>;
  getRoom(roomId: string): Promise<Room | undefined>;
  getRoomByToken(token: string): Promise<Room | undefined>;
  listRooms(): Promise<Room[]>;
  savePlayer(player: Player): Promise<void>;
  getPlayer(playerId: string): Promise<Player | undefined>;
  listPlayers(roomId: string): Promise<Player[]>;
  listAllPlayers(): Promise<Player[]>;
  saveCharacter(character: Character): Promise<void>;
  getCharacter(characterId: string): Promise<Character | undefined>;
  listCharactersByRoom(roomId: string): Promise<Character[]>;
  listAllCharacters(): Promise<Character[]>;
}

/**
 * Async durable repository for the per-room Turn_State (Requirement 12.3).
 * Round-trips the Turn_State losslessly via the core serializer. `listAll`
 * supports hydrating the live cache on startup.
 */
export interface TurnStateRepository {
  get(roomId: string): Promise<TurnState | undefined>;
  save(turnState: TurnState): Promise<void>;
  listAll(): Promise<TurnState[]>;
}

/**
 * Async durable repository for the scenario catalog listing (Requirement 3.1)
 * and per-room scenario selection (Requirement 3.2).
 */
export interface ScenarioRepository {
  listScenarios(): Promise<Scenario[]>;
  getScenario(id: string): Promise<Scenario | undefined>;
  getSelection(roomId: string): Promise<string | null>;
  setSelection(roomId: string, scenarioId: string): Promise<void>;
}

/**
 * Async durable repository for the end-of-session {@link SessionSummaryRecord}
 * (Requirement 15.3). One summary per room (upsert by `roomId`).
 */
export interface SessionSummaryRepository {
  save(summary: SessionSummaryRecord): Promise<void>;
  get(roomId: string): Promise<SessionSummaryRecord | undefined>;
}

/**
 * A durable {@link EventSink} that additionally supports time-ordered queries
 * of the recorded QA events, keyed by session and by round (Requirements 18.1,
 * 18.2). Query results are ordered chronologically by `ts`, with insertion
 * order (`seq`) as a stable tie-break.
 */
export interface QueryableEventSink extends EventSink {
  /** All recorded events for a session, ordered by timestamp then insertion. */
  queryBySession(sessionId: string): Promise<QaEvent[]>;
  /** Events for a single session+round, ordered by timestamp then insertion. */
  queryByRound(sessionId: string, roundNo: number): Promise<QaEvent[]>;
}

/** A persisted per-room Progress Clock set, keyed by room. */
export interface ClockRecord {
  roomId: string;
  clocks: ProgressClock[];
}

/**
 * Async durable repository for the per-room active Progress Clocks. The whole
 * clock array is stored as one jsonb document, upserted by `roomId`. `listAll`
 * supports hydrating the live cache on startup.
 */
export interface ClockRepository {
  get(roomId: string): Promise<ProgressClock[]>;
  save(roomId: string, clocks: readonly ProgressClock[]): Promise<void>;
  listAll(): Promise<ClockRecord[]>;
}

/** A persisted per-room Scene State, keyed by room. */
export interface SceneRecord {
  roomId: string;
  scene: SceneState;
}

/**
 * Async durable repository for the per-room Scene State. One scene document per
 * room (upsert by `roomId`). `listAll` supports hydrating the live cache.
 */
export interface SceneRepository {
  get(roomId: string): Promise<SceneState | undefined>;
  save(roomId: string, scene: SceneState): Promise<void>;
  listAll(): Promise<SceneRecord[]>;
}
