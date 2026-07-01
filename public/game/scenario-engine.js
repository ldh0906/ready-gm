// @ts-check
/**
 * 장면(Scene) 엔진 — 판정 결과가 "의미를 갖도록" 상태를 누적하는 로컬 시뮬레이션.
 *
 * 실제 플레이에서는 AI GM(서버 LLM)이 풍부한 서술을 생성하지만, 이 모듈은 LLM 없이
 * 도는 테스트 하니스용으로 다음을 제공한다:
 *  - 장면별 진행도(progress)·위기(peril) 누적 상태
 *  - 결과 등급(대성공/성공/부분 성공/실패)에 따른 상태 변화와 맥락 있는 다단계 서술
 *  - 진행도를 채우면 성공 클라이맥스, 위기가 가득 차면 실패 결말
 *
 * DOM·난수에 의존하지 않는 순수 함수라 테스트 가능하다. 서술 후보 선택은 roll 값 등
 * 결정적 입력으로 고르므로 재현 가능하다.
 */

import { ATTRIBUTES, DIFFICULTY_LABELS, OUTCOME_LABELS } from "./judge.js";

/**
 * @typedef {Object} Scenario
 * @property {string} id
 * @property {string} title
 * @property {string} intro 오프닝 서술
 * @property {string} goal 장면 목표(헤더 표시용)
 * @property {number} progressNeeded 성공으로 끝내기 위한 진행도
 * @property {number} perilMax 실패로 끝나는 위기 한도
 * @property {string[]} critBeats 대성공 시 진행 묘사 조각
 * @property {string[]} successBeats 성공 시 진행 묘사 조각
 * @property {string[]} partialBeats 부분 성공(대가) 묘사 조각
 * @property {string[]} failBeats 실패 묘사 조각
 * @property {string[]} perilEvents 위기가 오를 때 등장하는 위협/합병증
 * @property {string} successEnding 진행도 달성 시 결말
 * @property {string} failEnding 위기 한도 도달 시 결말
 */

