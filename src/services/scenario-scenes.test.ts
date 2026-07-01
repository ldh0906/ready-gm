import { describe, it, expect } from "vitest";
import { seedSceneForScenario } from "./scenario-scenes.js";
import { MVP_SCENARIO } from "./scenario-service.js";

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
});
