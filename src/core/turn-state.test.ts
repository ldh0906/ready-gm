import { describe, it, expect } from "vitest";
import {
  deserializeTurnState,
  serializeTurnState,
  type TurnState,
} from "./turn-state.js";

/** A representative Turn_State exercising every field and nested array. */
function sampleTurnState(): TurnState {
  return {
    roomId: "room-123",
    roundNumber: 3,
    phase: "ready_check",
    readiness: [
      { playerId: "p1", status: "ready", actionKind: "confirmed_action", actionText: "Strike the orc" },
      { playerId: "p2", status: "ready", actionKind: "pass", actionText: null },
      { playerId: "p3", status: "not_ready", actionKind: null, actionText: null },
      { playerId: "p4", status: "ready", actionKind: "auto_pass", actionText: null },
    ],
    chatLog: [
      { playerId: "p1", characterName: "Borin", text: "I draw my axe.", ts: "2024-01-01T00:00:01.000Z" },
      { playerId: "p2", characterName: "Aria", text: "Wait!", ts: "2024-01-01T00:00:02.000Z" },
    ],
    checks: [
      { characterId: "c1", attribute: "Might", difficulty: "Hard", roll: 2, outcome: "Success" },
      { characterId: "c2", attribute: "Wits", difficulty: "Average", roll: -1, outcome: "Failure" },
    ],
    narrativeContext: [
      { round: 1, text: "The party enters the crypt." },
      { round: 2, text: "A shadow stirs in the dark." },
    ],
    readyCheckDeadline: "2024-01-01T00:01:30.000Z",
    readyCheckTimeoutMs: 90000,
    resolutionRequested: false,
  };
}

describe("serializeTurnState / deserializeTurnState", () => {
  it("round-trips a fully-populated Turn_State losslessly", () => {
    const state = sampleTurnState();
    const restored = deserializeTurnState(serializeTurnState(state));
    expect(restored).toEqual(state);
  });

  it("produces valid JSON that decodes to an object", () => {
    const json = serializeTurnState(sampleTurnState());
    expect(() => JSON.parse(json)).not.toThrow();
    expect(typeof JSON.parse(json)).toBe("object");
  });

  it("preserves the required short-term-memory fields (R12.2)", () => {
    const restored = deserializeTurnState(serializeTurnState(sampleTurnState()));
    expect(restored.roundNumber).toBe(3); // round number
    expect(restored.phase).toBe("ready_check"); // phase
    expect(restored.readiness).toHaveLength(4); // per-player readiness
    // each player's pending action is preserved
    expect(restored.readiness[0]).toEqual({
      playerId: "p1",
      status: "ready",
      actionKind: "confirmed_action",
      actionText: "Strike the orc",
    });
    // recent narrative context preserved, newest last
    expect(restored.narrativeContext.at(-1)).toEqual({ round: 2, text: "A shadow stirs in the dark." });
  });

  it("handles empty arrays and null timer fields (start-of-session shape)", () => {
    const state: TurnState = {
      roomId: "room-empty",
      roundNumber: 1,
      phase: "free_chat",
      readiness: [],
      chatLog: [],
      checks: [],
      narrativeContext: [],
      readyCheckDeadline: null,
      readyCheckTimeoutMs: 90000,
      resolutionRequested: false,
    };
    expect(deserializeTurnState(serializeTurnState(state))).toEqual(state);
  });

  it("strips extraneous keys not part of the Turn_State shape", () => {
    const polluted = JSON.stringify({ ...sampleTurnState(), bogus: "remove me" });
    const restored = deserializeTurnState(polluted);
    expect(restored).not.toHaveProperty("bogus");
    expect(restored).toEqual(sampleTurnState());
  });

  it("is idempotent across repeated serialize/deserialize cycles", () => {
    const once = deserializeTurnState(serializeTurnState(sampleTurnState()));
    const twice = deserializeTurnState(serializeTurnState(once));
    expect(twice).toEqual(once);
    expect(serializeTurnState(once)).toBe(serializeTurnState(twice));
  });

  it("throws on JSON that does not decode to an object", () => {
    expect(() => deserializeTurnState("42")).toThrow(TypeError);
    expect(() => deserializeTurnState("null")).toThrow(TypeError);
  });
});
