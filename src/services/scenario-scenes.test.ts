import { describe, it, expect } from "vitest";
import { seedBlackboardForScenario } from "./scenario-blackboard.js";
import { seedSceneForScenario } from "./scenario-scenes.js";
import {
  ASHFALL_MONASTERY,
  MVP_SCENARIO,
  TERRIBLE_GEESE,
  TIDEWATCH_SMUGGLERS,
  UNTIL_IT_SINKS,
} from "./scenario-service.js";

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

  it("seeds the terrible-geese opening scene without clue procedures", () => {
    const scene = seedSceneForScenario(TERRIBLE_GEESE.id);

    expect(scene).toMatchObject({
      sceneId: "village_square",
      sceneGoal: "창턱에서 식어 가는 파이를 망쳐 첫 장난을 성공시킨다",
      availableClues: [],
      revealedClues: [],
    });
    expect(scene?.location).toContain("마을 광장");
    expect(scene?.visibleThreats).toContain("파이를 지키려는 빵집 주인의 빗자루");
    expect(scene?.exits).toEqual(["laundry_alley", "mayor_garden", "festival_ground"]);
  });

  it("seeds the until-it-sinks opening scene without clue procedures", () => {
    const scene = seedSceneForScenario(UNTIL_IT_SINKS.id);

    expect(scene).toMatchObject({
      sceneId: "hotel_ballroom",
      sceneGoal: "첫째 날 아침 해변에서 발견된 낚시꾼의 죽음을 두고 저녁 대화를 시작한다",
      presentNpcs: [],
      availableClues: [],
      revealedClues: [],
      exits: ["beach", "fisherman_grave", "hotel_front"],
    });
    expect(scene?.location).toContain("호텔 연회장");
    expect(scene?.currentTension).toContain("첫째 날 저녁");
  });
});
