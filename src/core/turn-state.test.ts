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
    actionHistory: [],
    chatLog: [
      { playerId: "p1", characterName: "Borin", text: "I draw my axe.", ts: "2024-01-01T00:00:01.000Z" },
      { playerId: "p2", characterName: "Aria", text: "Wait!", ts: "2024-01-01T00:00:02.000Z" },
    ],
    checks: [
      { characterId: "c1", attribute: "Might", difficulty: "Hard", roll: 2, outcome: "Success", advantage: "none", rolls: [2], visibility: "player" },
      { characterId: "c2", attribute: "Wits", difficulty: "Average", roll: -1, outcome: "Failure", advantage: "none", rolls: [-1], visibility: "gm" },
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
      actionHistory: [],
      chatLog: [],
      checks: [],
      narrativeContext: [],
      readyCheckDeadline: null,
      readyCheckTimeoutMs: 90000,
      resolutionRequested: false,
    };
    expect(deserializeTurnState(serializeTurnState(state))).toEqual(state);
  });

  it("omits empty actionHistory in serialized JSON but restores legacy JSON with an empty array", () => {
    const json = serializeTurnState(sampleTurnState());
    expect(JSON.parse(json)).not.toHaveProperty("actionHistory");

    const restored = deserializeTurnState(json);
    expect(restored.actionHistory).toEqual([]);
  });

  it("round-trips check_result actionHistory fields", () => {
    const state = sampleTurnState();
    state.actionHistory = [
      {
        round: 2,
        playerId: "p1",
        kind: "check_result",
        text: null,
        attribute: "Wits",
        difficulty: "Average",
        roll: 1,
        outcome: "Success",
        characterName: "Display Only",
      },
    ];
    expect(deserializeTurnState(serializeTurnState(state)).actionHistory).toEqual([
      {
        round: 2,
        playerId: "p1",
        kind: "check_result",
        text: null,
        attribute: "Wits",
        difficulty: "Average",
        roll: 1,
        outcome: "Success",
      },
    ]);
  });

  it("round-trips non-empty actionHistory without display-only names", () => {
    const state = sampleTurnState();
    state.actionHistory = [
      {
        round: 2,
        playerId: "p1",
        kind: "confirmed_action",
        text: "Strike the orc",
        characterName: "Display Only",
      },
      { round: 2, playerId: "p2", kind: "auto_pass", text: "ignored" },
    ];
    const restored = deserializeTurnState(serializeTurnState(state));
    expect(restored.actionHistory).toEqual([
      { round: 2, playerId: "p1", kind: "confirmed_action", text: "Strike the orc" },
      { round: 2, playerId: "p2", kind: "auto_pass", text: null },
    ]);
  });

  it("strips extraneous keys not part of the Turn_State shape", () => {
    const polluted = JSON.stringify({ ...sampleTurnState(), bogus: "remove me" });
    const restored = deserializeTurnState(polluted);
    expect(restored).not.toHaveProperty("bogus");
    expect(restored).toEqual(sampleTurnState());
  });

  it("does not serialize display-only sceneLocation", () => {
    const state = { ...sampleTurnState(), sceneLocation: "검은 숲 입구" };
    const json = serializeTurnState(state);
    expect(JSON.parse(json)).not.toHaveProperty("sceneLocation");
    expect(deserializeTurnState(json)).not.toHaveProperty("sceneLocation");
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

  it("defaults advantage/rolls when a legacy check record omits them (lossless-with-defaults)", () => {    // A check persisted before per-check advantage existed: no advantage/rolls.
    const legacy = JSON.stringify({
      roomId: "room-legacy",
      roundNumber: 2,
      phase: "ready_check",
      readiness: [],
      chatLog: [],
      checks: [{ characterId: "c1", attribute: "Might", difficulty: "Hard", roll: 2, outcome: "Success" }],
      narrativeContext: [],
      readyCheckDeadline: null,
      readyCheckTimeoutMs: 90000,
      resolutionRequested: false,
    });
    const restored = deserializeTurnState(legacy);
    expect(restored.checks[0].advantage).toBe("none");
    expect(restored.checks[0].rolls).toEqual([2]);
    // The chosen roll is unchanged.
    expect(restored.checks[0].roll).toBe(2);
    // Legacy records predate hidden GM rolls: default to a public player check.
    expect(restored.checks[0].visibility).toBe("player");
  });

  it("round-trips a chat entry WITH displayName, preserving it", () => {
    const state = sampleTurnState();
    state.chatLog = [
      {
        playerId: "p1",
        characterName: "알렉스",
        text: "정찰한다",
        ts: "2024-01-01T00:00:01.000Z",
        displayName: "라면",
      },
    ];
    const restored = deserializeTurnState(serializeTurnState(state));
    expect(restored.chatLog[0]?.displayName).toBe("라면");
    expect(restored.chatLog[0]?.characterName).toBe("알렉스");
    expect(restored).toStrictEqual(state);
  });

  it("round-trips a chat entry WITHOUT displayName unchanged (no key introduced)", () => {
    const state = sampleTurnState();
    state.chatLog = [
      { playerId: "p1", characterName: "Borin", text: "I draw my axe.", ts: "2024-01-01T00:00:01.000Z" },
    ];
    const json = serializeTurnState(state);
    // The serialized output must not introduce a displayName key for legacy entries.
    expect(json).not.toContain("displayName");
    const restored = deserializeTurnState(json);
    expect(restored.chatLog[0]).not.toHaveProperty("displayName");
    expect(restored).toStrictEqual(state);
  });

  it("round-trips in-character chat flags only when present", () => {
    const state = sampleTurnState();
    state.chatLog = [
      {
        playerId: "p1",
        characterName: "알렉스",
        text: "누구 있어요?",
        ts: "2024-01-01T00:00:01.000Z",
        inCharacter: true,
      },
      { playerId: "p2", characterName: "Borin", text: "OOC note", ts: "2024-01-01T00:00:02.000Z" },
    ];
    state.chatHistory = [
      {
        playerId: "p3",
        characterName: "세라",
        text: "여긴 조용해요.",
        ts: "2024-01-01T00:00:03.000Z",
        inCharacter: true,
      },
      { playerId: "p4", characterName: "Dain", text: "brb", ts: "2024-01-01T00:00:04.000Z" },
    ];

    const plain = JSON.parse(serializeTurnState(state));
    expect(plain.chatLog[0]).toHaveProperty("inCharacter", true);
    expect(plain.chatLog[1]).not.toHaveProperty("inCharacter");
    expect(plain.chatHistory[0]).toHaveProperty("inCharacter", true);
    expect(plain.chatHistory[1]).not.toHaveProperty("inCharacter");

    const restored = deserializeTurnState(JSON.stringify(plain));
    expect(restored.chatLog).toEqual(state.chatLog);
    expect(restored.chatHistory).toEqual(state.chatHistory);
    expect(restored).toStrictEqual(state);
  });

  it("round-trips non-empty chatHistory losslessly (F8)", () => {
    const state = sampleTurnState();
    state.chatHistory = [
      { playerId: "p1", characterName: "Borin", text: "지난 라운드 잡담", ts: "2024-01-01T00:00:00.000Z" },
      {
        playerId: "p2",
        characterName: "알렉스",
        displayName: "라면",
        text: "ㅋㅋ",
        ts: "2024-01-01T00:00:01.000Z",
      },
    ];
    const restored = deserializeTurnState(serializeTurnState(state));
    expect(restored.chatHistory).toEqual(state.chatHistory);
    expect(restored).toStrictEqual(state);
  });

  it("omits empty/absent chatHistory in serialized JSON (F8, legacy round-trip)", () => {
    const json = serializeTurnState(sampleTurnState());
    expect(JSON.parse(json)).not.toHaveProperty("chatHistory");
    const restored = deserializeTurnState(json);
    expect(restored).not.toHaveProperty("chatHistory");
  });
});
