import { describe, expect, it } from "vitest";
import type { CheckRecord } from "../core/turn-state.js";
import { makeClock } from "../core/progress-clock.js";
import { makeSceneState } from "../core/scene-state.js";
import { createEmptyBlackboard, type ScenarioBlackboard } from "../core/scenario-blackboard.js";
import type { TurnStateContext } from "../services/turn-state-context.js";
import {
  buildGmProcedurePlan,
  critiqueNarration,
  formatGmProcedurePlan,
} from "./gm-procedures.js";

const BASE_CONTEXT: TurnStateContext = {
  roomId: "room-1",
  roundNumber: 3,
  scenario: {
    title: "태양 없는 지하실",
    summary: "사라진 아이들을 찾는다.",
    openingSeed: "묘지 계단.",
    endingCondition: "아이들을 데리고 탈출한다.",
  },
  characters: [
    { id: "char-p1", name: "보린", concept: "겁 없는 전사", attributes: { Might: 2, Wits: 0 } },
    { id: "char-p2", name: "세라", concept: "예민한 조사자", attributes: { Wits: 2, Spirit: 1 } },
  ],
  thisRound: {
    actions: [
      { characterName: "보린", actionKind: "confirmed_action", actionText: "문을 밀어붙인다." },
      { characterName: "세라", actionKind: "confirmed_action", actionText: "벽화를 조사한다." },
    ],
    checks: [],
  },
  recentNarrative: [
    { round: 1, text: "보린은 녹슨 문을 부수고 앞으로 나섰다." },
    { round: 2, text: "보린의 횃불이 어둠을 가르자 복도 끝이 드러났다." },
  ],
};

function clueBlackboard(): ScenarioBlackboard {
  return {
    ...createEmptyBlackboard("room-1", "scenario-1"),
    clues: [
      {
        id: "mural_scratch",
        conclusion: "The mural was scratched by a child.",
        discoveryCondition: { kind: "action_intent", intent: "inspect" },
        visibility: "undiscovered",
      },
      {
        id: "old_symbol",
        conclusion: "The symbol belongs to an old ward.",
        discoveryCondition: { kind: "scene_entry", sceneId: "crypt-mural" },
        visibility: "discovered",
      },
    ],
  };
}

describe("buildGmProcedurePlan", () => {
  it("targets the least recently mentioned active character for spotlight", () => {
    const plan = buildGmProcedurePlan({ context: BASE_CONTEXT });

    const hint = plan.hints.find((h) => h.id === "character_spotlight");
    expect(hint).toBeDefined();
    expect(hint?.data?.targetCharacterName).toBe("세라");
    expect(hint?.instruction).toContain("spotlight");
  });

  it("suggests clue reveal procedure only from available clues during investigation", () => {
    const scene = makeSceneState({
      sceneId: "crypt-mural",
      location: "벽화의 방",
      sceneGoal: "아이들이 끌려간 방향을 알아낸다.",
      availableClues: ["mural_scratch", "ash_trail"],
      revealedClues: ["old_symbol"],
    });

    const plan = buildGmProcedurePlan({ context: BASE_CONTEXT, scene });

    const hint = plan.hints.find((h) => h.id === "clue_reveal");
    expect(hint).toBeDefined();
    expect(hint?.data?.availableClues).toEqual(["mural_scratch", "ash_trail"]);
    expect(hint?.data?.alreadyRevealed).toEqual(["old_symbol"]);
  });

  it("suggests clue reveal from blackboard clues without a scene", () => {
    const plan = buildGmProcedurePlan({ context: BASE_CONTEXT, blackboard: clueBlackboard() });

    const hint = plan.hints.find((h) => h.id === "clue_reveal");
    expect(hint).toBeDefined();
    expect(hint?.data?.availableClues).toEqual(["mural_scratch"]);
    expect(hint?.data?.alreadyRevealed).toEqual(["old_symbol"]);
  });

  it("suggests pressure clock handling when players pass under active tension", () => {
    const context: TurnStateContext = {
      ...BASE_CONTEXT,
      thisRound: {
        actions: [
          { characterName: "보린", actionKind: "pass", actionText: null },
          { characterName: "세라", actionKind: "auto_pass", actionText: null },
        ],
        checks: [],
      },
    };
    const clock = makeClock({
      id: "crypt_alert",
      name: "묘지 경계",
      scope: "scene",
      value: 1,
      max: 4,
      onComplete: "patrol_arrives",
    });

    const plan = buildGmProcedurePlan({ context, clocks: [clock] });

    const hint = plan.hints.find((h) => h.id === "pressure_clock");
    expect(hint).toBeDefined();
    expect(hint?.data?.clockIds).toEqual(["crypt_alert"]);
  });

  it("formats procedure hints and critic checks as a stable prompt block", () => {
    const plan = buildGmProcedurePlan({ context: BASE_CONTEXT });
    const block = formatGmProcedurePlan(plan);

    expect(block).toContain("GM_PROCEDURE_HINTS");
    expect(block).toContain("character_spotlight");
    expect(block).toContain("NARRATION_CRITIC_CHECKS");
  });
});

describe("critiqueNarration", () => {
  it("warns when narration leaks unrevealed clue ids or exposes hidden GM rolls", () => {
    const scene = makeSceneState({
      sceneId: "crypt-mural",
      location: "벽화의 방",
      sceneGoal: "아이들이 끌려간 방향을 알아낸다.",
      availableClues: ["secret_footprints"],
    });
    const hiddenCheck: CheckRecord = {
      characterId: "char-p1",
      attribute: "Wits",
      difficulty: "Average",
      roll: 1,
      rolls: [1],
      advantage: "none",
      visibility: "gm",
      outcome: "Success",
    };

    const critique = critiqueNarration({
      narration: "비공개 주사위 판정 결과, secret_footprints가 드러납니다.",
      resolvedChecks: [hiddenCheck],
      scene,
    });

    expect(critique.passed).toBe(false);
    expect(critique.warnings.map((w) => w.code)).toEqual([
      "unrevealed_clue_id_leaked",
      "hidden_gm_roll_exposed",
    ]);
  });

  it("warns from blackboard undiscovered clue ids even when scene is absent", () => {
    const critique = critiqueNarration({
      narration: "벽에는 mural_scratch라는 표식이 아직 희미하게 남아 있습니다.",
      resolvedChecks: [],
      blackboard: clueBlackboard(),
    });

    expect(critique.passed).toBe(false);
    expect(critique.warnings).toEqual([
      {
        code: "unrevealed_clue_id_leaked",
        message: "Narration mentions a clue id that is still unrevealed in ScenarioBlackboard.",
        detail: "mural_scratch",
      },
    ]);
  });
});