/** 테스트용 시나리오들(각자 맥락 있는 결과 조각을 가진다). @type {Scenario[]} */
export const SCENARIOS = Object.freeze([
  {
    id: "broken-bridge",
    title: "무너진 돌다리",
    intro:
      "안개가 소용돌이치는 협곡 위, 무너진 돌다리가 건너편 제단으로 이어진다. 제단의 푸른 빛이 약해지고 있다 — 빛이 꺼지기 전에 건너야 한다.",
    goal: "제단에 도달하기",
    progressNeeded: 4,
    perilMax: 4,
    critBeats: [
      "발판을 정확히 디뎌 단숨에 크게 전진한다. 무너진 틈이 오히려 디딤돌이 된다.",
      "완벽한 균형으로 흔들리는 구간을 가로지른다. 제단의 빛이 손에 닿을 듯 가까워진다.",
    ],
    successBeats: [
      "조심스레 무게를 분산하며 한 구간을 안전하게 건넌다.",
      "갈라진 돌 사이로 길을 찾아 앞으로 나아간다.",
    ],
    partialBeats: [
      "건너긴 했지만 배낭의 끈이 끊겨 보급품 하나가 안개 속으로 떨어진다.",
      "겨우 발을 디뎠으나 돌 하나가 무너져 발목을 접질린다. 전진은 했다.",
    ],
    failBeats: [
      "디딘 돌이 통째로 무너진다. 가까스로 난간을 붙잡지만 제자리다.",
      "발을 헛디뎌 미끄러진다 — 손끝으로 매달려 겨우 추락을 면한다.",
    ],
    perilEvents: [
      "다리 전체가 불길하게 삐걱인다. 남은 시간이 줄어든다.",
      "협곡 아래에서 무언가가 깨어난 듯, 안개가 거칠게 솟구친다.",
      "제단의 빛이 한층 더 어두워진다.",
    ],
    successEnding:
      "마지막 도약으로 제단에 올라선다. 손을 대자 푸른 빛이 다시 타오르며 다리 전체가 환하게 드러난다. 당신은 해냈다.",
    failEnding:
      "다리가 굉음과 함께 붕괴한다. 제단의 빛이 꺼지고, 당신은 안개 속으로 후퇴할 수밖에 없다. 이 길은 닫혔다.",
  },
  {
    id: "sealed-door",
    title: "봉인의 문",
    intro:
      "룬이 새겨진 차가운 문 앞. 너머에서 무언가 긁는 소리가 점점 커진다. 봉인을 풀거나, 풀리기 전에 대비해야 한다.",
    goal: "봉인을 안전하게 해제하기",
    progressNeeded: 4,
    perilMax: 4,
    critBeats: [
      "룬의 배열이 머릿속에서 또렷이 풀린다. 한 단계를 통째로 건너뛰어 해제한다.",
      "정확한 손놀림에 룬이 차례로 빛을 잃는다. 봉인이 눈에 띄게 약해진다.",
    ],
    successBeats: [
      "룬 하나의 의미를 읽어내고 올바른 순서로 짚어 누른다.",
      "차분히 결을 따라가며 봉인의 한 겹을 벗겨낸다.",
    ],
    partialBeats: [
      "룬이 풀리지만 날카로운 마력 반동이 손등을 찢는다. 진전은 있다.",
      "한 겹을 벗겼으나 경보 룬을 건드려 안쪽의 긁는 소리가 사나워진다.",
    ],
    failBeats: [
      "잘못된 룬을 짚자 문 전체가 붉게 번뜩이며 저항한다.",
      "손이 미끄러져 봉인이 도로 단단해진다. 처음으로 되돌아온 듯하다.",
    ],
    perilEvents: [
      "문 너머의 긁는 소리가 두드리는 소리로 바뀐다.",
      "경첩 사이로 검은 연기가 새어 나온다.",
      "바닥의 룬들이 일제히 깜빡이기 시작한다.",
    ],
    successEnding:
      "마지막 룬이 빛을 잃고, 봉인이 한숨처럼 풀린다. 문이 조용히 열리고 — 당신은 준비된 채로 너머와 마주한다.",
    failEnding:
      "봉인이 폭주하며 문이 안쪽으로 터져 나간다. 검은 형체가 쏟아져 들어온다. 최악의 방식으로 문이 열렸다.",
  },
  {
    id: "suspicious-merchant",
    title: "수상한 상인",
    intro:
      "여관 구석, 상인이 당신을 빤히 본다. 소매 안에서 단검 손잡이가 언뜻 보인다. 그의 의도를 알아내거나, 상황을 통제해야 한다.",
    goal: "상인을 무력 없이 제압·설득하기",
    progressNeeded: 4,
    perilMax: 4,
    critBeats: [
      "정곡을 찌르는 한마디에 상인의 표정이 무너진다. 주도권이 완전히 당신에게 넘어온다.",
      "그의 거짓을 단숨에 간파해 되받아친다. 상인이 식은땀을 흘린다.",
    ],
    successBeats: [
      "차분한 말로 상인의 경계를 한 꺼풀 누그러뜨린다.",
      "그의 말 속 모순을 짚어내 우위를 점한다.",
    ],
    partialBeats: [
      "상인이 한발 물러서지만, 옆 테이블의 동료에게 은밀히 신호를 보낸다.",
      "설득은 먹혔으나 당신의 약점 하나를 들켜버린다.",
    ],
    failBeats: [
      "상인이 코웃음 치며 단검 손잡이를 더 드러낸다.",
      "말이 헛돌고, 상인의 눈빛이 차갑게 굳는다.",
    ],
    perilEvents: [
      "여관 문가에 험상궂은 사내 둘이 새로 들어선다.",
      "상인의 손이 천천히 소매 속으로 들어간다.",
      "주변 손님들이 슬그머니 자리를 피한다.",
    ],
    successEnding:
      "상인이 마침내 두 손을 들어 보인다. 그는 단검을 탁자에 내려놓고 자신이 아는 것을 털어놓기 시작한다. 당신이 상황을 쥐었다.",
    failEnding:
      "상인이 외친다 — 신호다. 사방에서 칼이 뽑힌다. 협상은 끝났고, 이제 다른 방법뿐이다.",
  },
]);

/**
 * @typedef {Object} SceneState
 * @property {Scenario} scenario
 * @property {number} progress
 * @property {number} peril
 * @property {number} step 시도 횟수
 * @property {boolean} done 장면 종료 여부
 * @property {"success" | "failure" | null} sceneOutcome 종료 결과
 */

/**
 * 새 장면 상태를 만든다.
 * @param {Scenario} scenario
 * @returns {SceneState}
 */
export function createScene(scenario) {
  return {
    scenario,
    progress: 0,
    peril: 0,
    step: 0,
    done: false,
    sceneOutcome: null,
  };
}

/**
 * 결과 등급에 따른 진행도/위기 변화량.
 *
 * 대성공(Critical Success)은 TRPG 관례를 따른다:
 *  - Blades in the Dark — 크리티컬은 "증가된 효과(increased effect)"로, 의도한
 *    것보다 훨씬 큰 성과를 낸다.
 *  - Pathfinder 2e — 대성공은 일반 성공보다 한 단계 위의, 판도를 바꾸는 결과다.
 * 그래서 대성공은 일반 성공(+1)을 크게 웃도는 결정적 도약(+3)을 주고, 동시에 위기를
 * 두 단계 끌어내려(-2) 상황 전체를 뒤집는다. 이 큰 진폭이 "대성공 = 엄청난 변화"라는
 * 체감을 만든다.
 *
 * @param {keyof typeof OUTCOME_LABELS} outcome
 * @returns {{ progress: number, peril: number }}
 */
