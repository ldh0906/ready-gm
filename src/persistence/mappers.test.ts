import { describe, expect, it } from "vitest";
import type { TurnState } from "../core/turn-state.js";
import { serializeTurnState } from "../core/turn-state.js";
import type { Scenario } from "../services/scenario-service.js";
import type { Character, Player, Room } from "../services/types.js";
import { makeDiceRollEvent } from "../observability/events.js";
import {
  characterToRow,
  parseJsonColumn,
  qaEventToRow,
  roomToRow,
  rowToCharacter,
  rowToPlayer,
  rowToQaEvent,
  rowToRoom,
  rowToScenario,
  rowToSessionSummary,
  rowToTurnState,
  playerToRow,
  scenarioToRow,
  sessionSummaryToRow,
  toIso,
  toJsonParam,
} from "./mappers.js";
import type { SessionSummaryRecord } from "./types.js";

const room: Room = {
  id: "room-1",
  inviteToken: "tok-abc",
  hostPlayerId: "player-1",
  scenarioId: "the-sunless-crypt",
  state: "lobby",
  maxPlayers: 6,
  createdAt: "2024-01-02T03:04:05.000Z",
};

const player: Player = {
  id: "player-1",
  roomId: "room-1",
  displayName: "Aria",
  isHost: true,
  characterId: null,
  connectionStatus: "connected",
};

const character: Character = {
  id: "char-1",
  playerId: "player-1",
  roomId: "room-1",
  name: "Borin",
  concept: "A grizzled dwarf",
  attributes: { Might: 2, Agility: 0, Wits: 1, Spirit: 0 },
  confirmed: true,
};

const scenario: Scenario = {
  id: "the-sunless-crypt",
  title: "The Sunless Crypt",
  summary: "A delve.",
  openingSeed: "Dusk over a fearful village.",
  endingCondition: "Escape or perish.",
};

describe("toIso", () => {
  it("converts a Date to an ISO string", () => {
    expect(toIso(new Date("2024-01-02T03:04:05.000Z"))).toBe("2024-01-02T03:04:05.000Z");
  });

  it("passes through an ISO string unchanged", () => {
    expect(toIso("2024-01-02T03:04:05.000Z")).toBe("2024-01-02T03:04:05.000Z");
  });

  it("throws on a non-date value", () => {
    expect(() => toIso(42)).toThrow();
  });
});

