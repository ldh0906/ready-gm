import { cloneSinksDayState, type SinksDayState } from "../core/sinks-day-state.js";

/** Storage surface for a room's Until It Sinks day-loop state. */
export interface SinksDayStore {
  /** Fetch the room's day state, or `undefined` when none is set. Returns a copy. */
  get(roomId: string): SinksDayState | undefined;
  /** Replace the room's day state (an independent copy is stored). */
  save(roomId: string, state: SinksDayState): void;
  /** Remove the room's day state, if present. */
  delete(roomId: string): void;
}

/** In-process {@link SinksDayStore} backed by a `Map` of room id -> day state. */
export class InMemorySinksDayStore implements SinksDayStore {
  private readonly states = new Map<string, SinksDayState>();

  get(roomId: string): SinksDayState | undefined {
    const state = this.states.get(roomId);
    return state === undefined ? undefined : cloneSinksDayState(state);
  }

  save(roomId: string, state: SinksDayState): void {
    this.states.set(roomId, cloneSinksDayState(state));
  }

  delete(roomId: string): void {
    this.states.delete(roomId);
  }
}
