import { describe, it, expect } from "vitest";
import type { TurnState } from "../core/turn-state.js";
import type { AttributeKey, AttributeLevel } from "../core/types.js";
import { makeCharacterState } from "../core/character-state.js";
import type { Character } from "./types.js";
import {
  appendNarrative,
  estimateContextTokens,
  estimateTokens,
  toContext,
  type ContextScenario,
} from "./turn-state-context.js";

const SCENARIO: ContextScenario = {
  title: "The Sunless Crypt",
  summary: "Children vanished into the crypt beneath the chapel.",
  openingSeed: "Dusk over a fearful village; the crypt stairs descend into cold dark.",
  endingCondition: "The party escapes with the children, or the crypt claims them.",
};

const ATTRS: Record<AttributeKey, AttributeLevel> = {
  Might: 2,
  Agility: 1,
  Wits: 0,
  Spirit: -1,
};

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: "c1",
    playerId: "p1",
    roomId: "room-1",
    name: "Borin",
    concept: "A grizzled dwarf blacksmith",
    attributes: { ...ATTRS },
    confirmed: true,
    ...overrides,
  };
}

function makeTurnState(overrides: Partial<TurnState> = {}): TurnState {
  return {
    roomId: "room-1",
    roundNumber: 3,
    phase: "ready_check",
    readiness: [
      { playerId: "p1", status: "ready", actionKind: "confirmed_action", actionText: "Open the door" },
      { playerId: "p2", status: "ready", actionKind: "pass", actionText: null },
    ],
    chatLog: [
      { playerId: "p1", characterName: "Borin", text: "Careful", ts: "2024-01-01T00:00:00.000Z" },
    ],
    checks: [
      { characterId: "c1", attribute: "Might", difficulty: "Hard", roll: 2, outcome: "Success", advantage: "none", rolls: [2], visibility: "player" },
    ],
    narrativeContext: [
      { round: 1, text: "The crypt yawns open." },
      { round: 2, text: "A cold wind rises from below." },
    ],
    readyCheckDeadline: null,
    readyCheckTimeoutMs: 90000,
    resolutionRequested: false,
    ...overrides,
  };
}

describe("estimateTokens", () => {
  it("uses the ~4-characters-per-token heuristic, rounding up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abc")).toBe(1); // ceil(3/4)
    expect(estimateTokens("abcd")).toBe(1); // ceil(4/4)
    expect(estimateTokens("abcde")).toBe(2); // ceil(5/4)
  });
});

describe("estimateContextTokens", () => {
  it("estimates from the serialized JSON length", () => {
    const ctx = toContext(makeTurnState(), SCENARIO, [makeCharacter()]);
    expect(estimateContextTokens(ctx)).toBe(estimateTokens(JSON.stringify(ctx)));
    expect(estimateContextTokens(ctx)).toBeGreaterThan(0);
  });
});

