/**
 * Unit tests for the Character Service: recording, confirmation locking,
 * room-unique names, and the all-players-confirmed start gate.
 *
 * Requirements: 4.4, 4.5, 4.6, 4.7, 5.1
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AttributeKey, AttributeLevel } from "../core/types.js";
import {
  ALREADY_CONFIRMED_MESSAGE,
  CharacterService,
  NAME_TAKEN_MESSAGE,
  NOT_ALL_CONFIRMED_MESSAGE,
} from "./character-service.js";
import { InMemoryRoomStore } from "./room-store.js";
import type { Player, Room } from "./types.js";

const ATTRS: Record<AttributeKey, AttributeLevel> = {
  Might: 2,
  Agility: 1,
  Wits: 0,
  Spirit: 1,
};

function makeRoom(id: string, state: Room["state"] = "lobby"): Room {
  return {
    id,
    inviteToken: `token-${id}`,
    hostPlayerId: `${id}-host`,
    scenarioId: "the-sunless-crypt",
    state,
    maxPlayers: 6,
    createdAt: new Date("2024-01-01T00:00:00.000Z").toISOString(),
  };
}

function makePlayer(id: string, roomId: string, isHost = false): Player {
  return {
    id,
    roomId,
    displayName: id,
    isHost,
    characterId: null,
    connectionStatus: "connected",
  };
}

describe("CharacterService", () => {
  let store: InMemoryRoomStore;
  let service: CharacterService;
  let nextId: number;

  beforeEach(() => {
    store = new InMemoryRoomStore();
    nextId = 0;
    service = new CharacterService({ store, generateCharacterId: () => `char-${nextId++}` });
  });

  describe("recordCharacter (R4.5)", () => {
    it("records an editable, unconfirmed character and links it to the player", () => {
      store.saveRoom(makeRoom("r1"));
      store.savePlayer(makePlayer("p1", "r1", true));

      const result = service.recordCharacter("p1", {
        name: "Borin",
        concept: "A grizzled dwarf",
        attributes: ATTRS,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.character.confirmed).toBe(false);
      expect(result.character.name).toBe("Borin");
      expect(store.getPlayer("p1")?.characterId).toBe(result.character.id);
    });

    it("updates the same character on re-record before confirmation", () => {
      store.saveRoom(makeRoom("r1"));
      store.savePlayer(makePlayer("p1", "r1"));

      const first = service.recordCharacter("p1", { name: "Borin", concept: "v1", attributes: ATTRS });
      const second = service.recordCharacter("p1", {
        name: "Borin Stonefist",
        concept: "v2",
        attributes: { ...ATTRS, Might: 3 },
      });

      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(second.character.id).toBe(first.character.id);
      expect(second.character.name).toBe("Borin Stonefist");
      expect(store.listCharactersByRoom("r1")).toHaveLength(1);
    });

    it("rejects an unknown player", () => {
      const result = service.recordCharacter("ghost", { name: "X", concept: "", attributes: ATTRS });
      expect(result).toMatchObject({ ok: false, reason: "UNKNOWN_PLAYER" });
    });
  });

  describe("confirmation locking (R4.4)", () => {
    it("locks attributes and rejects further revision after confirmation", () => {
      store.saveRoom(makeRoom("r1"));
      store.savePlayer(makePlayer("p1", "r1"));
      service.recordCharacter("p1", { name: "Borin", concept: "c", attributes: ATTRS });

      const confirmed = service.confirmCharacter("p1");
      expect(confirmed.ok).toBe(true);
      if (!confirmed.ok) return;
      expect(confirmed.character.confirmed).toBe(true);

      const revision = service.recordCharacter("p1", {
        name: "Borin",
        concept: "changed",
        attributes: { ...ATTRS, Might: 4 },
      });
      expect(revision).toMatchObject({ ok: false, reason: "ALREADY_CONFIRMED", message: ALREADY_CONFIRMED_MESSAGE });

      // Stored attributes remain the confirmation-time values.
      expect(service.getCharacterForPlayer("p1")?.attributes.Might).toBe(ATTRS.Might);
    });

    it("re-confirming is idempotent", () => {
      store.saveRoom(makeRoom("r1"));
      store.savePlayer(makePlayer("p1", "r1"));
      service.recordCharacter("p1", { name: "Borin", concept: "c", attributes: ATTRS });

      expect(service.confirmCharacter("p1").ok).toBe(true);
      const again = service.confirmCharacter("p1");
      expect(again.ok).toBe(true);
      if (!again.ok) return;
      expect(again.character.confirmed).toBe(true);
    });

    it("rejects confirming when no character was recorded", () => {
      store.saveRoom(makeRoom("r1"));
      store.savePlayer(makePlayer("p1", "r1"));
      expect(service.confirmCharacter("p1")).toMatchObject({ ok: false, reason: "NO_CHARACTER" });
    });
  });

  describe("name uniqueness (R4.6)", () => {
    it("rejects a name already used by another character in the room", () => {
      store.saveRoom(makeRoom("r1"));
      store.savePlayer(makePlayer("p1", "r1"));
      store.savePlayer(makePlayer("p2", "r1"));
      service.recordCharacter("p1", { name: "Aria", concept: "c", attributes: ATTRS });

      const dup = service.recordCharacter("p2", { name: "Aria", concept: "c", attributes: ATTRS });
      expect(dup).toMatchObject({ ok: false, reason: "NAME_TAKEN", message: NAME_TAKEN_MESSAGE });
    });

    it("treats names case-insensitively and trimmed", () => {
      store.saveRoom(makeRoom("r1"));
      store.savePlayer(makePlayer("p1", "r1"));
      store.savePlayer(makePlayer("p2", "r1"));
      service.recordCharacter("p1", { name: "Aria", concept: "c", attributes: ATTRS });

      const dup = service.recordCharacter("p2", { name: "  aria ", concept: "c", attributes: ATTRS });
      expect(dup).toMatchObject({ ok: false, reason: "NAME_TAKEN" });
    });

    it("allows the same name to be reused across different rooms", () => {
      store.saveRoom(makeRoom("r1"));
      store.saveRoom(makeRoom("r2"));
      store.savePlayer(makePlayer("p1", "r1"));
      store.savePlayer(makePlayer("p2", "r2"));
      service.recordCharacter("p1", { name: "Aria", concept: "c", attributes: ATTRS });

      const other = service.recordCharacter("p2", { name: "Aria", concept: "c", attributes: ATTRS });
      expect(other.ok).toBe(true);
    });

    it("allows a player to keep their own name when re-recording", () => {
      store.saveRoom(makeRoom("r1"));
      store.savePlayer(makePlayer("p1", "r1"));
      service.recordCharacter("p1", { name: "Aria", concept: "c", attributes: ATTRS });

      const again = service.recordCharacter("p1", { name: "Aria", concept: "updated", attributes: ATTRS });
      expect(again.ok).toBe(true);
    });
  });

  describe("start gating (R4.7, R5.1)", () => {
    function seedTwoPlayers(): void {
      store.saveRoom(makeRoom("r1"));
      store.savePlayer(makePlayer("p1", "r1", true));
      store.savePlayer(makePlayer("p2", "r1"));
    }

    it("canStart is false until every player has confirmed", () => {
      seedTwoPlayers();
      expect(service.canStart("r1")).toBe(false);

      service.recordCharacter("p1", { name: "Aria", concept: "c", attributes: ATTRS });
      service.confirmCharacter("p1");
      expect(service.canStart("r1")).toBe(false);

      service.recordCharacter("p2", { name: "Borin", concept: "c", attributes: ATTRS });
      service.confirmCharacter("p2");
      expect(service.canStart("r1")).toBe(true);
    });

    it("canStart is false for an empty or unknown room", () => {
      store.saveRoom(makeRoom("empty"));
      expect(service.canStart("empty")).toBe(false);
      expect(service.canStart("nope")).toBe(false);
    });

    it("a recorded-but-unconfirmed character does not satisfy the gate", () => {
      seedTwoPlayers();
      service.recordCharacter("p1", { name: "Aria", concept: "c", attributes: ATTRS });
      service.confirmCharacter("p1");
      service.recordCharacter("p2", { name: "Borin", concept: "c", attributes: ATTRS });
      expect(service.canStart("r1")).toBe(false);
    });

    it("startSession transitions to in_session only when all confirmed", () => {
      seedTwoPlayers();
      service.recordCharacter("p1", { name: "Aria", concept: "c", attributes: ATTRS });
      service.confirmCharacter("p1");

      const blocked = service.startSession("r1");
      expect(blocked).toMatchObject({ ok: false, reason: "NOT_ALL_CONFIRMED", message: NOT_ALL_CONFIRMED_MESSAGE });
      expect(store.getRoom("r1")?.state).toBe("lobby");

      service.recordCharacter("p2", { name: "Borin", concept: "c", attributes: ATTRS });
      service.confirmCharacter("p2");

      const started = service.startSession("r1");
      expect(started.ok).toBe(true);
      expect(store.getRoom("r1")?.state).toBe("in_session");
    });

    it("startSession rejects an unknown room and a non-lobby room", () => {
      expect(service.startSession("nope")).toMatchObject({ ok: false, reason: "UNKNOWN_ROOM" });

      store.saveRoom(makeRoom("ended", "ended"));
      store.savePlayer(makePlayer("p1", "ended"));
      service.recordCharacter("p1", { name: "Aria", concept: "c", attributes: ATTRS });
      service.confirmCharacter("p1");
      expect(service.startSession("ended")).toMatchObject({ ok: false, reason: "ROOM_NOT_IN_LOBBY" });
    });
  });
});
