import {
  createEmptyBlackboard,
  type FrontState,
  type NpcState,
  type ScenarioBlackboard,
} from "../core/scenario-blackboard.js";
import { seededPick } from "./seeded-random.js";

const GEESE_OPENING_PRANKS: readonly FrontState[] = [
  { id: "geese_prank_window_pie", name: "창턱의 파이 망치기" },
  { id: "geese_prank_fountain_ribbons", name: "분수대 축하 리본 전부 풀어헤치기" },
  { id: "geese_prank_bakery_bell", name: "빵집 종을 완벽히 엉뚱한 타이밍에 울리기" },
];

const GEESE_MIDGAME_PRANKS: readonly FrontState[] = [
  { id: "geese_prank_laundry_collapse", name: "빨랫줄 전면 붕괴" },
  { id: "geese_prank_mayor_wig", name: "시장님 가발 탈취" },
  { id: "geese_prank_market_labels", name: "장터 가격표 뒤죽박죽 만들기" },
  { id: "geese_prank_goat_parade", name: "염소 행렬을 광장 한복판으로 유도하기" },
];

const GEESE_FINALE_PRANKS: readonly FrontState[] = [
  { id: "geese_prank_festival_rehearsal", name: "축제 리허설 아수라장" },
  { id: "geese_prank_town_photo", name: "마을 단체 사진 완전 점령" },
  { id: "geese_prank_clocktower_chorus", name: "시계탑 종소리에 맞춘 대합창 난입" },
];

const GEESE_NPCS: readonly NpcState[] = [
  {
    npcId: "npc_baker_broom",
    name: "빗자루 든 빵집 주인",
    role: "파이의 수호자",
    attitudeByCharacter: {},
    goals: ["거위가 파이에 접근하면 빗자루를 든다", "파이를 살리려다 더 큰 소동을 만든다"],
    knownSecretIds: [],
    location: "village_square",
    pressureClockId: "warden_alert",
  },
  {
    npcId: "npc_goose_child",
    name: "거위를 편드는 꼬마",
    role: "혼돈의 응원단",
    attitudeByCharacter: {},
    goals: ["어른들의 시선을 엉뚱한 곳으로 돌린다", "거위가 귀엽다고 우기며 시간을 벌어 준다"],
    knownSecretIds: [],
    location: "village_square",
  },
  {
    npcId: "npc_mayor_vain",
    name: "체면이 전부인 시장님",
    role: "마을 질서의 얼굴",
    attitudeByCharacter: {},
    goals: ["가발과 위엄을 동시에 지킨다", "축제 손님 앞에서는 아무 일도 없는 척한다"],
    knownSecretIds: [],
    location: "mayor_garden",
    pressureClockId: "village_uproar",
  },
  {
    npcId: "npc_laundry_grandma",
    name: "빨랫줄 할머니",
    role: "골목의 감시자",
    attitudeByCharacter: {},
    goals: ["빨래를 사수하려고 창문마다 고개를 내민다", "거위 울음소리를 정확히 흉내 내어 맞받아친다"],
    knownSecretIds: [],
    location: "laundry_alley",
    pressureClockId: "warden_alert",
  },
  {
    npcId: "npc_sleepy_warden",
    name: "졸린 파수꾼",
    role: "늦게 발동하는 추격자",
    attitudeByCharacter: {},
    goals: ["처음엔 하품하지만 소동이 커지면 호루라기를 분다", "빗자루 든 사람들을 엉성하게 지휘한다"],
    knownSecretIds: [],
    location: "festival_ground",
    pressureClockId: "warden_alert",
  },
  {
    npcId: "npc_festival_director",
    name: "축제 준비 위원장",
    role: "리허설 통제자",
    attitudeByCharacter: {},
    goals: ["축제 동선을 끝까지 맞추려 한다", "거위를 무대 장치의 일부로 오해한다"],
    knownSecretIds: [],
    location: "festival_ground",
    pressureClockId: "village_uproar",
  },
];

