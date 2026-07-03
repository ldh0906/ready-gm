import { describe, it, expect } from "vitest";
import type { TurnState } from "../core/turn-state.js";
import { InMemoryTurnStateStore } from "./turn-state-store.js";

function makeTurnState(overrides: Partial<TurnState> = {}): TurnState {
  return {
    roomId: "room-1",
    roundNumber: 2,
    phase: "ready_check",
    readiness: [
      { playerId: "p1", status: "ready", actionKind: "confirmed_action", actionText: "Open the door" },
      { playerId: "p2", status: "not_ready", actionKind: null, actionText: null },
    ],
    actionHistory: [],
    chatLog: [{ playerId: "p1", characterName: "Borin", text: "Careful", ts: "2024-01-01T00:00:00.000Z" }],
    checks: [],
    narrativeContext: [{ round: 1, text: "The crypt yawns open." }],
    readyCheckDeadline: null,
    readyCheckTimeoutMs: 90000,
    resolutionRequested: false,
    ...overrides,
  };
}

describe("InMemoryTurnStateStore", () => {
  it("returns undefined for a room with no saved state", () => {
    const store = new InMemoryTurnStateStore();
    expect(store.get("unknown-room")).toBeUndefined();
  });

  it("round-trips a saved Turn_State by roomId (R12.1, R12.3)", () => {
    const store = new InMemoryTurnStateStore();
    const state = makeTurnState();

    store.save(state);

    expect(store.get(state.roomId)).toEqual(state);
  });

  it("overwrites the prior state on a subsequent save (persist on change, R12.3)", () => {
    const store = new InMemoryTurnStateStore();
    store.save(makeTurnState({ roundNumber: 1 }));
    store.save(makeTurnState({ roundNumber: 5, phase: "free_chat" }));

    const loaded = store.get("room-1");
    expect(loaded?.roundNumber).toBe(5);
    expect(loaded?.phase).toBe("free_chat");
  });

  it("isolates stored state from later mutation of the saved object", () => {
    const store = new InMemoryTurnStateStore();
    const state = makeTurnState();
    store.save(state);

    state.readiness[0].actionText = "MUTATED";
    state.narrativeContext.push({ round: 99, text: "injected" });

    const loaded = store.get("room-1");
    expect(loaded?.readiness[0].actionText).toBe("Open the door");
    expect(loaded?.narrativeContext).toHaveLength(1);
  });

  it("returns independent copies across reads (no shared references)", () => {
    const store = new InMemoryTurnStateStore();
    store.save(makeTurnState());

    const first = store.get("room-1");
    first?.readiness.pop();

    const second = store.get("room-1");
    expect(second?.readiness).toHaveLength(2);
  });

  it("keeps separate state per room", () => {
    const store = new InMemoryTurnStateStore();
    store.save(makeTurnState({ roomId: "a", roundNumber: 3 }));
    store.save(makeTurnState({ roomId: "b", roundNumber: 7 }));

    expect(store.get("a")?.roundNumber).toBe(3);
    expect(store.get("b")?.roundNumber).toBe(7);
  });
});