describe("parseJsonColumn / toJsonParam", () => {
  it("parses a JSON string", () => {
    expect(parseJsonColumn<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("passes through an already-parsed object", () => {
    const obj = { a: 1 };
    expect(parseJsonColumn(obj)).toBe(obj);
  });

  it("serializes a value to a JSON string", () => {
    expect(toJsonParam({ a: 1 })).toBe('{"a":1}');
  });
});

describe("room mapping", () => {
  it("maps to row params in column order", () => {
    expect(roomToRow(room)).toEqual([
      "room-1",
      "tok-abc",
      "player-1",
      "the-sunless-crypt",
      "lobby",
      6,
      "2024-01-02T03:04:05.000Z",
    ]);
  });

  it("round-trips a row (with a Date created_at) back to the entity", () => {
    const restored = rowToRoom({
      id: "room-1",
      invite_token: "tok-abc",
      host_player_id: "player-1",
      scenario_id: "the-sunless-crypt",
      state: "lobby",
      max_players: 6,
      created_at: new Date("2024-01-02T03:04:05.000Z"),
    });
    expect(restored).toEqual(room);
  });

  it("maps a null scenario_id", () => {
    const restored = rowToRoom({
      id: "room-1",
      invite_token: "tok-abc",
      host_player_id: "player-1",
      scenario_id: null,
      state: "lobby",
      max_players: 6,
      created_at: "2024-01-02T03:04:05.000Z",
    });
    expect(restored.scenarioId).toBeNull();
  });
});

describe("player mapping", () => {
  it("round-trips through row form", () => {
    const params = playerToRow(player);
    const restored = rowToPlayer({
      id: params[0],
      room_id: params[1],
      display_name: params[2],
      is_host: params[3],
      character_id: params[4],
      connection_status: params[5],
    });
    expect(restored).toEqual(player);
  });
});

describe("character mapping", () => {
  it("serializes attributes as a JSON param and round-trips", () => {
    const params = characterToRow(character);
    expect(params[5]).toBe(JSON.stringify(character.attributes));

    const restored = rowToCharacter({
      id: params[0],
      player_id: params[1],
      room_id: params[2],
      name: params[3],
      concept: params[4],
      attributes: character.attributes, // pg returns parsed jsonb
      confirmed: params[6],
    });
    expect(restored).toEqual(character);
  });

  it("parses attributes when pg returns a JSON string", () => {
    const restored = rowToCharacter({
      id: "char-1",
      player_id: "player-1",
      room_id: "room-1",
      name: "Borin",
      concept: "A grizzled dwarf",
      attributes: JSON.stringify(character.attributes),
      confirmed: true,
    });
    expect(restored.attributes).toEqual(character.attributes);
  });
});

describe("scenario mapping", () => {
  it("round-trips", () => {
    expect(scenarioToRow(scenario)).toEqual([
      "the-sunless-crypt",
      "The Sunless Crypt",
      "A delve.",
      "Dusk over a fearful village.",
      "Escape or perish.",
    ]);
    const restored = rowToScenario({
      id: "the-sunless-crypt",
      title: "The Sunless Crypt",
      summary: "A delve.",
      opening_seed: "Dusk over a fearful village.",
      ending_condition: "Escape or perish.",
    });
    expect(restored).toEqual(scenario);
  });
});

describe("session summary mapping", () => {
  const summary: SessionSummaryRecord = {
    roomId: "room-1",
    closingNarration: "막을 내립니다.",
    summaryText: "요약.",
    createdAt: "2024-01-02T03:04:05.000Z",
  };

  it("round-trips", () => {
    expect(sessionSummaryToRow(summary)).toEqual([
      "room-1",
      "막을 내립니다.",
      "요약.",
      "2024-01-02T03:04:05.000Z",
    ]);
    const restored = rowToSessionSummary({
      room_id: "room-1",
      closing_narration: "막을 내립니다.",
      summary_text: "요약.",
      created_at: new Date("2024-01-02T03:04:05.000Z"),
    });
    expect(restored).toEqual(summary);
  });
});

describe("turn_state mapping", () => {
  const turnState: TurnState = {
    roomId: "room-1",
    roundNumber: 2,
    phase: "free_chat",
    readiness: [{ playerId: "player-1", status: "ready", actionKind: "pass", actionText: null }],
    chatLog: [],
    checks: [],
    narrativeContext: [{ round: 1, text: "intro" }],
    readyCheckDeadline: null,
    readyCheckTimeoutMs: 90000,
    resolutionRequested: false,
  };

  it("deserializes from a parsed-object state column", () => {
    const restored = rowToTurnState({ state: JSON.parse(serializeTurnState(turnState)) });
    expect(restored).toEqual(turnState);
  });

  it("deserializes from a JSON-string state column", () => {
    const restored = rowToTurnState({ state: serializeTurnState(turnState) });
    expect(restored).toEqual(turnState);
  });
});

describe("qa event mapping", () => {
  it("maps to row params and reconstructs from the payload column", () => {
    const event = makeDiceRollEvent(
      { sessionId: "room-1", roundNo: 3 },
      {
        roller: "dice-service",
        expression: "uniform[-4,4]",
        range: { min: -4, max: 4 },
        rawValues: [2],
        result: 2,
        seed: 12345,
      },
      { generateId: () => "evt-1", now: () => new Date("2024-01-02T03:04:05.000Z") },
    );

    const params = qaEventToRow(event);
    expect(params[0]).toBe("evt-1");
    expect(params[1]).toBe("room-1");
    expect(params[2]).toBe(3);
    expect(params[3]).toBe("dice_roll");
    expect(params[4]).toBe("2024-01-02T03:04:05.000Z");
    expect(params[5]).toBe(JSON.stringify(event));

    expect(rowToQaEvent({ payload: event })).toEqual(event);
    expect(rowToQaEvent({ payload: JSON.stringify(event) })).toEqual(event);
  });
});
