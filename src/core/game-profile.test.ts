import { describe, expect, it } from "vitest";
import {
  EZFUDGE_DUNGEON_PROFILE,
  INVESTIGATION_HORROR_PROFILE,
  resolveGameProfile,
  resolveGameProfileForScenario,
} from "./game-profile.js";
import { buildGmProcedurePlan, handlersForEnabledProcedures } from "../ai/gm-procedures.js";
import { createEmptyBlackboard, type ScenarioBlackboard } from "./scenario-blackboard.js";
import type { TurnStateContext } from "../services/turn-state-context.js";

function makeContext(): TurnStateContext {
  return {
    roomId: "room-1",
    roundNumber: 1,
    scenario: { id: "s-1", title: "t", summary: "s" },
    characters: [
      {
        id: "c-1",
        name: "Ada",
        concept: "탐정",
        attributes: { Wits: 1 },
      },
    ],
    thisRound: {
      actions: [
        {
          playerId: "p-1",
          characterName: "Ada",
          actionKind: "confirmed_action",
          actionText: "주변을 조사한다",
        },
      ],
      chat: [],
      resolvedChecks: [],
    },
    recentNarrative: [],
  } as unknown as TurnStateContext;
}

function investigationBlackboard(): ScenarioBlackboard {
  return {
    ...createEmptyBlackboard("room-1", "s-1"),
    clues: [
      {
        id: "clue-1",
        conclusion: "결론",
        discoveryCondition: { kind: "action_intent", intent: "inspect" },
        visibility: "undiscovered",
      },
    ],
    secrets: [
      {
        id: "secret-1",
        truth: "숨은 진실",
        sensitivity: "high",
        revealState: "hidden",
        relatedClueIds: ["clue-1"],
      },
    ],
  };
}

describe("GameProfile — one engine, genre differences as data", () => {
  it("resolves known profiles by gameId and defaults to the dungeon profile", () => {
    expect(resolveGameProfile("investigation-horror-oneshot")).toBe(INVESTIGATION_HORROR_PROFILE);
    expect(resolveGameProfile("unknown-profile")).toBe(EZFUDGE_DUNGEON_PROFILE);
    expect(resolveGameProfile()).toBe(EZFUDGE_DUNGEON_PROFILE);
  });

  it("maps the authored investigation scenario to the investigation profile", () => {
    expect(resolveGameProfileForScenario("the-sunless-crypt")).toBe(INVESTIGATION_HORROR_PROFILE);
    expect(resolveGameProfileForScenario("some-dungeon")).toBe(EZFUDGE_DUNGEON_PROFILE);
  });

  it("produces different procedure hint sets for the two profiles on the same state", () => {
    const input = { context: makeContext(), blackboard: investigationBlackboard() };

    const dungeonPlan = buildGmProcedurePlan(
      input,
      handlersForEnabledProcedures(EZFUDGE_DUNGEON_PROFILE.enabledProcedures),
    );
    const investigationPlan = buildGmProcedurePlan(
      input,
      handlersForEnabledProcedures(INVESTIGATION_HORROR_PROFILE.enabledProcedures),
    );

    const dungeonIds = dungeonPlan.hints.map((hint) => hint.id);
    const investigationIds = investigationPlan.hints.map((hint) => hint.id);

    // The investigation profile enables the three-clue-rule procedure (the
    // secret above has fewer than three clue paths); the dungeon profile does not.
    expect(investigationIds).toContain("three_clue_rule");
    expect(dungeonIds).not.toContain("three_clue_rule");
    expect(investigationIds).not.toEqual(dungeonIds);
  });
});