function seedTerribleGeeseBlackboard(roomId: string, empty: ScenarioBlackboard): ScenarioBlackboard {
  const scenarioId = "terrible-geese";
  const selectedFronts = [
    ...seededPick(GEESE_OPENING_PRANKS, 1, `${roomId}:${scenarioId}:opening-prank`),
    ...seededPick(GEESE_MIDGAME_PRANKS, 2, `${roomId}:${scenarioId}:midgame-pranks`),
    ...seededPick(GEESE_FINALE_PRANKS, 1, `${roomId}:${scenarioId}:finale-prank`),
  ].map((front, index) => ({
    ...front,
    stage: index === 0 ? "진행 중" : "대기",
  }));
  const selectedNpcs = seededPick(GEESE_NPCS, 3, `${roomId}:${scenarioId}:village-npcs`);

  return {
    ...empty,
    sceneNodes: [
      { id: "village_square", name: "마을 광장", status: "active" },
      { id: "laundry_alley", name: "빨랫줄 골목" },
      { id: "mayor_garden", name: "시장 관저 정원" },
      { id: "festival_ground", name: "축제 준비장" },
    ],
    fronts: selectedFronts,
    clues: [],
    secrets: [],
    npcs: selectedNpcs.map((npc) => ({ ...npc, attitudeByCharacter: { ...npc.attitudeByCharacter }, goals: [...npc.goals], knownSecretIds: [] })),
    worldFlags: [
      { key: "prank_deck", value: selectedFronts.map((front) => front.id).join(",") },
      { key: "npc_deck", value: selectedNpcs.map((npc) => npc.npcId).join(",") },
    ],
  };
}

