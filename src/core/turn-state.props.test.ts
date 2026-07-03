import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { serializeTurnState, deserializeTurnState, type TurnState } from "./turn-state.js";
import type {
  ActionKind,
  AttributeKey,
  DifficultyGrade,
  OutcomeGrade,
  Phase,
  ReadinessStatus,
} from "./types.js";

/**
 * Property-based test for Turn_State serialization.
 * Feature: trpg-session-engine
 */

const attribute = fc.constantFrom<AttributeKey>("Might", "Agility", "Wits", "Spirit");
const difficulty = fc.constantFrom<DifficultyGrade>("Trivial", "Easy", "Average", "Hard", "Formidable");
const outcome = fc.constantFrom<OutcomeGrade>("Failure", "Partial Success", "Success", "Critical Success");
const phase = fc.constantFrom<Phase>("free_chat", "ready_check", "resolving", "rolling", "ended");
const status = fc.constantFrom<ReadinessStatus>("not_ready", "ready");
const actionKind = fc.constantFrom<ActionKind>("confirmed_action", "pass", "auto_pass", null);

const readinessEntry = fc.record({
  playerId: fc.string(),
  status,
  actionKind,
  actionText: fc.option(fc.fullUnicodeString(), { nil: null }),
});

const chatEntry = fc.record({
  playerId: fc.string(),
  characterName: fc.fullUnicodeString(),
  text: fc.fullUnicodeString(),
  ts: fc.date().map((d) => d.toISOString()),
});

const checkRecord = fc.record({
  characterId: fc.string(),
  attribute,
  difficulty,
  roll: fc.integer({ min: -8, max: 8 }),
  outcome,
  advantage: fc.constantFrom<"none" | "advantage" | "disadvantage">("none", "advantage", "disadvantage"),
  rolls: fc.array(fc.integer({ min: -8, max: 8 }), { minLength: 1, maxLength: 2 }),
  visibility: fc.constantFrom<"player" | "gm">("player", "gm"),
});

const actionHistoryEntry = fc.oneof(
  fc.record({
    round: fc.integer({ min: 0, max: 9999 }),
    playerId: fc.string(),
    kind: fc.constant("confirmed_action" as const),
    text: fc.option(fc.string(), { nil: null }),
  }),
  fc.record({
    round: fc.integer({ min: 0, max: 9999 }),
    playerId: fc.string(),
    kind: fc.constantFrom("pass" as const, "auto_pass" as const),
    text: fc.constant(null),
  }),
);

const pendingCheck = fc.record({
  checkId: fc.string(),
  characterId: fc.string(),
  characterName: fc.fullUnicodeString(),
  playerId: fc.option(fc.string(), { nil: null }),
  attribute,
  difficulty,
  advantage: fc.constantFrom<"none" | "advantage" | "disadvantage">("none", "advantage", "disadvantage"),
  visibility: fc.constantFrom<"player" | "gm">("player", "gm"),
  status: fc.constantFrom<"pending" | "rolled">("pending", "rolled"),
  roll: fc.integer({ min: -8, max: 8 }),
  rolls: fc.array(fc.integer({ min: -8, max: 8 }), { minLength: 1, maxLength: 2 }),
  outcome,
  autoRolled: fc.boolean(),
});

const narrativeEntry = fc.record({
  round: fc.integer({ min: 0, max: 9999 }),
  text: fc.fullUnicodeString(),
});

const turnStateGen: fc.Arbitrary<TurnState> = fc.record({
  roomId: fc.string(),
  roundNumber: fc.integer({ min: 0, max: 9999 }),
  phase,
  readiness: fc.array(readinessEntry, { maxLength: 6 }),
  actionHistory: fc.array(actionHistoryEntry, { maxLength: 10 }),
  chatLog: fc.array(chatEntry, { maxLength: 10 }),
  checks: fc.array(checkRecord, { maxLength: 10 }),
  rollingChecks: fc.array(pendingCheck, { maxLength: 10 }),
  narrativeContext: fc.array(narrativeEntry, { maxLength: 10 }),
  readyCheckDeadline: fc.option(fc.date().map((d) => d.toISOString()), { nil: null }),
  readyCheckTimeoutMs: fc.integer({ min: 0, max: 600000 }),
  resolutionRequested: fc.boolean(),
});

describe("Turn_State serialization — property tests", () => {
  it("Property 26: Turn_State serialization round-trip", () => {
    // Feature: trpg-session-engine, Property 26: Turn_State serialization round-trip
    fc.assert(
      fc.property(turnStateGen, (state) => {
        const round = deserializeTurnState(serializeTurnState(state));
        // Lossless round-trip: the decoded value deep-equals the original.
        expect(round).toStrictEqual(state);
        // Always carries the required fields (R12.2).
        expect(round).toHaveProperty("roundNumber");
        expect(round).toHaveProperty("phase");
        expect(round).toHaveProperty("readiness");
        expect(round).toHaveProperty("narrativeContext");
        for (const entry of round.readiness) {
          expect(entry).toHaveProperty("actionKind");
          expect(entry).toHaveProperty("actionText");
        }
      }),
      { numRuns: 100 },
    );
  });
});
