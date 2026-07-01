import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { AttributeKey, AttributeLevel } from "../core/types.js";
import { CharacterService } from "./character-service.js";
import { InMemoryRoomStore } from "./room-store.js";
import type { Player, Room } from "./types.js";

/**
 * Property-based tests for the Character Service.
 * Feature: trpg-session-engine
 */

function makeRoom(id: string, hostPlayerId: string): Room {
  return {
    id,
    inviteToken: `token-${id}`,
    hostPlayerId,
    scenarioId: "the-sunless-crypt",
    state: "lobby",
    maxPlayers: 6,
    createdAt: new Date("2024-01-01T00:00:00.000Z").toISOString(),
  };
}

function makePlayer(id: string, roomId: string, isHost = false): Player {
  return { id, roomId, displayName: id, isHost, characterId: null, connectionStatus: "connected" };
}

/** Attribute ladder generator within the default EZFudge band [-2, +4]. */
const attrsGen: fc.Arbitrary<Record<AttributeKey, AttributeLevel>> = fc.record({
  Might: fc.integer({ min: -2, max: 4 }),
  Agility: fc.integer({ min: -2, max: 4 }),
  Wits: fc.integer({ min: -2, max: 4 }),
  Spirit: fc.integer({ min: -2, max: 4 }),
});

function seed(playerCount: number): { store: InMemoryRoomStore; svc: CharacterService; players: string[] } {
  const store = new InMemoryRoomStore();
  let n = 0;
  const svc = new CharacterService({ store, generateCharacterId: () => `char-${n++}` });
  const players: string[] = [];
  store.saveRoom(makeRoom("r1", "p0"));
  for (let i = 0; i < playerCount; i++) {
    const pid = `p${i}`;
    store.savePlayer(makePlayer(pid, "r1", i === 0));
    players.push(pid);
  }
  return { store, svc, players };
}

describe("Character Service — property tests", () => {
  it("Property 7: Confirmed characters are immutable", () => {
    // Feature: trpg-session-engine, Property 7: Confirmed characters are immutable
    fc.assert(
      fc.property(attrsGen, attrsGen, fc.string({ minLength: 1 }), (attrs, attrs2, concept) => {
        const { svc } = seed(1);
        expect(svc.recordCharacter("p0", { name: "Hero", concept, attributes: attrs }).ok).toBe(true);
        expect(svc.confirmCharacter("p0").ok).toBe(true);
        const confirmed = svc.getCharacterForPlayer("p0")!;

        const res = svc.recordCharacter("p0", { name: "Hero", concept: "changed", attributes: attrs2 });
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.reason).toBe("ALREADY_CONFIRMED");
        // Recorded attributes remain equal to confirmation-time values.
        expect(svc.getCharacterForPlayer("p0")!.attributes).toStrictEqual(confirmed.attributes);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 8: Character recording and name uniqueness", () => {
    // Feature: trpg-session-engine, Property 8: Character recording and name uniqueness
    fc.assert(
      fc.property(attrsGen, fc.string({ minLength: 1 }), (attrs, baseName) => {
        const { svc } = seed(2);
        // Player 0 records and confirms a character; it is recorded.
        expect(svc.recordCharacter("p0", { name: baseName, concept: "c", attributes: attrs }).ok).toBe(true);
        expect(svc.confirmCharacter("p0").ok).toBe(true);
        expect(svc.getCharacterForPlayer("p0")?.confirmed).toBe(true);

        // Player 1 cannot reuse the same (normalized) name.
        const dup = svc.recordCharacter("p1", { name: baseName, concept: "c", attributes: attrs });
        expect(dup.ok).toBe(false);
        if (!dup.ok) expect(dup.reason).toBe("NAME_TAKEN");

        // A distinct name is accepted.
        const ok = svc.recordCharacter("p1", { name: `${baseName}-other`, concept: "c", attributes: attrs });
        expect(ok.ok).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 9: Session start gating", () => {
    // Feature: trpg-session-engine, Property 9: Session start gating
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 0, max: 4 }), attrsGen, (count, rawConfirm, attrs) => {
        const confirmCount = Math.min(rawConfirm, count);
        const { svc, players } = seed(count);
        for (let i = 0; i < confirmCount; i++) {
          expect(svc.recordCharacter(players[i], { name: `name-${i}`, concept: "c", attributes: attrs }).ok).toBe(true);
          expect(svc.confirmCharacter(players[i]).ok).toBe(true);
        }
        const allConfirmed = confirmCount === count;
        // canStart iff every player has confirmed.
        expect(svc.canStart("r1")).toBe(allConfirmed);
        // startSession (host p0) succeeds iff the gate is satisfied.
        const res = svc.startSession("r1", "p0");
        expect(res.ok).toBe(allConfirmed);
        if (!res.ok) expect(res.reason).toBe("NOT_ALL_CONFIRMED");
      }),
      { numRuns: 100 },
    );
  });
});