export function seedBlackboardForScenario(roomId: string, scenarioId: string): ScenarioBlackboard {
  const empty = createEmptyBlackboard(roomId, scenarioId);
  switch (scenarioId) {
    case "terrible-geese":
      return seedTerribleGeeseBlackboard(roomId, empty);
    case "the-sunless-crypt":
      return {
        ...empty,
        sceneNodes: [
          { id: "crypt_entrance", name: "Crypt entrance", status: "active" },
          { id: "chapel_interior", name: "Ruined chapel" },
        ],
        activeThreats: [{ id: "crypt_cold", name: "Unnatural crypt cold", status: "pressing" }],
        fronts: [{ id: "waking_crypt", name: "The crypt wakes", stage: "stirring" }],
        clues: [
          {
            id: "small_footprints",
            conclusion: "The children walked into the crypt rather than being dragged.",
            discoveryCondition: { kind: "scene_entry", sceneId: "crypt_entrance" },
            visibility: "undiscovered",
            redundantPathGroup: "children_entered_willingly",
          },
          {
            id: "ritual_symbol",
            conclusion: "The broken seal matches a warding rite, not a summoning mark.",
            discoveryCondition: { kind: "action_intent", intent: "inspect" },
            visibility: "undiscovered",
            redundantPathGroup: "seal_origin",
          },
          {
            id: "fresh_blood",
            conclusion: "Someone living was hurt recently at the chapel threshold.",
            discoveryCondition: { kind: "check_result", outcome: "Success" },
            visibility: "undiscovered",
            redundantPathGroup: "recent_violence",
          },
        ],
        secrets: [
          {
            id: "children_opened_crypt",
            truth: "The missing children opened the crypt willingly after hearing voices below.",
            sensitivity: "medium",
            revealState: "hidden",
            relatedClueIds: ["small_footprints"],
          },
          {
            id: "priest_knows_seal",
            truth: "The village priest recognizes the warding seal and is hiding prior knowledge of the crypt.",
            sensitivity: "high",
            revealState: "hidden",
            relatedClueIds: ["ritual_symbol", "fresh_blood"],
          },
        ],
        npcs: [
          {
            npcId: "npc_village_priest",
            name: "창백한 사제",
            role: "Village priest",
            attitudeByCharacter: {},
            goals: ["keep the party moving", "avoid explaining the old ward"],
            knownSecretIds: ["priest_knows_seal"],
            location: "crypt_entrance",
            pressureClockId: "crypt_alert",
          },
        ],
      };
    case "ashfall-monastery":
      return {
        ...empty,
        sceneNodes: [
          { id: "shattered_gate", name: "부서진 정문과 얼어붙은 성수반", status: "active" },
          { id: "bell_tower", name: "안개에 잠긴 종탑" },
          { id: "under_chapel", name: "예배당 지하 납골당" },
          { id: "monk_cells", name: "수도사 숙소" },
        ],
        activeThreats: [{ id: "ash_fog", name: "수도원 안쪽에서 번지는 잿빛 안개", status: "pressing" }],
        fronts: [{ id: "bell_seal_fails", name: "종의 봉인이 풀린다", stage: "첫 울림 전" }],
        clues: [
          {
            id: "blood_scrawl",
            conclusion: "마지막 수도사는 종을 치는 것이 아니라 멈추려 했다.",
            discoveryCondition: { kind: "scene_entry", sceneId: "shattered_gate" },
            visibility: "undiscovered",
            redundantPathGroup: "bell_is_a_seal",
          },
          {
            id: "worn_rope",
            conclusion: "종 줄은 수십 년간 안쪽에서 묶여 있었고, 누군가가 종을 붙잡아 왔다.",
            discoveryCondition: { kind: "action_intent", intent: "inspect" },
            visibility: "undiscovered",
            redundantPathGroup: "bell_is_a_seal",
          },
          {
            id: "frozen_bell_wax",
            conclusion: "성수반에 굳은 종랍은 축복이 아니라 울림을 막는 봉인 표식이다.",
            discoveryCondition: { kind: "check_result", outcome: "Success" },
            visibility: "undiscovered",
            redundantPathGroup: "bell_is_a_seal",
          },
          {
            id: "monk_ledger",
            conclusion: "종이 울리는 밤마다 안개 속 '돌아온 자'가 하나씩 늘었다.",
            discoveryCondition: { kind: "check_result", outcome: "Success" },
            visibility: "undiscovered",
            redundantPathGroup: "bell_calls_returned",
          },
          {
            id: "ossuary_scratches",
            conclusion: "납골당의 관 뚜껑은 밖에서 열렸고, 빈 관마다 같은 밤의 종소리가 기록되어 있다.",
            discoveryCondition: { kind: "scene_entry", sceneId: "under_chapel" },
            visibility: "undiscovered",
            redundantPathGroup: "bell_calls_returned",
          },
          {
            id: "fog_footprints",
            conclusion: "안개 속 발자국은 정문 밖으로 나가지 않고 종소리가 멎을 때마다 다시 안쪽으로 돌아온다.",
            discoveryCondition: { kind: "clock_state", clockId: "closing_fog", valueAtLeast: 3 },
            visibility: "undiscovered",
            redundantPathGroup: "bell_calls_returned",
          },
          {
            id: "keeper_shadow",
            conclusion: "종탑의 그림자는 망자가 아니라 살아 있는 사람이 스스로 몸을 묶고 버티는 형상이다.",
            discoveryCondition: { kind: "npc_state", npcId: "npc_last_monk", field: "location", value: "bell_tower" },
            visibility: "undiscovered",
            redundantPathGroup: "keeper_identity",
          },
          {
            id: "cell_prayer_strip",
            conclusion: "수도사 숙소의 기도문은 마지막 수도사가 자신의 이름을 지우고 종지기 직분만 남겼음을 암시한다.",
            discoveryCondition: { kind: "action_intent", intent: "read" },
            visibility: "undiscovered",
            redundantPathGroup: "keeper_identity",
          },
          {
            id: "returned_whisper",
            conclusion: "안개 속 돌아온 자들은 종지기를 원망하지 않고, 그가 쓰러지면 자신들이 풀려난다고 속삭인다.",
            discoveryCondition: { kind: "explicit_gm_trigger", triggerId: "returned_ones_speak" },
            visibility: "undiscovered",
            redundantPathGroup: "keeper_identity",
          },
        ],
        secrets: [
          {
            id: "last_monk_alive",
            truth: "마지막 수도사는 죽지 않았다. 종탑 안에서 스스로 종지기가 되어 종을 붙잡고 있다.",
            sensitivity: "high",
            revealState: "hidden",
            relatedClueIds: ["keeper_shadow", "cell_prayer_strip", "returned_whisper"],
          },
          {
            id: "bell_seals_returned",
            truth: "종은 망자를 부르는 물건이 아니라, 울림이 끝나기 전까지 돌아온 자들을 수도원 안에 묶어 두는 봉인이다.",
            sensitivity: "high",
            revealState: "hidden",
            relatedClueIds: ["blood_scrawl", "worn_rope", "frozen_bell_wax"],
          },
          {
            id: "returned_want_release",
            truth: "안개 속 돌아온 자들은 일행을 죽이려는 것보다 종지기를 무너뜨려 자신들을 풀어 줄 손을 찾고 있다.",
            sensitivity: "medium",
            revealState: "hidden",
            relatedClueIds: ["monk_ledger", "ossuary_scratches", "fog_footprints"],
          },
        ],
        npcs: [
          {
            npcId: "npc_last_monk",
            name: "잿빛 종지기",
            role: "마지막 수도사",
            attitudeByCharacter: {},
            goals: ["종이 끝까지 울리지 못하게 막는다", "낯선 이를 종탑에서 내쫓는다"],
            knownSecretIds: ["last_monk_alive", "bell_seals_returned"],
            location: "bell_tower",
            pressureClockId: "bell_toll",
          },
          {
            npcId: "npc_returned_novice",
            name: "안개 속 수련수사",
            role: "돌아온 자의 속삭임",
            attitudeByCharacter: {},
            goals: ["일행에게 종지기의 약점을 말하게 유도한다", "종이 끝까지 울리도록 시간을 번다"],
            knownSecretIds: ["returned_want_release"],
            location: "under_chapel",
            pressureClockId: "closing_fog",
          },
        ],
      };
    case "tidewatch-smugglers":
      return {
        ...empty,
        sceneNodes: [
          { id: "rain_pier", name: "비에 젖은 부두", status: "active" },
          { id: "ship_deck", name: "검은 갈매기호 갑판" },
          { id: "cargo_hold", name: "봉인된 화물칸" },
          { id: "captain_cabin", name: "선장실" },
        ],
        activeThreats: [{ id: "harbor_watch", name: "새벽 항만 순찰과 밀수단 감시", status: "watching" }],
        fronts: [{ id: "black_gull_departs", name: "검은 갈매기호가 항구를 떠난다", stage: "밧줄을 푸는 중" }],
        clues: [
          {
            id: "sealed_crate_manifest",
            conclusion: "화물 목록의 향신료 상자는 실제로는 숨 쉬는 석상 파편을 실은 봉인 상자다.",
            discoveryCondition: { kind: "scene_entry", sceneId: "rain_pier" },
            visibility: "undiscovered",
            redundantPathGroup: "cargo_truth",
          },
          {
            id: "salt_crystal_residue",
            conclusion: "화물칸 바닥의 소금 결정은 평범한 밀수품이 아니라 바다 제단에서 떼어 온 물건의 흔적이다.",
            discoveryCondition: { kind: "action_intent", intent: "inspect" },
            visibility: "undiscovered",
            redundantPathGroup: "cargo_truth",
          },
          {
            id: "captain_private_invoice",
            conclusion: "선장실의 비밀 청구서는 화물이 귀족 수집품이 아니라 항구 아래 결계를 여는 열쇠임을 보여 준다.",
            discoveryCondition: { kind: "check_result", outcome: "Success" },
            visibility: "undiscovered",
            redundantPathGroup: "cargo_truth",
          },
          {
            id: "wet_boot_drag",
            conclusion: "실종 선원은 바다에 빠진 것이 아니라 젖은 장화를 끌린 채 화물칸으로 옮겨졌다.",
            discoveryCondition: { kind: "scene_entry", sceneId: "rain_pier" },
            visibility: "undiscovered",
            redundantPathGroup: "missing_sailor_fate",
          },
          {
            id: "muffled_hold_knock",
            conclusion: "화물칸 안쪽에서 들리는 두 번-쉼-한 번의 두드림은 실종 선원이 아직 살아 있다는 신호다.",
            discoveryCondition: { kind: "clock_state", clockId: "discovery_risk", valueAtLeast: 2 },
            visibility: "undiscovered",
            redundantPathGroup: "missing_sailor_fate",
          },
          {
            id: "bloody_sailcloth",
            conclusion: "갑판 아래 피 묻은 돛천은 선원이 폭로하려다 제압당했지만 치명상은 피했다는 흔적이다.",
            discoveryCondition: { kind: "action_intent", intent: "search" },
            visibility: "undiscovered",
            redundantPathGroup: "missing_sailor_fate",
          },
          {
            id: "changed_watch_signal",
            conclusion: "오늘 새벽 경계 신호가 바뀐 것은 외부 경비가 아니라 밀수단 내부자가 일정을 앞당겼기 때문이다.",
            discoveryCondition: { kind: "scene_entry", sceneId: "rain_pier" },
            visibility: "undiscovered",
            redundantPathGroup: "inside_traitor",
          },
          {
            id: "bosun_second_key",
            conclusion: "갑판장이 가진 두 번째 화물칸 열쇠는 선장 몰래 상자를 열 수 있는 유일한 복제본이다.",
            discoveryCondition: { kind: "npc_state", npcId: "npc_bosun_mara", field: "attitude", value: "pressured" },
            visibility: "undiscovered",
            redundantPathGroup: "inside_traitor",
          },
          {
            id: "torn_payoff_note",
            conclusion: "찢긴 보수 쪽지는 배신자가 항만 순찰에도 밀수단에도 같은 정보를 팔았음을 드러낸다.",
            discoveryCondition: { kind: "explicit_gm_trigger", triggerId: "payoff_note_found" },
            visibility: "undiscovered",
            redundantPathGroup: "inside_traitor",
          },
        ],
        secrets: [
          {
            id: "cargo_is_tide_key",
            truth: "밀수품은 값비싼 장물이 아니라 조수감시 항구 아래 잠긴 결계를 여는 석상 파편이다.",
            sensitivity: "high",
            revealState: "hidden",
            relatedClueIds: ["sealed_crate_manifest", "salt_crystal_residue", "captain_private_invoice"],
          },
          {
            id: "sailor_locked_in_hold",
            truth: "실종 선원은 화물의 정체를 알고 선장실 장부를 훔치려다 화물칸 안 비밀 격실에 갇혔다.",
            sensitivity: "medium",
            revealState: "hidden",
            relatedClueIds: ["wet_boot_drag", "muffled_hold_knock", "bloody_sailcloth"],
          },
          {
            id: "bosun_is_traitor",
            truth: "갑판장 마라는 선장을 배신하고 화물을 항만 순찰과 경쟁 밀수단 양쪽에 팔아넘기려 한다.",
            sensitivity: "high",
            revealState: "hidden",
            relatedClueIds: ["changed_watch_signal", "bosun_second_key", "torn_payoff_note"],
          },
        ],
        npcs: [
          {
            npcId: "npc_dock_informant",
            name: "부두 정보상 라온",
            role: "부두 정보상",
            attitudeByCharacter: {},
            goals: ["승선 경로를 팔아 돈을 챙긴다", "자신이 제보자라는 흔적을 남기지 않는다"],
            knownSecretIds: ["sailor_locked_in_hold"],
            location: "rain_pier",
            pressureClockId: "discovery_risk",
          },
          {
            npcId: "npc_captain_sera",
            name: "선장 세라 바늘눈",
            role: "검은 갈매기호 선장",
            attitudeByCharacter: {},
            goals: ["물때 전에 출항한다", "화물의 진짜 구매자를 끝까지 숨긴다"],
            knownSecretIds: ["cargo_is_tide_key"],
            location: "captain_cabin",
            pressureClockId: "departure_tide",
          },
          {
            npcId: "npc_bosun_mara",
            name: "갑판장 마라",
            role: "밀수단 내부 배신자",
            attitudeByCharacter: {},
            goals: ["선장보다 먼저 화물의 값을 챙긴다", "실종 선원이 말하기 전에 처리한다"],
            knownSecretIds: ["bosun_is_traitor", "sailor_locked_in_hold"],
            location: "ship_deck",
            pressureClockId: "discovery_risk",
          },
        ],
      };
    default:
      return empty;
  }
}
