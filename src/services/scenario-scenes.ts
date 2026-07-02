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
    case "ashfall-monastery":
      return makeSceneState({
        sceneId: "shattered_gate",
        location: "산정 수도원의 부서진 정문, 얼어붙은 성수반과 핏빛 낙서 앞",
        sceneGoal: "마지막 수도사가 남긴 흔적을 따라 밤마다 울리는 종소리의 의미를 알아낸다",
        currentTension: "눈보라가 멎었는데도 잿빛 안개가 정문 안쪽에서만 천천히 흘러나온다",
        presentNpcs: [],
        visibleThreats: ["성수반 위에 얼어붙은 검은 피", "정문 너머에서 한 박자 늦게 울리는 희미한 종소리"],
        availableClues: ["blood_scrawl", "frozen_bell_wax", "fog_footprints"],
        revealedClues: [],
        exits: ["bell_tower", "under_chapel", "monk_cells"],
        lastGmQuestion: "핏빛 낙서를 먼저 살필 건가요, 아니면 안개 속 종소리를 따라 들어갈 건가요?",
      });
    case "tidewatch-smugglers":
      return makeSceneState({
        sceneId: "rain_pier",
        location: "비에 젖은 조수감시 항구의 7번 부두, 검은 갈매기호의 흔들리는 현문 앞",
        sceneGoal: "출항 전에 배에 접근해 사라진 화물과 실종 선원의 단서를 확보한다",
        currentTension: "새벽 물때가 차오르고, 밀수단의 등불이 부두 끝에서 하나씩 켜진다",
        presentNpcs: [
          {
            id: "npc_dock_informant",
            name: "부두 정보상 라온",
            disposition: "wary",
            visibleIntent: "대가를 받고 승선 경로를 넘기되 자신의 이름은 숨기려 한다",
          },
        ],
        visibleThreats: ["순찰 중인 항만 경비", "출항 준비를 서두르는 밀수단 선원들"],
        availableClues: ["sealed_crate_manifest", "wet_boot_drag", "changed_watch_signal"],
        revealedClues: [],
        exits: ["ship_deck", "cargo_hold", "captain_cabin"],
        lastGmQuestion: "정보상에게 말을 붙일 건가요, 아니면 곧장 배로 숨어들 건가요?",
      });
    case "terrible-geese":
      return makeSceneState({
        sceneId: "village_square",
        location: "이슬 맺힌 마을 광장, 창턱의 파이가 식어 가고 분수대 리본이 바람에 흔들리는 아침",
        sceneGoal: "창턱에서 식어 가는 파이를 망쳐 첫 장난을 성공시킨다",
        currentTension: "아직 마을은 평화롭지만, 빵집 주인의 눈이 창턱과 거위 무리를 번갈아 본다",
        presentNpcs: [
          {
            id: "npc_baker_broom",
            name: "빗자루 든 빵집 주인",
            disposition: "wary",
            visibleIntent: "파이를 지키려고 창문 아래를 서성인다",
          },
        ],
        visibleThreats: ["파이를 지키려는 빵집 주인의 빗자루", "광장 한복판에서 모든 소리를 키우는 분수대"],
        availableClues: [],
        revealedClues: [],
        exits: ["laundry_alley", "mayor_garden", "festival_ground"],
        lastGmQuestion: "몰래 다가가 파이를 노릴 건가요, 아니면 먼저 광장의 시선을 다른 곳으로 돌릴 건가요?",
      });
    case "until-it-sinks":
      return makeSceneState({
        sceneId: "hotel_ballroom",
        location: "바다를 마주한 오래된 호텔 연회장, 첫째 날 저녁 식탁 주변",
        sceneGoal: "첫째 날 아침 해변에서 발견된 낚시꾼의 죽음을 두고 저녁 대화를 시작한다",
        currentTension: "첫째 날 저녁, 호텔의 유일한 다른 손님이던 낚시꾼은 그날 아침 해변에서 시체로 발견되었다",
        presentNpcs: [],
        visibleThreats: ["고립된 섬과 불길하게 높아지는 바닷물", "사고인지 살인인지 알 수 없는 낚시꾼의 죽음"],
        availableClues: [],
        revealedClues: [],
        exits: ["beach", "fisherman_grave", "hotel_front"],
        lastGmQuestion: "누가 먼저 낚시꾼의 죽음에 대해 입을 열까요?",
      });
    default:
      return null;
  }
}
