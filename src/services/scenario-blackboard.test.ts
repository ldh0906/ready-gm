import { describe, expect, it } from "vitest";
import { resolveGameProfileForScenario } from "../core/game-profile.js";
import { seedBlackboardForScenario } from "./scenario-blackboard.js";
import { TERRIBLE_GEESE } from "./scenario-service.js";

const OPENING_FRONT_IDS = new Set([
  "geese_prank_window_pie",
  "geese_prank_fountain_ribbons",
  "geese_prank_bakery_bell",
]);

const MIDGAME_FRONT_IDS = new Set([
  "geese_prank_laundry_collapse",
  "geese_prank_mayor_wig",
  "geese_prank_market_labels",
  "geese_prank_goat_parade",
]);

const FINALE_FRONT_IDS = new Set([
  "geese_prank_festival_rehearsal",
  "geese_prank_town_photo",
  "geese_prank_clocktower_chorus",
]);

const NPC_POOL_IDS = new Set([
  "npc_baker_broom",
  "npc_goose_child",
  "npc_mayor_vain",
  "npc_laundry_grandma",
  "npc_sleepy_warden",
  "npc_festival_director",
]);

describe("seedBlackboardForScenario — terrible-geese", () => {
  it("selects the same prank fronts and NPCs for the same room id", () => {
    const a = seedBlackboardForScenario("room-goose-alpha", TERRIBLE_GEESE.id);
    const b = seedBlackboardForScenario("room-goose-alpha", TERRIBLE_GEESE.id);

    expect(a.fronts.map((front) => front.id)).toEqual(b.fronts.map((front) => front.id));
    expect(a.npcs.map((npc) => npc.npcId)).toEqual(b.npcs.map((npc) => npc.npcId));
    expect(a.worldFlags).toEqual(b.worldFlags);
  });

  it("selects different prank or NPC decks for known different room ids", () => {
    const a = seedBlackboardForScenario("room-goose-alpha", TERRIBLE_GEESE.id);
    const b = seedBlackboardForScenario("room-goose-bravo", TERRIBLE_GEESE.id);

    expect({
      fronts: a.fronts.map((front) => front.id),
      npcs: a.npcs.map((npc) => npc.npcId),
    }).not.toEqual({
      fronts: b.fronts.map((front) => front.id),
      npcs: b.npcs.map((npc) => npc.npcId),
    });
  });

  it("orders four prank fronts as opening, two midgame pranks, then finale", () => {
    const blackboard = seedBlackboardForScenario("room-goose-alpha", TERRIBLE_GEESE.id);
    const ids = blackboard.fronts.map((front) => front.id);

    expect(ids).toHaveLength(4);
    expect(OPENING_FRONT_IDS.has(ids[0]!)).toBe(true);
    expect(MIDGAME_FRONT_IDS.has(ids[1]!)).toBe(true);
    expect(MIDGAME_FRONT_IDS.has(ids[2]!)).toBe(true);
    expect(ids[1]).not.toBe(ids[2]);
    expect(FINALE_FRONT_IDS.has(ids[3]!)).toBe(true);
    expect(blackboard.fronts.map((front) => front.stage)).toEqual([
      "진행 중",
      "대기",
      "대기",
      "대기",
    ]);
  });

  it("selects three NPCs from the authored village NPC pool", () => {
    const blackboard = seedBlackboardForScenario("room-goose-alpha", TERRIBLE_GEESE.id);

    expect(blackboard.npcs).toHaveLength(3);
    expect(blackboard.npcs.every((npc) => NPC_POOL_IDS.has(npc.npcId))).toBe(true);
    expect(new Set(blackboard.npcs.map((npc) => npc.npcId)).size).toBe(3);
  });

  it("keeps comedy clue webs empty without leaking hidden deck flags", () => {
    const blackboard = seedBlackboardForScenario("room-goose-alpha", TERRIBLE_GEESE.id);

    expect(blackboard.clues).toEqual([]);
    expect(blackboard.secrets).toEqual([]);
    expect(blackboard.sceneNodes.map((node) => node.id)).toEqual([
      "village_square",
      "laundry_alley",
      "mayor_garden",
      "festival_ground",
    ]);
    expect(blackboard.worldFlags.some((flag) => flag.key === "prank_deck")).toBe(false);
    expect(blackboard.worldFlags.some((flag) => flag.key === "npc_deck")).toBe(false);
  });

  it("maps terrible-geese to the comedy one-shot profile", () => {
    const profile = resolveGameProfileForScenario(TERRIBLE_GEESE.id);

    expect(profile).toMatchObject({
      gameId: "comedy-oneshot",
      rulesFamily: "d6-pool",
      sessionStyle: "one-shot",
      minRounds: 8,
      characterSheetSchemaId: "terrible-geese-sheet-v1",
      characterStateSchemaId: "character-state-v1",
      scenarioBlackboardSchemaId: "terrible-geese-blackboard-v1",
      enabledProcedures: ["character_spotlight", "pressure_clock", "narration_critic"],
      safetyProfileId: "default-table-safety",
    });
  });
});
