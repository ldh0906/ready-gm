import { describe, it, expect } from "vitest";
import { createEmptyBlackboard } from "./scenario-blackboard.js";
import {
  addSceneNpc,
  addVisibleThreat,
  makeSceneState,
  revealClue,
  setLastGmQuestion,
  syncSceneCluesFromBlackboard,
} from "./scene-state.js";

describe("makeSceneState", () => {
  it("fills list/null fields with safe defaults", () => {
    const scene = makeSceneState({ sceneId: "s1", location: "입구", sceneGoal: "단서 찾기" });
    expect(scene.presentNpcs).toEqual([]);
    expect(scene.visibleThreats).toEqual([]);
    expect(scene.availableClues).toEqual([]);
    expect(scene.revealedClues).toEqual([]);
    expect(scene.exits).toEqual([]);
    expect(scene.lastGmQuestion).toBeNull();
    expect(scene.currentTension).toBe("");
  });

  it("de-duplicates clue lists and keeps available/revealed disjoint", () => {
    const scene = makeSceneState({
      sceneId: "s1",
      location: "복도",
      sceneGoal: "g",
      availableClues: ["a", "a", "b", "shared"],
      revealedClues: ["shared", "shared", "c"],
    });
    expect(scene.availableClues).toEqual(["a", "b"]);
    expect(scene.revealedClues).toEqual(["shared", "c"]);
  });
});

describe("revealClue", () => {
  const base = makeSceneState({
    sceneId: "s1",
    location: "복도",
    sceneGoal: "g",
    availableClues: ["footprints", "blood"],
    revealedClues: [],
  });

  it("moves a clue from available to revealed", () => {
    const next = revealClue(base, "footprints");
    expect(next.availableClues).toEqual(["blood"]);
    expect(next.revealedClues).toEqual(["footprints"]);
  });

  it("is idempotent for an already-revealed clue", () => {
    const once = revealClue(base, "footprints");
    const twice = revealClue(once, "footprints");
    expect(twice).toBe(once);
  });

  it("adds an unlisted clue id directly to revealed", () => {
    const next = revealClue(base, "surprise");
    expect(next.revealedClues).toContain("surprise");
    expect(next.availableClues).toEqual(["footprints", "blood"]);
  });

  it("does not mutate the input scene", () => {
    revealClue(base, "footprints");
    expect(base.revealedClues).toEqual([]);
  });
});

describe("syncSceneCluesFromBlackboard", () => {
  it("derives scene clue availability and revealed view from blackboard visibility", () => {
    const scene = makeSceneState({
      sceneId: "s1",
      location: "복도",
      sceneGoal: "g",
      availableClues: ["footprints", "blood"],
      revealedClues: ["old_symbol"],
    });
    const blackboard = {
      ...createEmptyBlackboard("room-1", "scenario-1"),
      clues: [
        {
          id: "footprints",
          conclusion: "Footprints lead inside.",
          discoveryCondition: { kind: "scene_entry" as const, sceneId: "s1" },
          visibility: "discovered" as const,
        },
        {
          id: "blood",
          conclusion: "The blood is fresh.",
          discoveryCondition: { kind: "scene_entry" as const, sceneId: "s1" },
          visibility: "undiscovered" as const,
        },
        {
          id: "old_symbol",
          conclusion: "The symbol is a ward.",
          discoveryCondition: { kind: "scene_entry" as const, sceneId: "s1" },
          visibility: "undiscovered" as const,
        },
      ],
    };

    const synced = syncSceneCluesFromBlackboard(scene, blackboard);

    expect(synced.availableClues).toEqual(["blood", "old_symbol"]);
    expect(synced.revealedClues).toEqual(["footprints"]);
    expect(scene.availableClues).toEqual(["footprints", "blood"]);
  });
});

describe("setLastGmQuestion", () => {
  it("sets and clears the last GM question", () => {
    const base = makeSceneState({ sceneId: "s1", location: "l", sceneGoal: "g" });
    expect(setLastGmQuestion(base, "문을 여나요?").lastGmQuestion).toBe("문을 여나요?");
    expect(setLastGmQuestion(base, null).lastGmQuestion).toBeNull();
  });
});

describe("addVisibleThreat", () => {
  const base = makeSceneState({ sceneId: "s1", location: "l", sceneGoal: "g", visibleThreats: ["냉기"] });

  it("adds a new threat", () => {
    expect(addVisibleThreat(base, "해골").visibleThreats).toEqual(["냉기", "해골"]);
  });

  it("is idempotent for an existing threat and does not mutate input", () => {
    expect(addVisibleThreat(base, "냉기")).toBe(base);
    addVisibleThreat(base, "해골");
    expect(base.visibleThreats).toEqual(["냉기"]);
  });
});

describe("addSceneNpc", () => {
  const npc = (id: string) => ({ id, name: id, disposition: "hostile" as const, visibleIntent: "x" });
  const base = makeSceneState({ sceneId: "s1", location: "l", sceneGoal: "g", presentNpcs: [npc("n1")] });

  it("adds a new NPC", () => {
    expect(addSceneNpc(base, npc("n2")).presentNpcs.map((n) => n.id)).toEqual(["n1", "n2"]);
  });

  it("is idempotent by id and does not mutate input", () => {
    expect(addSceneNpc(base, npc("n1"))).toBe(base);
    addSceneNpc(base, npc("n2"));
    expect(base.presentNpcs.map((n) => n.id)).toEqual(["n1"]);
  });
});
