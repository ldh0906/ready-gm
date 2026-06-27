import { describe, expect, it, vi } from "vitest";
import type { TurnState } from "../core/turn-state.js";
import type { Character, Player, Room } from "../services/types.js";
import { PgRoomStore } from "./pg-room-store.js";
import { PgTurnStateStore } from "./pg-turn-state-store.js";
import type { RoomRepository, TurnStateRepository } from "./types.js";

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

/** In-memory fake of the async RoomRepository that records writes. */
class FakeRoomRepository implements RoomRepository {
  rooms: Room[] = [];
  players: Player[] = [];
  characters: Character[] = [];
  shouldReject = false;

  async saveRoom(r: Room): Promise<void> {
    this.reject();
    this.rooms.push(r);
  }
  async getRoom(): Promise<Room | undefined> {
    return undefined;
  }
  async getRoomByToken(): Promise<Room | undefined> {
    return undefined;
  }
  async listRooms(): Promise<Room[]> {
    return [...this.rooms];
  }
  async savePlayer(p: Player): Promise<void> {
    this.reject();
    this.players.push(p);
  }
  async getPlayer(): Promise<Player | undefined> {
    return undefined;
  }
  async listPlayers(): Promise<Player[]> {
    return [...this.players];
  }
  async listAllPlayers(): Promise<Player[]> {
    return [...this.players];
  }
  async saveCharacter(c: Character): Promise<void> {
    this.reject();
    this.characters.push(c);
  }
  async getCharacter(): Promise<Character | undefined> {
    return undefined;
  }
  async listCharactersByRoom(): Promise<Character[]> {
    return [...this.characters];
  }
  async listAllCharacters(): Promise<Character[]> {
    return [...this.characters];
  }
  private reject(): void {
    if (this.shouldReject) throw new Error("db down");
  }
}

class FakeTurnStateRepository implements TurnStateRepository {
  saved: TurnState[] = [];
  async save(state: TurnState): Promise<void> {
    this.saved.push(state);
  }
  async get(): Promise<TurnState | undefined> {
    return undefined;
  }
  async listAll(): Promise<TurnState[]> {
    return [...this.saved];
  }
}

describe("PgRoomStore", () => {
  it("serves synchronous reads from the live view and writes through to the repo", async () => {
    const repo = new FakeRoomRepository();
    const store = new PgRoomStore(repo);

    store.saveRoom(room);
    store.savePlayer(player);
    store.saveCharacter(character);

    // Synchronous reads hit the live cache immediately.
    expect(store.getRoom("room-1")).toEqual(room);
    expect(store.getRoomByToken("tok-abc")).toEqual(room);
    expect(store.getPlayer("player-1")).toEqual(player);
    expect(store.listPlayers("room-1")).toEqual([player]);
    expect(store.getCharacter("char-1")).toEqual(character);
    expect(store.listCharactersByRoom("room-1")).toEqual([character]);

    // Durable writes happen asynchronously; flush to observe them.
    await store.flush();
    expect(repo.rooms).toEqual([room]);
    expect(repo.players).toEqual([player]);
    expect(repo.characters).toEqual([character]);
  });

  it("swallows durable-write failures via onPersistError without throwing", async () => {
    const repo = new FakeRoomRepository();
    repo.shouldReject = true;
    const onPersistError = vi.fn();
    const store = new PgRoomStore(repo, { onPersistError });

    expect(() => store.saveRoom(room)).not.toThrow();
    await store.flush();

    expect(onPersistError).toHaveBeenCalledTimes(1);
    // Live read still works even though durable write failed.
    expect(store.getRoom("room-1")).toEqual(room);
  });

  it("hydrate loads durable rows into the live view", async () => {
    const repo = new FakeRoomRepository();
    repo.rooms.push(room);
    repo.players.push(player);
    repo.characters.push(character);

    const store = new PgRoomStore(repo);
    expect(store.getRoom("room-1")).toBeUndefined();

    await store.hydrate();
    expect(store.getRoom("room-1")).toEqual(room);
    expect(store.listPlayers("room-1")).toEqual([player]);
    expect(store.listCharactersByRoom("room-1")).toEqual([character]);
  });
});

describe("PgTurnStateStore", () => {
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

  it("persists on every save and reads from the live view", async () => {
    const repo = new FakeTurnStateRepository();
    const store = new PgTurnStateStore(repo);

    store.save(turnState);
    const advanced: TurnState = { ...turnState, roundNumber: 2 };
    store.save(advanced);

    expect(store.get("room-1")).toEqual(advanced);

    await store.flush();
    expect(repo.saved).toHaveLength(2);
    expect(repo.saved[1].roundNumber).toBe(2);
  });

  it("hydrate loads durable Turn_State into the live view", async () => {
    const repo = new FakeTurnStateRepository();
    repo.saved.push(turnState);
    const store = new PgTurnStateStore(repo);

    expect(store.get("room-1")).toBeUndefined();
    await store.hydrate();
    expect(store.get("room-1")).toEqual(turnState);
  });
});
