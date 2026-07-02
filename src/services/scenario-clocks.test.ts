import { describe, it, expect } from "vitest";
import { seedClocksForScenario, areClocksVisible } from "./scenario-clocks.js";
import { seedBlackboardForScenario } from "./scenario-blackboard.js";
import { ASHFALL_MONASTERY, MVP_SCENARIO, TERRIBLE_GEESE, TIDEWATCH_SMUGGLERS } from "./scenario-service.js";

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

  it("seeds ashfall-monastery with hidden horror pressure clocks", () => {
    const clocks = seedClocksForScenario(ASHFALL_MONASTERY.id);

    expect(clocks.map((c) => c.id).sort()).toEqual(["bell_toll", "closing_fog"]);
    expect(clocks.find((c) => c.id === "bell_toll")).toMatchObject({
      scope: "front",
      max: 8,
      onComplete: "returned_ones_arrive",
    });
    expect(clocks.find((c) => c.id === "bell_toll")?.onCompleteEffects).toEqual(
      expect.arrayContaining([{ type: "add_threat", threat: "안개 속에서 문턱을 넘어오는 돌아온 자들" }, { type: "force_ending" }]),
    );
    expect(clocks.find((c) => c.id === "closing_fog")).toMatchObject({
      scope: "scene",
      max: 6,
      onComplete: "fog_erases_exits",
    });
  });

  it("seeds tidewatch-smugglers with infiltration pressure clocks", () => {
    const clocks = seedClocksForScenario(TIDEWATCH_SMUGGLERS.id);

    expect(clocks.map((c) => c.id).sort()).toEqual(["departure_tide", "discovery_risk"]);
    expect(clocks.find((c) => c.id === "discovery_risk")).toMatchObject({
      scope: "scene",
      max: 6,
      onComplete: "smugglers_identify_intruders",
    });
    expect(clocks.find((c) => c.id === "departure_tide")).toMatchObject({
      scope: "front",
      max: 8,
      onComplete: "black_gull_departure",
    });
    expect(clocks.find((c) => c.id === "departure_tide")?.onCompleteEffects).toEqual(
      expect.arrayContaining([{ type: "force_ending" }]),
    );
  });

  it("seeds terrible-geese with visible comedy pressure clocks", () => {
    const clocks = seedClocksForScenario(TERRIBLE_GEESE.id);

    expect(clocks.map((clock) => clock.id).sort()).toEqual(["village_uproar", "warden_alert"]);
    expect(clocks.find((clock) => clock.id === "village_uproar")).toMatchObject({
      name: "마을의 봉기",
      scope: "front",
      max: 8,
      onComplete: "village_organizes_goose_sweep",
    });
    expect(clocks.find((clock) => clock.id === "village_uproar")?.onCompleteEffects).toEqual(
      expect.arrayContaining([{ type: "add_threat", threat: "조직적으로 거위 소탕에 나선 마을 사람들" }, { type: "force_ending" }]),
    );
    expect(clocks.find((clock) => clock.id === "warden_alert")).toMatchObject({
      name: "파수꾼 경계",
      scope: "scene",
      max: 6,
      onComplete: "broom_warden_mob",
    });
  });

  it.each([ASHFALL_MONASTERY.id, TIDEWATCH_SMUGGLERS.id])(
    "keeps %s NPC pressure clocks pointing at seeded clocks",
    (scenarioId) => {
      const clockIds = new Set(seedClocksForScenario(scenarioId).map((clock) => clock.id));
      const blackboard = seedBlackboardForScenario("room-1", scenarioId);
      const referencedClockIds = blackboard.npcs
        .map((npc) => npc.pressureClockId)
        .filter((clockId): clockId is string => clockId !== undefined);

      expect(referencedClockIds.length).toBeGreaterThan(0);
      expect(referencedClockIds.every((clockId) => clockIds.has(clockId))).toBe(true);
    },
  );
});

describe("areClocksVisible", () => {
  it("shows clocks for the sunless-crypt (visible-gauge scenario)", () => {
    expect(areClocksVisible(MVP_SCENARIO.id)).toBe(true);
  });

  it("hides clocks by default for unlisted scenarios", () => {
    expect(areClocksVisible("unknown-scenario")).toBe(false);
  });

  it("hides ashfall clocks and shows tidewatch clocks", () => {
    expect(areClocksVisible(ASHFALL_MONASTERY.id)).toBe(false);
    expect(areClocksVisible(TIDEWATCH_SMUGGLERS.id)).toBe(true);
  });

  it("shows terrible-geese clocks", () => {
    expect(areClocksVisible(TERRIBLE_GEESE.id)).toBe(true);
  });
});
