/**
 * Static Scene State seeds per scenario (ai-architecture.md Phase 1 — start from
 * hand-authored scenes until a Front/Scene planner generates them).
 *
 * The opening scene grounds the GM: where the party is, what they want here,
 * who/what is present, which clues can be found, and the ways out.
 */
import { makeSceneState, type SceneState } from "../core/scene-state.js";

/** Build the opening Scene State for a scenario id; unknown scenarios get none. */
export function seedSceneForScenario(scenarioId: string): SceneState | null {
  switch (scenarioId) {
    case "the-sunless-crypt":
      return makeSceneState({
        sceneId: "crypt_entrance",
        location: "무너진 예배당 뒤편, 지하 묘지로 내려가는 깨진 봉인 계단 앞",
        sceneGoal: "사라진 아이들이 끌려간 방향을 찾아 지하로 내려간다",
        currentTension: "해가 지고 있고, 묘지의 봉인은 안에서 무언가에 의해 깨져 있다",
        presentNpcs: [
          {
            id: "npc_village_priest",
            name: "창백한 사제",
            disposition: "wary",
            visibleIntent: "일행을 재촉하면서도 묘지에 대한 무언가를 숨긴다",
          },
        ],
        visibleThreats: ["깨진 봉인에서 새어 나오는 냉기", "지하에서 울리는 희미한 소리"],
        availableClues: ["small_footprints", "ritual_symbol", "fresh_blood"],
        revealedClues: [],
        exits: ["crypt_stairs", "chapel_interior"],
        lastGmQuestion: "봉인을 조용히 살필 건가요, 아니면 곧장 계단을 내려갈 건가요?",
      });
    default:
      return null;
  }
}
