/**
 * Turn_State Store — reads/writes the canonical per-room {@link TurnState}.
 *
 * The Turn_State is the engine's short-term memory (design.md "7. Turn_State
 * Store"). In production it lives in Redis for low-latency live reads/writes and
 * is persisted to Postgres for durability (Requirements 12.1, 12.3). To keep
 * that split clean, the store is defined behind an interface and the MVP ships
 * an in-memory implementation; a Redis-live + Postgres-durable implementation
 * can be dropped in later (task 14) without touching callers.
 *
 * The in-memory store keeps each Turn_State as its serialized JSON string — the
 * same lossless representation a Redis-backed store would hold — so reads return
 * an independent copy and external mutation can never corrupt stored state.
 *
 * Requirements: 12.1 (JSON record per active room), 12.3 (persist on change).
 */
import {
  deserializeTurnState,
  serializeTurnState,
  type TurnState,
} from "../core/turn-state.js";

/**
 * Storage surface for the canonical per-room Turn_State.
 *
 * Implementations MUST persist on every {@link TurnStateStore.save} so the live
 * and durable views never disagree (Requirement 12.3), and MUST round-trip the
 * Turn_State losslessly between storage and callers.
 */
export interface TurnStateStore {
  /**
   * Fetch the current Turn_State for a room, or `undefined` when the room has
   * no Turn_State yet (Requirement 12.1). The returned value is an independent
   * copy; mutating it does not affect stored state.
   */
  get(roomId: string): TurnState | undefined;
  /**
   * Persist a Turn_State, keyed by its own {@link TurnState.roomId}. Overwrites
   * any previously stored state for that room (Requirement 12.3).
   */
  save(turnState: TurnState): void;
}

/**
 * In-process {@link TurnStateStore} backed by a `Map` of room id → serialized
 * Turn_State JSON. Storing the serialized string mirrors how a Redis-backed
 * live store would hold the value and guarantees callers receive a fresh,
 * normalized copy on every {@link get}.
 */
export class InMemoryTurnStateStore implements TurnStateStore {
  private readonly states = new Map<string, string>();

  get(roomId: string): TurnState | undefined {
    const json = this.states.get(roomId);
    return json === undefined ? undefined : deserializeTurnState(json);
  }

  save(turnState: TurnState): void {
    this.states.set(turnState.roomId, serializeTurnState(turnState));
  }
}
