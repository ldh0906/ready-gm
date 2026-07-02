import { describe, expect, it } from "vitest";
import type { TurnState } from "../core/turn-state.js";
import { serializeTurnState } from "../core/turn-state.js";
import type { Character, Player, Room } from "../services/types.js";
import { FakePgClient } from "./fake-pg.js";
import { PgRoomRepository } from "./pg-room-repository.js";
import { PgScenarioRepository } from "./pg-scenario-repository.js";
import { PgSessionSummaryRepository } from "./pg-session-summary-repository.js";
import { PgTurnStateRepository } from "./pg-turn-state-repository.js";
import type { SessionSummaryRecord } from "./types.js";

const room: Room = {
  id: "room-1",
  inviteToken: "tok-abc",
  hostPlayerId: "player-1",
  scenarioId: null,
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
  concept: "dwarf",
  attributes: { Might: 2, Agility: 0, Wits: 1, Spirit: 0 },
  confirmed: true,
};

describe("PgRoomRepository", () => {
  it("saveRoom issues a parameterized upsert", async () => {
    const db = new FakePgClient();
    await new PgRoomRepository(db).saveRoom(room);

    const call = db.lastCall!;
    expect(call.text).toContain("INSERT INTO rooms");
    expect(call.text).toContain("ON CONFLICT (id) DO UPDATE");
    expect(call.values).toEqual([
      "room-1",
      "tok-abc",
      "player-1",
      null,
      "lobby",
      6,
      "2024-01-02T03:04:05.000Z",
    ]);
  });

  it("createRoomWithHost persists room, host, initial character, and scenario selection in one transaction", async () => {
    const db = new FakePgClient();
    await new PgRoomRepository(db).createRoomWithHost({
      room,
      host: player,
      initialCharacter: character,
      scenarioId: "the-sunless-crypt",
    });

    expect(db.calls.map((call) => call.text)).toEqual([
      "BEGIN",
      expect.stringContaining("INSERT INTO rooms"),
      expect.stringContaining("INSERT INTO players"),
      expect.stringContaining("INSERT INTO characters"),
      expect.stringContaining("INSERT INTO scenario_selections"),
      "COMMIT",
    ]);
  });

  it("getRoom maps a returned row", async () => {
    const db = new FakePgClient().enqueueRows([
      {
        id: "room-1",
        invite_token: "tok-abc",
        host_player_id: "player-1",
        scenario_id: null,
        state: "lobby",
        max_players: 6,
        created_at: "2024-01-02T03:04:05.000Z",
      },
    ]);
    const found = await new PgRoomRepository(db).getRoom("room-1");
    expect(found).toEqual(room);
    expect(db.lastCall!.values).toEqual(["room-1"]);
  });

  it("getRoom returns undefined when no row", async () => {
    const db = new FakePgClient();
    expect(await new PgRoomRepository(db).getRoom("nope")).toBeUndefined();
  });

  it("getRoomByToken queries by invite_token", async () => {
    const db = new FakePgClient();
    await new PgRoomRepository(db).getRoomByToken("tok-abc");
    expect(db.lastCall!.text).toContain("WHERE invite_token = $1");
    expect(db.lastCall!.values).toEqual(["tok-abc"]);
  });

  it("savePlayer issues a parameterized upsert", async () => {
    const db = new FakePgClient();
    await new PgRoomRepository(db).savePlayer(player);
    expect(db.lastCall!.text).toContain("INSERT INTO players");
    expect(db.lastCall!.values).toEqual(["player-1", "room-1", "Aria", true, null, "connected"]);
  });

  it("joinPlayerIfRoomHasCapacity locks the room row and inserts only below capacity", async () => {
    const db = new FakePgClient()
      .enqueueRows([{ id: "room-1", state: "lobby", max_players: 2 }])
      .enqueueRows([{ count: "1" }]);
    const result = await new PgRoomRepository(db).joinPlayerIfRoomHasCapacity(player);

    expect(result).toBe("inserted");
    expect(db.calls.map((call) => call.text)).toEqual([
      "BEGIN",
      expect.stringContaining("FOR UPDATE"),
      expect.stringContaining("SELECT COUNT(*)"),
      expect.stringContaining("INSERT INTO players"),
      "COMMIT",
    ]);
  });

  it("joinPlayerIfRoomHasCapacity rolls back and reports full when capacity is reached", async () => {
    const db = new FakePgClient()
      .enqueueRows([{ id: "room-1", state: "lobby", max_players: 1 }])
      .enqueueRows([{ count: "1" }]);
    const result = await new PgRoomRepository(db).joinPlayerIfRoomHasCapacity(player);

    expect(result).toBe("full");
    expect(db.calls.map((call) => call.text)).toContain("ROLLBACK");
    expect(db.calls.some((call) => call.text.includes("INSERT INTO players"))).toBe(false);
  });

  it("listPlayers filters by room_id", async () => {
    const db = new FakePgClient();
    await new PgRoomRepository(db).listPlayers("room-1");
    expect(db.lastCall!.text).toContain("WHERE room_id = $1");
    expect(db.lastCall!.values).toEqual(["room-1"]);
  });

  it("saveCharacter passes attributes as a jsonb string param", async () => {
    const db = new FakePgClient();
    await new PgRoomRepository(db).saveCharacter(character);
    expect(db.lastCall!.text).toContain("$6::jsonb");
    expect(db.lastCall!.values?.[5]).toBe(JSON.stringify(character.attributes));
  });

  it("saveCharacterForPlayer persists the character and linked player in one transaction", async () => {
    const db = new FakePgClient();
    await new PgRoomRepository(db).saveCharacterForPlayer(character, {
      ...player,
      characterId: character.id,
    });

    expect(db.calls.map((call) => call.text)).toEqual([
      "BEGIN",
      expect.stringContaining("INSERT INTO characters"),
      expect.stringContaining("INSERT INTO players"),
      "COMMIT",
    ]);
  });

  it("listCharactersByRoom filters by room_id and maps rows", async () => {
    const db = new FakePgClient().enqueueRows([
      {
        id: "char-1",
        player_id: "player-1",
        room_id: "room-1",
        name: "Borin",
        concept: "dwarf",
        attributes: character.attributes,
        confirmed: true,
      },
    ]);
    const chars = await new PgRoomRepository(db).listCharactersByRoom("room-1");
    expect(chars).toEqual([character]);
    expect(db.lastCall!.values).toEqual(["room-1"]);
  });

  it("markRoomInSessionIfLobby uses a compare-and-set update", async () => {
    const db = new FakePgClient().enqueueRows([{ id: "room-1" }]);
    await expect(new PgRoomRepository(db).markRoomInSessionIfLobby("room-1")).resolves.toBe(true);
    expect(db.lastCall!.text).toContain("UPDATE rooms");
    expect(db.lastCall!.text).toContain("WHERE id = $1 AND state = 'lobby'");
    expect(db.lastCall!.text).toContain("RETURNING id");
  });

  it("markRoomEndedIfInSession uses a compare-and-set update", async () => {
    const db = new FakePgClient();
    await expect(new PgRoomRepository(db).markRoomEndedIfInSession("room-1")).resolves.toBe(false);
    expect(db.lastCall!.text).toContain("WHERE id = $1 AND state = 'in_session'");
    expect(db.lastCall!.text).toContain("RETURNING id");
  });
});