describe("toContext (R10.2, R12.4)", () => {
  it("projects roomId, roundNumber, and the scenario grounding", () => {
    const ctx = toContext(makeTurnState(), SCENARIO, [makeCharacter()]);

    expect(ctx.roomId).toBe("room-1");
    expect(ctx.roundNumber).toBe(3);
    expect(ctx.scenario).toEqual({
      title: SCENARIO.title,
      summary: SCENARIO.summary,
      openingSeed: SCENARIO.openingSeed,
      endingCondition: SCENARIO.endingCondition,
    });
  });

  it("strips extra scenario fields (e.g. id) to the AI-facing shape", () => {
    const catalogScenario = { id: "the-sunless-crypt", ...SCENARIO };
    const ctx = toContext(makeTurnState(), catalogScenario, [makeCharacter()]);

    expect(ctx.scenario).not.toHaveProperty("id");
  });

  it("projects characters with ids, sheet fields, and no player ids", () => {
    const ctx = toContext(makeTurnState(), SCENARIO, [makeCharacter()]);

    expect(ctx.characters).toEqual([
      { id: "c1", name: "Borin", concept: "A grizzled dwarf blacksmith", attributes: ATTRS },
    ]);
    expect(ctx.characters[0]).not.toHaveProperty("playerId");
  });

  it("includes ruleset sheet fields (non-empty, concept excluded) when the character carries sheetData", () => {
    const character = makeCharacter({
      sheetData: {
        narrativeFields: {
          concept: "duplicate of the top-level concept",
          disposition: "심술궂음",
          goal: "정원 정복",
          empty: "   ",
        },
      },
    });

    const ctx = toContext(makeTurnState(), SCENARIO, [character]);

    expect(ctx.characters[0]?.sheet).toEqual({ disposition: "심술궂음", goal: "정원 정복" });
    // concept stays a dedicated field, not duplicated into sheet.
    expect(ctx.characters[0]?.sheet).not.toHaveProperty("concept");
  });

  it("omits the sheet key entirely when the character has no sheetData", () => {
    const ctx = toContext(makeTurnState(), SCENARIO, [makeCharacter()]);
    expect("sheet" in (ctx.characters[0] ?? {})).toBe(false);
  });

  it("attaches mutable character state when supplied", () => {
    const characterState = makeCharacterState({
      characterId: "c1",
      conditions: [{ name: "wounded", severity: 1, reason: "trap" }],
      resources: { focus: 2 },
      memories: [{ text: "The crypt door burned cold.", salience: 3, reason: "round 2" }],
    });

    const ctx = toContext(makeTurnState(), SCENARIO, [makeCharacter()], undefined, [characterState]);

    expect(ctx.characters[0]?.state).toEqual(characterState);
  });

  it("does not share mutable character state references with the source", () => {
    const characterState = makeCharacterState({ characterId: "c1", resources: { focus: 2 } });
    const ctx = toContext(makeTurnState(), SCENARIO, [makeCharacter()], undefined, [characterState]);

    ctx.characters[0]!.state!.resources.focus = 99;

    expect(characterState.resources.focus).toBe(2);
  });

  it("derives this round's actions from readiness, one entry per active player", () => {
    const ctx = toContext(makeTurnState(), SCENARIO, [makeCharacter()]);

    expect(ctx.thisRound.actions).toEqual([
      { characterName: "Borin", actionKind: "confirmed_action", actionText: "Open the door" },
      { characterName: "p2", actionKind: "pass", actionText: null },
    ]);
  });

  it("maps each readiness entry to its character name when a character exists", () => {
    const characters = [
      makeCharacter({ id: "c1", playerId: "p1", name: "Borin" }),
      makeCharacter({ id: "c2", playerId: "p2", name: "Cara" }),
    ];
    const ctx = toContext(makeTurnState(), SCENARIO, characters);

    expect(ctx.thisRound.actions.map((a) => a.characterName)).toEqual(["Borin", "Cara"]);
  });

  it("falls back to the player id when no matching character is supplied", () => {
    const ctx = toContext(makeTurnState(), SCENARIO, []);

    expect(ctx.thisRound.actions.map((a) => a.characterName)).toEqual(["p1", "p2"]);
  });

  it("includes the current round's resolved checks", () => {
    const ctx = toContext(makeTurnState(), SCENARIO, [makeCharacter()]);

    expect(ctx.thisRound.checks).toEqual([
      { characterId: "c1", attribute: "Might", difficulty: "Hard", roll: 2, outcome: "Success", advantage: "none", rolls: [2], visibility: "player" },
    ]);
  });

  it("includes the recent narrative context newest-last", () => {
    const ctx = toContext(makeTurnState(), SCENARIO, [makeCharacter()]);

    expect(ctx.recentNarrative).toEqual([
      { round: 1, text: "The crypt yawns open." },
      { round: 2, text: "A cold wind rises from below." },
    ]);
  });

  it("does not share references with the source Turn_State (defensive copies)", () => {
    const state = makeTurnState();
    const ctx = toContext(state, SCENARIO, [makeCharacter()]);

    ctx.recentNarrative.push({ round: 99, text: "injected" });
    ctx.thisRound.checks[0].roll = -99;

    expect(state.narrativeContext).toHaveLength(2);
    expect(state.checks[0].roll).toBe(2);
  });

  it("returns the full context unchanged when no budget is given", () => {
    const ctx = toContext(makeTurnState(), SCENARIO, [makeCharacter()]);
    expect(ctx.recentNarrative).toHaveLength(2);
  });
});

