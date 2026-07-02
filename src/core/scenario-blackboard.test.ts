import { describe, expect, it } from "vitest";
import {
  applyBlackboardDeltas,
  createEmptyBlackboard,
  toGmBlackboardProjection,
  toVisibleBlackboard,
  type ScenarioBlackboard,
} from "./scenario-blackboard.js";

function seededBlackboard(): ScenarioBlackboard {
  return {
    ...createEmptyBlackboard("room-1", "scenario-1"),
    clues: [
      {
        id: "clue-1",
        conclusion: "The seal was broken from inside.",
        discoveryCondition: { kind: "scene_entry", sceneId: "crypt-door" },
        visibility: "undiscovered",
        redundantPathGroup: "seal",
      },
    ],
    secrets: [
      {
        id: "secret-1",
        truth: "The missing children opened the crypt willingly.",
        sensitivity: "high",
        revealState: "hidden",
        relatedClueIds: ["clue-1"],
      },
    ],
    npcs: [
      {
        npcId: "npc-1",
        name: "Mara",
        role: "Crypt guide",
        attitudeByCharacter: { "char-1": "wary" },
        goals: ["leave alive"],
        knownSecretIds: ["secret-1"],
        location: "chapel",
      },
    ],
  };
}

describe("ScenarioBlackboard reducer", () => {
  it("creates an empty seed when scenario catalog has no blackboard data", () => {
    expect(createEmptyBlackboard("room-1", "scenario-1")).toEqual({
      roomId: "room-1",
      scenarioId: "scenario-1",
      sceneNodes: [],
      activeThreats: [],
      fronts: [],
      clues: [],
      secrets: [],
      npcs: [],
      worldFlags: [],
      memoryRefs: [],
    });
  });

  it("rejects unknown deltas fail-closed with a machine-readable reason", () => {
    const result = applyBlackboardDeltas(seededBlackboard(), [
      { type: "unknown", clueId: "clue-1" } as never,
    ]);

    expect(result.applied).toEqual([]);
    expect(result.rejected).toEqual([
      { delta: { type: "unknown", clueId: "clue-1" }, reason: "UNKNOWN_DELTA_TYPE" },
    ]);
  });

  it("counts duplicate clue reveals as an idempotent applied no-op", () => {
    const first = applyBlackboardDeltas(seededBlackboard(), [
      { type: "reveal_clue", clueId: "clue-1", reason: "found the seal" },
    ]);
    const second = applyBlackboardDeltas(first.blackboard, [
      { type: "reveal_clue", clueId: "clue-1", reason: "found again" },
    ]);

    expect(second.applied).toEqual([{ type: "reveal_clue", clueId: "clue-1", reason: "found again" }]);
    expect(second.rejected).toEqual([]);
    expect(second.blackboard.clues[0].visibility).toBe("discovered");
  });

  it("rejects npc attitude changes outside the targeted room characters", () => {
    const result = applyBlackboardDeltas(
      seededBlackboard(),
      [{ type: "npc_attitude", npcId: "npc-1", characterId: "char-2", attitude: "helpful", reason: "talked" }],
      { characterIds: ["char-1"] },
    );

    expect(result.rejected).toEqual([
      {
        delta: { type: "npc_attitude", npcId: "npc-1", characterId: "char-2", attitude: "helpful", reason: "talked" },
        reason: "UNKNOWN_CHARACTER",
      },
    ]);
    expect(result.blackboard.npcs[0].attitudeByCharacter).toEqual({ "char-1": "wary" });
  });
});

describe("blackboard projections", () => {
  it("hidden secret은 visible projection에 나오지 않는다", () => {
    const bb = seededBlackboard();

    const projection = toGmBlackboardProjection(bb);
    const serialized = JSON.stringify(projection);

    expect(serialized).not.toContain("The missing children opened the crypt willingly.");
    expect(serialized).not.toContain("The seal was broken from inside.");
    expect(projection.discoveredClues).toEqual([]);
  });

  it("exposes discovered clues and visible NPC state without NPC known secrets", () => {
    const result = applyBlackboardDeltas(seededBlackboard(), [
      { type: "reveal_clue", clueId: "clue-1", reason: "found" },
    ]);

    expect(toVisibleBlackboard(result.blackboard)).toEqual({
      clues: [
        {
          id: "clue-1",
          conclusion: "The seal was broken from inside.",
          redundantPathGroup: "seal",
        },
      ],
      npcs: [{ npcId: "npc-1", name: "Mara", role: "Crypt guide", attitudeByCharacter: { "char-1": "wary" }, location: "chapel" }],
      activeThreats: [],
      worldFlags: [],
    });
  });
});