describe("PgTurnStateRepository", () => {
  const turnState: TurnState = {
    roomId: "room-1",
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

  it("save serializes the state into a jsonb param keyed by room", async () => {
    const db = new FakePgClient();
    await new PgTurnStateRepository(db).save(turnState);
    expect(db.lastCall!.text).toContain("INSERT INTO turn_states");
    expect(db.lastCall!.text).toContain("$2::jsonb");
    expect(db.lastCall!.values).toEqual(["room-1", serializeTurnState(turnState)]);
  });

  it("get deserializes the state column", async () => {
    const db = new FakePgClient().enqueueRows([{ state: serializeTurnState(turnState) }]);
    const found = await new PgTurnStateRepository(db).get("room-1");
    expect(found).toEqual(turnState);
    expect(db.lastCall!.values).toEqual(["room-1"]);
  });

  it("get returns undefined when no row", async () => {
    const db = new FakePgClient();
    expect(await new PgTurnStateRepository(db).get("room-1")).toBeUndefined();
  });
});

describe("PgScenarioRepository", () => {
  it("listScenarios maps rows", async () => {
    const db = new FakePgClient().enqueueRows([
      {
        id: "the-sunless-crypt",
        title: "The Sunless Crypt",
        summary: "A delve.",
        opening_seed: "Dusk.",
        ending_condition: "Escape.",
      },
    ]);
    const scenarios = await new PgScenarioRepository(db).listScenarios();
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].id).toBe("the-sunless-crypt");
  });

  it("getScenario returns undefined when unknown", async () => {
    const db = new FakePgClient();
    expect(await new PgScenarioRepository(db).getScenario("nope")).toBeUndefined();
    expect(db.lastCall!.values).toEqual(["nope"]);
  });
});

describe("PgSessionSummaryRepository", () => {
  const summary: SessionSummaryRecord = {
    roomId: "room-1",
    closingNarration: "끝.",
    summaryText: "요약.",
    createdAt: "2024-01-02T03:04:05.000Z",
  };

  it("save issues a parameterized upsert", async () => {
    const db = new FakePgClient();
    await new PgSessionSummaryRepository(db).save(summary);
    expect(db.lastCall!.text).toContain("INSERT INTO session_summaries");
    expect(db.lastCall!.values).toEqual(["room-1", "끝.", "요약.", "2024-01-02T03:04:05.000Z"]);
  });

  it("get round-trips a stored summary", async () => {
    const db = new FakePgClient().enqueueRows([
      {
        room_id: "room-1",
        closing_narration: "끝.",
        summary_text: "요약.",
        created_at: "2024-01-02T03:04:05.000Z",
      },
    ]);
    expect(await new PgSessionSummaryRepository(db).get("room-1")).toEqual(summary);
  });
});
