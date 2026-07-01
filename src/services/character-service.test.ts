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
  CARD_TAKEN_MESSAGE,
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

      const blocked = service.startSession("r1", "r1-host");
      expect(blocked).toMatchObject({ ok: false, reason: "NOT_ALL_CONFIRMED", message: NOT_ALL_CONFIRMED_MESSAGE });
      expect(store.getRoom("r1")?.state).toBe("lobby");

      service.recordCharacter("p2", { name: "Borin", concept: "c", attributes: ATTRS });
      service.confirmCharacter("p2");

      const started = service.startSession("r1", "r1-host");
      expect(started.ok).toBe(true);
      expect(store.getRoom("r1")?.state).toBe("in_session");
    });

    it("startSession rejects an unknown room and a non-lobby room", () => {
      expect(service.startSession("nope", "anyone")).toMatchObject({ ok: false, reason: "UNKNOWN_ROOM" });

      store.saveRoom(makeRoom("ended", "ended"));
      store.savePlayer(makePlayer("p1", "ended"));
      service.recordCharacter("p1", { name: "Aria", concept: "c", attributes: ATTRS });
      service.confirmCharacter("p1");
      expect(service.startSession("ended", "ended-host")).toMatchObject({ ok: false, reason: "ROOM_NOT_IN_LOBBY" });
    });

    it("startSession rejects a non-host caller, leaving the room in lobby (R5.2, S3)", () => {
      seedTwoPlayers();
      service.recordCharacter("p1", { name: "Aria", concept: "c", attributes: ATTRS });
      service.confirmCharacter("p1");
      service.recordCharacter("p2", { name: "Borin", concept: "c", attributes: ATTRS });
      service.confirmCharacter("p2");

      const result = service.startSession("r1", "p2"); // p2 is not the host
      expect(result).toMatchObject({ ok: false, reason: "NOT_HOST" });
      expect(store.getRoom("r1")?.state).toBe("lobby");
    });

    it("startSession rejects when a scenario gate is wired and unresolved (R3.5, S7)", () => {
      const gated = new CharacterService({
        store,
        generateCharacterId: () => `char-${nextId++}`,
        isScenarioResolved: () => false,
      });
      seedTwoPlayers();
      gated.recordCharacter("p1", { name: "Aria", concept: "c", attributes: ATTRS });
      gated.confirmCharacter("p1");
      gated.recordCharacter("p2", { name: "Borin", concept: "c", attributes: ATTRS });
      gated.confirmCharacter("p2");

      const result = gated.startSession("r1", "r1-host");
      expect(result).toMatchObject({ ok: false, reason: "SCENARIO_NOT_SELECTED" });
      expect(store.getRoom("r1")?.state).toBe("lobby");
    });
  });

  describe("attribute ladder bounds (S2)", () => {
    beforeEach(() => {
      store.saveRoom(makeRoom("r1"));
      store.savePlayer(makePlayer("p1", "r1"));
    });

    it("rejects an attribute above the EZFudge ladder", () => {
      const result = service.recordCharacter("p1", {
        name: "Aria",
        concept: "c",
        attributes: { Might: 999, Agility: 0, Wits: 0, Spirit: 0 },
      });
      expect(result).toMatchObject({ ok: false, reason: "INVALID_ATTRIBUTES" });
    });

    it("rejects a non-integer attribute", () => {
      const result = service.recordCharacter("p1", {
        name: "Aria",
        concept: "c",
        attributes: { Might: 1.5, Agility: 0, Wits: 0, Spirit: 0 },
      });
      expect(result).toMatchObject({ ok: false, reason: "INVALID_ATTRIBUTES" });
    });

    it("accepts attributes on the ladder boundaries [-2, +4]", () => {
      const result = service.recordCharacter("p1", {
        name: "Aria",
        concept: "c",
        attributes: { Might: -2, Agility: 4, Wits: 0, Spirit: 2 },
      });
      expect(result.ok).toBe(true);
    });

    it("honours a configured ladder so alternate rule systems can widen it", () => {
      const wide = new CharacterService({
        store,
        generateCharacterId: () => `char-${nextId++}`,
        attributeLadder: { min: 0, max: 10 },
      });
      // 7 is off the default [-2,+4] ladder but on the configured [0,10] one.
      const ok = wide.recordCharacter("p1", {
        name: "Aria",
        concept: "c",
        attributes: { Might: 7, Agility: 0, Wits: 10, Spirit: 3 },
      });
      expect(ok.ok).toBe(true);
      // A value below the configured floor is still rejected.
      const bad = wide.recordCharacter("p1", {
        name: "Aria",
        concept: "c",
        attributes: { Might: -1, Agility: 0, Wits: 0, Spirit: 0 },
      });
      expect(bad).toMatchObject({ ok: false, reason: "INVALID_ATTRIBUTES" });
    });
  });

  describe("scenario-specific trait validation (options)", () => {
    beforeEach(() => {
      store.saveRoom(makeRoom("r1"));
      store.savePlayer(makePlayer("p1", "r1"));
    });

    it("accepts valid geese stats with {traitKeys, ladder}", () => {
      const result = service.recordCharacter(
        "p1",
        {
          name: "Gilbert",
          concept: "a menace",
          attributes: { Sneaky: 2, Fast: 3, Tenacious: 1 },
        },
        { traitKeys: ["Sneaky", "Fast", "Tenacious"], ladder: { min: 1, max: 4 } },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.character.attributes).toMatchObject({ Sneaky: 2, Fast: 3, Tenacious: 1 });
    });

    it("rejects geese stats outside the [1,4] ladder", () => {
      const result = service.recordCharacter(
        "p1",
        {
          name: "Gilbert",
          concept: "a menace",
          attributes: { Sneaky: 5, Fast: 1, Tenacious: 1 },
        },
        { traitKeys: ["Sneaky", "Fast", "Tenacious"], ladder: { min: 1, max: 4 } },
      );
      expect(result).toMatchObject({ ok: false, reason: "INVALID_ATTRIBUTES" });
    });

    it("rejects geese stats missing a required trait key", () => {
      const result = service.recordCharacter(
        "p1",
        {
          name: "Gilbert",
          concept: "a menace",
          attributes: { Sneaky: 2, Fast: 3 },
        },
        { traitKeys: ["Sneaky", "Fast", "Tenacious"], ladder: { min: 1, max: 4 } },
      );
      expect(result).toMatchObject({ ok: false, reason: "INVALID_ATTRIBUTES" });
    });

    it("accepts an empty attributes map for narrative-only sheets (traitKeys: [])", () => {
      const result = service.recordCharacter(
        "p1",
        { name: "지배인", concept: "호텔을 지키는 사람", attributes: {} },
        { traitKeys: [] },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.character.attributes).toEqual({});
    });

    it("keeps default EZFudge validation when options is omitted", () => {
      const ok = service.recordCharacter("p1", { name: "Aria", concept: "c", attributes: ATTRS });
      expect(ok.ok).toBe(true);

      const bad = service.recordCharacter("p1", {
        name: "Aria",
        concept: "c",
        attributes: { Might: 99, Agility: 0, Wits: 0, Spirit: 0 },
      });
      expect(bad).toMatchObject({ ok: false, reason: "INVALID_ATTRIBUTES" });
    });
  });

  describe("CARD_TAKEN dedup at confirm (Card_Based_Sheets)", () => {
    const CARDS = [
      { id: "manager", roleLabel: "지배인", premise: "p" },
      { id: "writer", roleLabel: "작가", premise: "p" },
    ];

    function recordCard(playerId: string, name: string, cardId: string): void {
      const result = service.recordCharacter(
        playerId,
        { name, concept: "c", attributes: {} },
        { traitKeys: [], characterCards: CARDS, selectedCardId: cardId },
      );
      expect(result.ok).toBe(true);
    }

    beforeEach(() => {
      store.saveRoom(makeRoom("r1"));
      store.savePlayer(makePlayer("p1", "r1", true));
      store.savePlayer(makePlayer("p2", "r1"));
    });

    it("rejects the second player confirming a card another player already confirmed, leaving the store unchanged", () => {
      recordCard("p1", "Aria", "manager");
      recordCard("p2", "Borin", "manager");

      expect(service.confirmCharacter("p1").ok).toBe(true);

      const blocked = service.confirmCharacter("p2");
      expect(blocked).toMatchObject({ ok: false, reason: "CARD_TAKEN", message: CARD_TAKEN_MESSAGE });

      // p2's character stays unconfirmed (store unchanged on rejection).
      expect(service.getCharacterForPlayer("p2")?.confirmed).toBe(false);
    });

    it("lets both players confirm when they chose different cards", () => {
      recordCard("p1", "Aria", "manager");
      recordCard("p2", "Borin", "writer");

      expect(service.confirmCharacter("p1").ok).toBe(true);
      expect(service.confirmCharacter("p2").ok).toBe(true);
      expect(service.getCharacterForPlayer("p2")?.confirmed).toBe(true);
    });

    it("re-confirming one's own already-confirmed card stays idempotent (never CARD_TAKEN)", () => {
      recordCard("p1", "Aria", "manager");
      expect(service.confirmCharacter("p1").ok).toBe(true);

      const again = service.confirmCharacter("p1");
      expect(again.ok).toBe(true);
      if (!again.ok) return;
      expect(again.character.confirmed).toBe(true);
      expect(again.character.selectedCardId).toBe("manager");
    });

    it("does not affect non-card sheet confirms (no selectedCardId)", () => {
      service.recordCharacter("p1", { name: "Aria", concept: "c", attributes: ATTRS });
      service.recordCharacter("p2", { name: "Borin", concept: "c", attributes: ATTRS });
      expect(service.confirmCharacter("p1").ok).toBe(true);
      expect(service.confirmCharacter("p2").ok).toBe(true);
    });
  });
});