export function outcomeEffect(outcome) {
  switch (outcome) {
    case "Critical Success":
      return { progress: 3, peril: -2 };
    case "Success":
      return { progress: 1, peril: 0 };
    case "Partial Success":
      return { progress: 1, peril: 1 };
    case "Failure":
    default:
      return { progress: 0, peril: 1 };
  }
}

/** roll 값으로 후보 배열에서 결정적으로 하나 고른다. */
function pick(arr, roll) {
  const list = Array.isArray(arr) && arr.length > 0 ? arr : [""];
  return list[Math.abs(roll) % list.length];
}

/**
 * 판정 결과를 장면에 적용한다(불변: 새 상태 + 서술 반환).
 *
 * 서술은 여러 단락으로 구성된다:
 *  1) 결과 한 줄(능력치·난이도·등급)
 *  2) 맥락 있는 결과 묘사(시나리오·등급별 조각)
 *  3) 상태 변화(진행/위기) 또는 새 위협(perilEvent)
 *  4) 장면이 끝나면 성공/실패 결말, 아니면 다음 상황 훅
 *
 * @param {SceneState} scene
 * @param {{ actionText: string, attribute: keyof typeof ATTRIBUTES, difficulty: keyof typeof DIFFICULTY_LABELS, outcome: keyof typeof OUTCOME_LABELS, roll: number }} input
 * @returns {{ scene: SceneState, narration: string, delta: { progress: number, peril: number }, ended: boolean }}
 */
export function applyOutcome(scene, input) {
  if (scene.done) {
    return { scene, narration: "이미 장면이 끝났습니다. 새 상황을 시작하세요.", delta: { progress: 0, peril: 0 }, ended: true };
  }
  const sc = scene.scenario;
  const { outcome, roll } = input;
  const eff = outcomeEffect(outcome);

  const progress = Math.max(0, scene.progress + eff.progress);
  const peril = Math.max(0, scene.peril + eff.peril);
  const step = scene.step + 1;

  let done = false;
  /** @type {"success" | "failure" | null} */
  let sceneOutcome = null;
  if (progress >= sc.progressNeeded) {
    done = true;
    sceneOutcome = "success";
  } else if (peril >= sc.perilMax) {
    done = true;
    sceneOutcome = "failure";
  }

  /** @type {SceneState} */
  const next = { scenario: sc, progress, peril, step, done, sceneOutcome };

  // ---- 서술 구성 ----
  const lines = [];
  // 1) 결과 헤드라인
  lines.push(
    `${ATTRIBUTES[input.attribute]} · ${DIFFICULTY_LABELS[input.difficulty]} 판정 → ${OUTCOME_LABELS[outcome]}`,
  );

  // 1-b) 대성공은 판도를 바꾸는 결정적 순간임을 명시한다(TRPG의 "엄청난 변화").
  if (outcome === "Critical Success") {
    lines.push("◇ 결정적 대성공 — 단숨에 판도가 뒤집힌다!");
  }

  // 2) 맥락 묘사
  const beatPool =
    outcome === "Critical Success"
      ? sc.critBeats
      : outcome === "Success"
        ? sc.successBeats
        : outcome === "Partial Success"
          ? sc.partialBeats
          : sc.failBeats;
  lines.push(pick(beatPool, roll));

  // 3) 상태 변화 / 새 위협
  if (eff.progress > 0) {
    lines.push(`(진행 +${eff.progress} → ${progress}/${sc.progressNeeded})`);
  }
  if (eff.peril > 0) {
    // 위기가 오르면 위협이 하나 등장한다.
    lines.push(pick(sc.perilEvents, roll + step));
    lines.push(`(위기 +${eff.peril} → ${peril}/${sc.perilMax})`);
  } else if (eff.peril < 0) {
    lines.push(`(대성공으로 위기가 가라앉는다 → ${peril}/${sc.perilMax})`);
  }

  // 4) 결말 또는 다음 훅
  if (done && sceneOutcome === "success") {
    lines.push("");
    lines.push("◆ " + sc.successEnding);
  } else if (done && sceneOutcome === "failure") {
    lines.push("");
    lines.push("◆ " + sc.failEnding);
  } else {
    lines.push(nextHook(next));
  }

  return { scene: next, narration: lines.join("\n"), delta: eff, ended: done };
}

/**
 * 다음 행동을 유도하는 상황 훅을 만든다(진행/위기 상태에 따라 톤이 달라진다).
 * @param {SceneState} scene
 * @returns {string}
 */
export function nextHook(scene) {
  const sc = scene.scenario;
  const remaining = sc.progressNeeded - scene.progress;
  if (scene.peril >= sc.perilMax - 1) {
    return `상황이 위태롭다. 한 번만 더 어긋나면 끝이다 — 어떻게 하겠는가? (목표까지 ${remaining}단계)`;
  }
  if (remaining <= 1) {
    return `거의 다 왔다. 마지막 고비를 어떻게 넘기겠는가?`;
  }
  return `상황이 이어진다. 다음 행동은? (목표까지 ${remaining}단계)`;
}
