/**
 * Property-based + example tests for deterministic card-hand dealing.
 * Feature: card-dealing
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { dealCardHand } from "./card-dealing.js";
import type { CharacterCard } from "./sheet-schema.js";

/** Build a simple card with a given id. */
function card(id: string): CharacterCard {
  return { id, roleLabel: `role-${id}`, premise: `premise-${id}` };
}

/** A deck of distinct-id cards of the given size. */
function deck(size: number): CharacterCard[] {
  return Array.from({ length: size }, (_, i) => card(`c${i}`));
}

describe("dealCardHand", () => {
  describe("property tests (Feature: card-dealing)", () => {
    // Arbitrary deck of distinct ids (1..12 cards), a seed, a hand size, and a
    // taken subset drawn from the deck's ids.
    const scenario = fc
      .record({
        deckSize: fc.integer({ min: 1, max: 12 }),
        seed: fc.string(),
        handSize: fc.integer({ min: 1, max: 6 }),
        takenFraction: fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }),
      })
      .map(({ deckSize, seed, handSize, takenFraction }) => {
        const allCards = deck(deckSize);
        const takenIds = allCards
          .filter((_, i) => takenFraction[i])
          .map((c) => c.id);
        return { allCards, seed, handSize, takenIds };
      });

    it("is deterministic — two calls with identical inputs are equal", () => {
      fc.assert(
        fc.property(scenario, ({ allCards, seed, handSize, takenIds }) => {
          const a = dealCardHand(allCards, seed, takenIds, handSize);
          const b = dealCardHand(allCards, seed, takenIds, handSize);
          expect(a).toEqual(b);
        }),
        { numRuns: 100 },
      );
    });

    it("never returns a taken id", () => {
      fc.assert(
        fc.property(scenario, ({ allCards, seed, handSize, takenIds }) => {
          const taken = new Set(takenIds);
          const hand = dealCardHand(allCards, seed, takenIds, handSize);
          for (const c of hand) {
            expect(taken.has(c.id)).toBe(false);
          }
        }),
        { numRuns: 100 },
      );
    });

    it("returns only distinct ids", () => {
      fc.assert(
        fc.property(scenario, ({ allCards, seed, handSize, takenIds }) => {
          const hand = dealCardHand(allCards, seed, takenIds, handSize);
          const ids = hand.map((c) => c.id);
          expect(new Set(ids).size).toBe(ids.length);
        }),
        { numRuns: 100 },
      );
    });

    it("length === min(handSize, |allCards \\ taken|)", () => {
      fc.assert(
        fc.property(scenario, ({ allCards, seed, handSize, takenIds }) => {
          const taken = new Set(takenIds);
          const available = allCards.filter((c) => !taken.has(c.id)).length;
          const hand = dealCardHand(allCards, seed, takenIds, handSize);
          expect(hand.length).toBe(Math.min(handSize, available));
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("example tests", () => {
    it("returns the remaining 2 when all but 2 are taken", () => {
      const allCards = deck(5); // c0..c4
      const takenIds = ["c0", "c1", "c2"];
      const hand = dealCardHand(allCards, "room:player", takenIds, 3);
      expect(hand.length).toBe(2);
      expect(hand.map((c) => c.id).sort()).toEqual(["c3", "c4"]);
    });

    it("different seeds generally produce different hands", () => {
      const allCards = deck(11); // mirrors SINKS_CARDS size
      const seeds = Array.from({ length: 8 }, (_, i) => `room:player-${i}`);
      const hands = seeds.map((s) =>
        dealCardHand(allCards, s, [], 3)
          .map((c) => c.id)
          .join(","),
      );
      // Expect more than one distinct hand across several seeds.
      expect(new Set(hands).size).toBeGreaterThan(1);
    });

    it("returns [] for a non-array deck", () => {
      // @ts-expect-error intentional misuse for defensive contract
      expect(dealCardHand(null, "seed", [], 3)).toEqual([]);
    });

    it("treats a non-array takenIds as empty", () => {
      const allCards = deck(4);
      // @ts-expect-error intentional misuse for defensive contract
      const hand = dealCardHand(allCards, "seed", undefined, 3);
      expect(hand.length).toBe(3);
    });

    it("dedupes by id (first wins) and ignores blank ids", () => {
      const allCards: CharacterCard[] = [
        card("dup"),
        { id: "  ", roleLabel: "blank", premise: "p" },
        card("dup"),
        card("other"),
      ];
      const hand = dealCardHand(allCards, "seed", [], 5);
      expect(hand.map((c) => c.id).sort()).toEqual(["dup", "other"]);
    });

    it("does not mutate its inputs", () => {
      const allCards = deck(5);
      const snapshot = allCards.map((c) => c.id);
      const takenIds = ["c0"];
      dealCardHand(allCards, "seed", takenIds, 3);
      expect(allCards.map((c) => c.id)).toEqual(snapshot);
      expect(takenIds).toEqual(["c0"]);
    });
  });
});
