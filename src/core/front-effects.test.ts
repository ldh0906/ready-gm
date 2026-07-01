import { describe, it, expect } from "vitest";
import { applyFiredEffects } from "./front-effects.js";
import { makeClock, type FiredEffect } from "./progress-clock.js";
import { makeSceneState } from "./scene-state.js";

const scene = () =>
  makeSceneState({
    sceneId: "s1",
    location: "복도",
    sceneGoal: "g",
    availableClues: ["footprints"],
    visibleThreats: ["냉기"],
    presentNpcs: [{ id: "n1", name: "시종", disposition: "wary", visibleIntent: "지연" }],
  });

function firedClock(effects: FiredEffect[]) {
  return makeClock({
    id: "c",
    name: "n",
    scope: "scene",
    max: 4,
    value: 4,
    onComplete: "x",
    onCompleteEffects: effects,
  });
}

describe("applyFiredEffects", () => {
  it("adds a threat and an NPC to the scene", () => {
    const clk = firedClock([
      { type: "add_threat", threat: "해골 순찰대" },
      { type: "add_npc", npc: { id: "n2", name: "해골", disposition: "hostile", visibleIntent: "차단" } },
    ]);
    const out = applyFiredEffects(scene(), [clk]);
    expect(out.scene?.visibleThreats).toContain("해골 순찰대");
    expect(out.scene?.presentNpcs.map((n) => n.id)).toContain("n2");
    expect(out.endingForced).toBe(false);
    expect(out.appliedEffects).toHaveLength(2);
  });

  it("reveals a clue (available -> revealed)", () => {
    const clk = firedClock([{ type: "reveal_clue", clueId: "footprints" }]);
    const out = applyFiredEffects(scene(), [clk]);
    expect(out.scene?.revealedClues).toContain("footprints");
    expect(out.scene?.availableClues).not.toContain("footprints");
  });

  it("forces the ending regardless of scene presence", () => {
    const clk = firedClock([{ type: "force_ending" }]);
    expect(applyFiredEffects(scene(), [clk]).endingForced).toBe(true);
    // Scene-independent: still forces ending when no scene is supplied.
    const out = applyFiredEffects(undefined, [clk]);
    expect(out.endingForced).toBe(true);
    expect(out.scene).toBeUndefined();
  });

  it("skips scene effects when no scene is supplied but still records them", () => {
    const clk = firedClock([{ type: "add_threat", threat: "x" }, { type: "force_ending" }]);
    const out = applyFiredEffects(undefined, [clk]);
    expect(out.scene).toBeUndefined();
    expect(out.endingForced).toBe(true);
    expect(out.appliedEffects).toHaveLength(2);
  });

  it("is a no-op for clocks without effects", () => {
    const base = scene();
    const out = applyFiredEffects(base, [makeClock({ id: "c", name: "n", scope: "scene", max: 4, value: 4, onComplete: "x" })]);
    expect(out.scene).toBe(base);
    expect(out.endingForced).toBe(false);
    expect(out.appliedEffects).toEqual([]);
  });

  it("does not mutate the input scene", () => {
    const base = scene();
    applyFiredEffects(base, [firedClock([{ type: "add_threat", threat: "새 위협" }])]);
    expect(base.visibleThreats).toEqual(["냉기"]);
  });
});
