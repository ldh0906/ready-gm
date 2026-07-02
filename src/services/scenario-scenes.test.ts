import { describe, it, expect } from "vitest";
import { seedBlackboardForScenario } from "./scenario-blackboard.js";
import { seedSceneForScenario } from "./scenario-scenes.js";
import { ASHFALL_MONASTERY, MVP_SCENARIO, TIDEWATCH_SMUGGLERS } from "./scenario-service.js";

describe("seedSceneForScenario", () => {
  it("seeds the sunless-crypt opening scene with goal, NPCs, clues, and exits", () => {
    const scene = seedSceneForScenario(MVP_SCENARIO.id);
    expect(scene).not.toBeNull();
    expect(scene!.sceneGoal.length).toBeGreaterThan(0);
    expect(scene!.availableClues).toContain("small_footprints");
    expect(scene!.revealedClues).toEqual([]);
    expect(scene!.exits.length).toBeGreaterThan(0);
    expect(scene!.presentNpcs.length).toBeGreaterThan(0);
  });

  it("returns null for an unknown scenario", () => {
    expect(seedSceneForScenario("unknown-scenario")).toBeNull();
  });

  it("keeps sunless-crypt scene clue ids within blackboard clue definitions", () => {
    const scene = seedSceneForScenario(MVP_SCENARIO.id);
    const blackboard = seedBlackboardForScenario("room-1", MVP_SCENARIO.id);
    const blackboardClueIds = new Set(blackboard.clues.map((clue) => clue.id));
    const sceneClueIds = [...(scene?.availableClues ?? []), ...(scene?.revealedClues ?? [])];

    expect(sceneClueIds.every((id) => blackboardClueIds.has(id))).toBe(true);
  });

  it.each([ASHFALL_MONASTERY.id, TIDEWATCH_SMUGGLERS.id])(
    "keeps %s scene clue ids within blackboard clue definitions",
    (scenarioId) => {
      const scene = seedSceneForScenario(scenarioId);
      const blackboard = seedBlackboardForScenario("room-1", scenarioId);
      const blackboardClueIds = new Set(blackboard.clues.map((clue) => clue.id));
      const sceneClueIds = [...(scene?.availableClues ?? []), ...(scene?.revealedClues ?? [])];

      expect(scene).not.toBeNull();
      expect(sceneClueIds.length).toBeGreaterThan(0);
      expect(sceneClueIds.every((id) => blackboardClueIds.has(id))).toBe(true);
    },
  );
});
