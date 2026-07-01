/**
 * Clock Store — reads/writes the per-room set of active {@link ProgressClock}s.
 *
 * Progress Clocks are the execution device that turns Front dangers into
 * per-turn, advanceable numbers (ai-architecture.md "Progress Clock"). The
 * orchestrator supplies a room's clocks to the AI GM coordinator each round and
 * persists the engine-applied result. To keep the live/durable split clean the
 * store is defined behind an interface; the MVP ships an in-memory
 * implementation (a durable Postgres-backed store is deferred — see
 * {@link import("../ai/blackboard-scope.js")}).
 *
 * Like the Turn_State store, reads return independent copies so external
 * mutation can never corrupt stored state.
 */
import type { ProgressClock } from "../core/progress-clock.js";

/** Storage surface for a room's active Progress Clocks. */
export interface ClockStore {
  /**
   * Fetch the active clocks for a room. Returns an empty array when the room
   * has no clocks yet. The returned clocks are independent copies.
   */
  get(roomId: string): ProgressClock[];
  /** Replace the room's active clocks with `clocks` (independent copies stored). */
  save(roomId: string, clocks: readonly ProgressClock[]): void;
}

/** Defensive shallow clone of a clock (clocks are flat, plain data). */
function cloneClock(clock: ProgressClock): ProgressClock {
  return { ...clock };
}

/**
 * In-process {@link ClockStore} backed by a `Map` of room id → clock array.
 * Stores and returns clones so callers receive a fresh copy on every access.
 */
export class InMemoryClockStore implements ClockStore {
  private readonly clocks = new Map<string, ProgressClock[]>();

  get(roomId: string): ProgressClock[] {
    return (this.clocks.get(roomId) ?? []).map(cloneClock);
  }

  save(roomId: string, clocks: readonly ProgressClock[]): void {
    this.clocks.set(roomId, clocks.map(cloneClock));
  }
}