describe("toContext token-budget truncation (R16.3)", () => {
  it("returns the full context when it already fits the budget", () => {
    const state = makeTurnState();
    const full = toContext(state, SCENARIO, [makeCharacter()]);
    const budget = estimateContextTokens(full) + 50;

    const ctx = toContext(state, SCENARIO, [makeCharacter()], budget);

    expect(ctx.recentNarrative).toHaveLength(2);
  });

  it("trims the OLDEST narrative entries first until the context fits", () => {
    const state = makeTurnState();
    const full = toContext(state, SCENARIO, [makeCharacter()]);

    // A budget that fits the context with only the newest narrative entry.
    const withoutOldest = {
      ...full,
      recentNarrative: full.recentNarrative.slice(1),
    };
    const budget = estimateContextTokens(withoutOldest);

    const ctx = toContext(state, SCENARIO, [makeCharacter()], budget);

    expect(ctx.recentNarrative).toEqual([{ round: 2, text: "A cold wind rises from below." }]);
  });

  it("preserves the current round's actions and checks even when narrative is fully trimmed", () => {
    const state = makeTurnState();

    // Budget too small for any narrative — everything trimmable goes.
    const ctx = toContext(state, SCENARIO, [makeCharacter()], 1);

    expect(ctx.recentNarrative).toHaveLength(0);
    expect(ctx.thisRound.actions).toEqual([
      { characterName: "Borin", actionKind: "confirmed_action", actionText: "Open the door" },
      { characterName: "p2", actionKind: "pass", actionText: null },
    ]);
    expect(ctx.thisRound.checks).toHaveLength(1);
    expect(ctx.characters).toHaveLength(1);
    expect(ctx.scenario.title).toBe("The Sunless Crypt");
  });

  it("stops trimming once narrative is exhausted even if still over budget", () => {
    const manyEntries = Array.from({ length: 5 }, (_, i) => ({ round: i + 1, text: `Event ${i + 1}` }));
    const state = makeTurnState({ narrativeContext: manyEntries });

    const ctx = toContext(state, SCENARIO, [makeCharacter()], 1);

    expect(ctx.recentNarrative).toHaveLength(0);
    // thisRound is never sacrificed to meet an impossible budget.
    expect(ctx.thisRound.actions).toHaveLength(2);
  });

  it("does not mutate the source Turn_State while truncating", () => {
    const state = makeTurnState();
    toContext(state, SCENARIO, [makeCharacter()], 1);

    expect(state.narrativeContext).toHaveLength(2);
  });
});

describe("appendNarrative (R12.5)", () => {
  it("appends a resolution entry tagged with the current round, newest-last", () => {
    const state = makeTurnState({ roundNumber: 3 });

    const updated = appendNarrative(state, "The door bursts open.");

    expect(updated.narrativeContext).toEqual([
      { round: 1, text: "The crypt yawns open." },
      { round: 2, text: "A cold wind rises from below." },
      { round: 3, text: "The door bursts open." },
    ]);
  });

  it("is pure: it does not mutate the input Turn_State", () => {
    const state = makeTurnState();

    appendNarrative(state, "New narration");

    expect(state.narrativeContext).toHaveLength(2);
  });

  it("preserves all other Turn_State fields unchanged", () => {
    const state = makeTurnState();

    const updated = appendNarrative(state, "More story");

    expect(updated.roomId).toBe(state.roomId);
    expect(updated.roundNumber).toBe(state.roundNumber);
    expect(updated.phase).toBe(state.phase);
    expect(updated.readiness).toEqual(state.readiness);
    expect(updated.checks).toEqual(state.checks);
  });

  it("appends onto an empty narrative context", () => {
    const state = makeTurnState({ roundNumber: 1, narrativeContext: [] });

    const updated = appendNarrative(state, "Opening scene");

    expect(updated.narrativeContext).toEqual([{ round: 1, text: "Opening scene" }]);
  });

  it("flows into toContext so an appended narration appears in derived context", () => {
    const state = appendNarrative(makeTurnState({ roundNumber: 3 }), "Round 3 resolved.");

    const ctx = toContext(state, SCENARIO, [makeCharacter()]);

    expect(ctx.recentNarrative.at(-1)).toEqual({ round: 3, text: "Round 3 resolved." });
  });
});
