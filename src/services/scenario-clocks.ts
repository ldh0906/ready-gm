/**
 * Static Progress Clock seeds per scenario (ai-architecture.md Phase 1: "Front는
 * 사람이 작성하거나 static seed로 시작한다").
 *
 * Until a Front Planner model generates clocks dynamically (deferred — see
 * {@link import("../ai/blackboard-scope.js")}), each scenario starts a session
 * with a hand-authored set of clocks. These are the scene/front pressure gauges
 * the hot-path GM advances via `clockDeltas` as the round resolves.
 */
import { makeClock, type ProgressClock } from "../core/progress-clock.js";

/** Build the seed clocks for a scenario id; unknown scenarios get no clocks. */
export function seedClocksForScenario(scenarioId: string): ProgressClock[] {
  switch (scenarioId) {
    case "the-sunless-crypt":
      return [
        makeClock({
          id: "crypt_alert",
          name: "묘지 경계도",
          scope: "scene",
          max: 6,
          value: 0,
          onComplete: "skeleton_patrol_arrives",
          consequence: "묘지의 망자들이 침입자를 감지한다. 해골 순찰대가 통로를 막아서며 일행을 덮친다.",
          onCompleteEffects: [
            { type: "add_threat", threat: "통로를 막아선 해골 순찰대" },
            {
              type: "add_npc",
              npc: {
                id: "npc_skeleton_patrol",
                name: "해골 순찰대",
                disposition: "hostile",
                visibleIntent: "침입자의 퇴로를 끊고 제압한다",
              },
            },
          ],
        }),
        makeClock({
          id: "ritual_progress",
          name: "의식 완성",
          scope: "front",
          max: 8,
          value: 0,
          onComplete: "ritual_breaks_seal",
          consequence: "지하의 의식이 완성되어 봉인이 갈라진다. 태양 없는 존재가 깨어나 묘지 전체가 진동한다.",
          onCompleteEffects: [
            { type: "add_threat", threat: "봉인을 깨고 깨어난 태양 없는 존재" },
            { type: "force_ending" },
          ],
        }),
      ];
    default:
      return [];
  }
}

/**
 * Whether a scenario's Progress Clocks should be SHOWN to players (a visible
 * Blades-style gauge) vs. kept hidden (so unseen pressure builds dread). This is
 * a per-scenario tone lever; default is hidden for scenarios not listed here.
 */
export function areClocksVisible(scenarioId: string): boolean {
  switch (scenarioId) {
    case "the-sunless-crypt":
      // A dungeon delve: a visible "alarm rising" gauge sharpens the tension.
      return true;
    default:
      return false;
  }
}
