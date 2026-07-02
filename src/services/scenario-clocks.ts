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
    case "ashfall-monastery":
      return [
        makeClock({
          id: "bell_toll",
          name: "끝내 울리는 종",
          scope: "front",
          max: 8,
          value: 0,
          onComplete: "returned_ones_arrive",
          consequence:
            "종이 끝까지 울리고 잿빛 안개 속 '돌아온 자들'이 수도원 문턱을 넘는다. 남은 길은 악몽 같은 결말뿐이다.",
          onCompleteEffects: [
            { type: "add_threat", threat: "안개 속에서 문턱을 넘어오는 돌아온 자들" },
            { type: "force_ending" },
          ],
        }),
        makeClock({
          id: "closing_fog",
          name: "출구를 지우는 안개",
          scope: "scene",
          max: 6,
          value: 0,
          onComplete: "fog_erases_exits",
          consequence: "잿빛 안개가 수도원의 길목과 발자국을 삼켜, 일행이 들어온 문과 산길의 방향을 지운다.",
          onCompleteEffects: [{ type: "add_threat", threat: "출구를 지운 잿빛 안개" }],
        }),
      ];
    case "tidewatch-smugglers":
      return [
        makeClock({
          id: "discovery_risk",
          name: "발각 위험",
          scope: "scene",
          max: 6,
          value: 0,
          onComplete: "smugglers_identify_intruders",
          consequence: "밀수단이 일행의 정체를 눈치챈다. 부두와 배 안의 시선이 한꺼번에 좁혀 온다.",
          onCompleteEffects: [{ type: "add_threat", threat: "정체를 눈치챈 밀수단" }],
        }),
        makeClock({
          id: "departure_tide",
          name: "출항 물때",
          scope: "front",
          max: 8,
          value: 0,
          onComplete: "black_gull_departure",
          consequence: "물때가 차오르고 검은 갈매기호가 밧줄을 끊듯 항구를 떠난다. 진실도 인질도 배와 함께 사라진다.",
          onCompleteEffects: [
            { type: "add_threat", threat: "항구를 벗어나는 검은 갈매기호" },
            { type: "force_ending" },
          ],
        }),
      ];
    case "terrible-geese":
      return [
        makeClock({
          id: "village_uproar",
          name: "마을의 봉기",
          scope: "front",
          max: 8,
          value: 0,
          onComplete: "village_organizes_goose_sweep",
          consequence: "마을 사람들이 더는 당하지 않겠다고 외치며 조직적으로 거위 소탕에 나선다.",
          onCompleteEffects: [
            { type: "add_threat", threat: "조직적으로 거위 소탕에 나선 마을 사람들" },
            { type: "force_ending" },
          ],
        }),
        makeClock({
          id: "warden_alert",
          name: "파수꾼 경계",
          scope: "scene",
          max: 6,
          value: 0,
          onComplete: "broom_warden_mob",
          consequence: "호루라기 소리에 빗자루를 든 파수꾼 무리가 골목 끝에서 우르르 나타난다.",
          onCompleteEffects: [{ type: "add_threat", threat: "빗자루를 든 파수꾼 무리" }],
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
    case "tidewatch-smugglers":
      // An infiltration caper: visible gauges make risk and tide deadlines legible.
      return true;
    case "terrible-geese":
      // Comedy works better when everyone can see exactly how much trouble is piling up.
      return true;
    default:
      return false;
  }
}
