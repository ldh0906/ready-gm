import { describe, it, expect } from "vitest";
import { seedClocksForScenario, areClocksVisible } from "./scenario-clocks.js";
import { MVP_SCENARIO } from "./scenario-service.js";

describe("seedClocksForScenario", () => {
  it("seeds the sunless-crypt scenario with its two pressure clocks at value 0", () => {
    const clocks = seedClocksForScenario(MVP_SCENARIO.id);
    expect(clocks.map((c) => c.id).sort()).toEqual(["crypt_alert", "ritual_progress"]);
    expect(clocks.every((c) => c.value === 0)).toBe(true);
    const ritual = clocks.find((c) => c.id === "ritual_progress");
    expect(ritual?.max).toBe(8);
    expect(ritual?.onComplete).toBe("ritual_breaks_seal");
    // The doom clock carries a force_ending effect; the alarm spawns a hostile NPC.
    expect(ritual?.onCompleteEffects?.some((e) => e.type === "force_ending")).toBe(true);
    const alert = clocks.find((c) => c.id === "crypt_alert");
    expect(alert?.onCompleteEffects?.some((e) => e.type === "add_npc")).toBe(true);
  });

  it("returns no clocks for an unknown scenario", () => {
    expect(seedClocksForScenario("unknown-scenario")).toEqual([]);
  });
});

describe("areClocksVisible", () => {
  it("shows clocks for the sunless-crypt (visible-gauge scenario)", () => {
    expect(areClocksVisible(MVP_SCENARIO.id)).toBe(true);
  });

  it("hides clocks by default for unlisted scenarios", () => {
    expect(areClocksVisible("unknown-scenario")).toBe(false);
  });
});
