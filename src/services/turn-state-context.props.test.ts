import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  toContext,
  appendNarrative,
  estimateContextTokens,
  type ContextScenario,
} from "./turn-state-context.js";
import type { TurnState } from "../core/turn-state.js";
import type { Character } from "./types.js";
import type { AttributeKey, AttributeLevel } from "../core/types.js";

/**
 * Property-based tests for AI context derivation, narrative update, and
 * token-budget truncation.
 * Feature: trpg-session-engine
 */

const SCENARIO: ContextScenario = {
  title: "Crypt",
  summary: "summary",
  openingSeed: "seed",
  endingCondition: "ending",
};

const ATTRS: Record<AttributeKey, AttributeLevel> = { Might: 1, Agility: 0, Wits: 2, Spirit: -1 };

function character(playerId: string, name: string): Character {
  return { id: `c-${playerId}`, playerId, roomId: "room-1", name, concept: "c", attributes: { ...ATTRS }, confirmed: true };
}

function makeState(playerIds: readonly string[], narrative: { round: number; text: string }[] = []): TurnState {
  return {
    roomId: "room-1",
    roundNumber: 5,
    phase: "resolving",
    readiness: playerIds.map((playerId) => ({
      playerId,
      status: "ready",
      actionKind: "confirmed_action",
      actionText: `${playerId}-action`,
    })),
    actionHistory: [],
    chatLog: [],
    checks: [],
    narrativeContext: narrative,
    readyCheckDeadline: null,
    readyCheckTimeoutMs: 90000,
    resolutionRequested: true,
  };
}

const playersGen = fc.uniqueArray(fc.hexaString({ minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 6 });

describe("Turn_State context — property tests", () => {
  it("Property 27: AI context is derived from the current Turn_State", () => {
    // Feature: trpg-session-engine, Property 27: AI context is derived from the current Turn_State
    fc.assert(
      fc.property(playersGen, fc.integer({ min: 1, max: 99 }), (players, round) => {
        const state = { ...makeState(players), roundNumber: round };
        const characters = players.map((p, i) => character(p, `name-${i}`));
        const ctx = toContext(state, SCENARIO, characters);
        // The derived context reflects the current Turn_State's round and roster.
        expect(ctx.roomId).toBe(state.roomId);
        expect(ctx.roundNumber).toBe(round);
        expect(ctx.thisRound.actions).toHaveLength(players.length);
        const names = ctx.thisRound.actions.map((a) => a.characterName).sort();
        expect(names).toStrictEqual(characters.map((c) => c.name).sort());
        expect(ctx.scenario.title).toBe(SCENARIO.title);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 28: Narrative context updated after resolution", () => {
    // Feature: trpg-session-engine, Property 28: Narrative context updated after resolution
    fc.assert(
      fc.property(fc.fullUnicodeString(), fc.array(fc.record({ round: fc.nat(), text: fc.string() }), { maxLength: 8 }), (text, prior) => {
        const state = makeState(["p0"], prior);
        const updated = appendNarrative(state, text);
        // The narration is appended (newest-last), tagged with the current round.
        expect(updated.narrativeContext).toHaveLength(prior.length + 1);
        expect(updated.narrativeContext.at(-1)).toStrictEqual({ round: state.roundNumber, text });
        // Prior entries are preserved in order, input not mutated.
        expect(updated.narrativeContext.slice(0, prior.length)).toStrictEqual(prior);
        expect(state.narrativeContext).toStrictEqual(prior);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 34: Token-budget truncation preserves the current round", () => {
    // Feature: trpg-session-engine, Property 34: Token-budget truncation preserves the current round
    fc.assert(
      fc.property(
        playersGen,
        fc.array(fc.record({ round: fc.nat(), text: fc.string({ minLength: 20, maxLength: 200 }) }), { minLength: 1, maxLength: 30 }),
        (players, narrative) => {
          const state = makeState(players, narrative);
          const characters = players.map((p, i) => character(p, `name-${i}`));
          // Budget at the size that fits the round but not all narrative.
          const full = toContext(state, SCENARIO, characters);
          const noNarrative = toContext({ ...state, narrativeContext: [] }, SCENARIO, characters);
          const floor = estimateContextTokens(noNarrative);
          const budget = Math.floor((floor + estimateContextTokens(full)) / 2);

          const trimmed = toContext(state, SCENARIO, characters, budget);
          // The current round is always preserved.
          expect(trimmed.thisRound.actions).toHaveLength(players.length);
          expect(trimmed.characters).toHaveLength(characters.length);
          // Only oldest narrative entries are trimmed: the kept tail matches the original tail.
          const kept = trimmed.recentNarrative.length;
          expect(trimmed.recentNarrative).toStrictEqual(narrative.slice(narrative.length - kept));
          // Fits the budget unless no narrative remains to trim.
          if (kept > 0) {
            expect(estimateContextTokens(trimmed)).toBeLessThanOrEqual(budget);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
