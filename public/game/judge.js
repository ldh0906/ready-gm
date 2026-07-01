// @ts-check
/**
 * 로컬 "AI 판정관" 순수 로직 (시나리오 테스트 하니스용)
 *
 * 실제 AI GM은 서버에서 EZFudge로 판정하지만, 이 모듈은 플레이어가 직접 주사위를
 * 굴리는 체험을 위한 가벼운 규칙 기반 판정관이다. 행동 문장에서 키워드로 능력치와
 * 난이도를 고르고(pickCheck), d20 결과를 난이도 목표값과 비교해 결과 등급을 낸다
 * (resolveOutcome). DOM·난수에 의존하지 않는 순수 함수라 테스트 가능하다.
 *
 * 프로젝트 도메인 용어와 정렬:
 * - AttributeKey: Might/Agility/Wits/Spirit (src/core/types.ts)
 * - DifficultyGrade: Trivial/Easy/Average/Hard/Formidable
 * - OutcomeGrade: Failure/Partial Success/Success/Critical Success
 */

/** 능력치(한국어 라벨 포함). */
export const ATTRIBUTES = Object.freeze({
  Might: "힘",
  Agility: "민첩",
  Wits: "기지",
  Spirit: "정신",
});

/** 난이도 등급별 d20 목표값(이 값 이상이면 성공권). */
export const DIFFICULTY_TARGETS = Object.freeze({
  Trivial: 5,
  Easy: 8,
  Average: 11,
  Hard: 14,
  Formidable: 17,
});

/** 난이도 한국어 라벨. */
export const DIFFICULTY_LABELS = Object.freeze({
  Trivial: "매우 쉬움",
  Easy: "쉬움",
  Average: "보통",
  Hard: "어려움",
  Formidable: "지극히 어려움",
});

/** 결과 등급 한국어 라벨. */
export const OUTCOME_LABELS = Object.freeze({
  Failure: "실패",
  "Partial Success": "부분 성공",
  Success: "성공",
  "Critical Success": "대성공",
});

/**
 * 능력치별 키워드(행동 문장에서 어떤 능력치 판정인지 추정).
 * @type {Readonly<Record<keyof typeof ATTRIBUTES, string[]>>}
 */
const ATTRIBUTE_KEYWORDS = Object.freeze({
  Might: ["밀", "들어", "부수", "힘", "당기", "들", "끌", "막아", "버티", "내려치", "넘어뜨", "부순"],
  Agility: ["뛰", "점프", "피하", "달리", "기어", "균형", "몰래", "숨", "도약", "재빠", "회피", "올라"],
  Wits: ["살펴", "조사", "관찰", "기억", "추리", "해독", "함정", "분석", "찾", "읽", "calc", "계산", "파악"],
  Spirit: ["설득", "위협", "협상", "기도", "집중", "용기", "견디", "의지", "달래", "거짓말", "매혹", "저항"],
});

/** 난이도 추정용 키워드(어려운/위험한 행동일수록 난이도 상승). */
const HARD_KEYWORDS = ["거대한", "위험", "절벽", "용", "마법", "봉인", "함정", "수문장", "보스", "폭발", "깊은"];
const EASY_KEYWORDS = ["작은", "간단", "천천히", "조심", "가벼운", "쉬운"];

/** 유리(advantage) 정황 키워드: 기습/준비/우위 등. */
const ADVANTAGE_KEYWORDS = [
  "기습", "몰래", "기회", "조준", "겨냥", "준비", "대비", "높은", "위에서", "협공", "둘이서",
  "함께", "도움", "거들", "유인", "약점", "빈틈", "방심한", "무방비", "선제",
];
/** 불리(disadvantage) 정황 키워드: 기습당함/시야 차단/방해 등. */
const DISADVANTAGE_KEYWORDS = [
  "어둠", "어두운", "안개", "보이지", "엄폐", "숨은", "가려진", "넘어진", "넘어져", "속박",
  "묶인", "부상", "지친", "탈진", "쫓기", "허둥", "불리한", "미끄러운", "혼란", "포위",
];

/**
 * 행동 문장에서 상황 유리/불리(advantage/disadvantage)를 추정한다.
 *
 * D&D 5e식: 유리하면 d20 2개 중 높은 값, 불리하면 낮은 값을 채택한다. 유리 정황과
 * 불리 정황이 모두 감지되면 서로 상쇄되어 "none"(보통 1개 굴림)이 된다.
 *
 * @param {string} actionText
 * @returns {{ advantage: "advantage" | "disadvantage" | "none", reason: string | null }}
 */
export function pickCircumstance(actionText) {
  const lower = String(actionText == null ? "" : actionText).toLowerCase();
  const advHits = ADVANTAGE_KEYWORDS.filter((k) => lower.includes(k.toLowerCase()));
  const disHits = DISADVANTAGE_KEYWORDS.filter((k) => lower.includes(k.toLowerCase()));
  const hasAdv = advHits.length > 0;
  const hasDis = disHits.length > 0;

  // 5e 규칙: 유리+불리는 상쇄되어 보통 굴림.
  if (hasAdv && hasDis) {
    return { advantage: "none", reason: `유리(${advHits[0]})와 불리(${disHits[0]}) 정황이 상쇄됩니다.` };
  }
  if (hasAdv) {
    return { advantage: "advantage", reason: `유리한 정황 감지: "${advHits[0]}".` };
  }
  if (hasDis) {
    return { advantage: "disadvantage", reason: `불리한 정황 감지: "${disHits[0]}".` };
  }
  return { advantage: "none", reason: null };
}

/**
 * 결정적 변동을 위한 간단한 문자열 해시(같은 입력엔 같은 난이도 흔들림).
 * @param {string} s
 * @returns {number}
 */
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 행동 문장으로부터 판정(능력치 + 난이도)을 고른다.
 *
 * - 능력치: 키워드 매칭 점수가 가장 높은 능력치, 동점/무매칭이면 문자열 해시로 결정.
 * - 난이도: 기본 Average에서 hard/easy 키워드와 문장 길이·해시로 한 단계씩 조정.
 *
 * @param {string} actionText 플레이어가 친 행동/채팅
 * @returns {{ attribute: keyof typeof ATTRIBUTES, difficulty: keyof typeof DIFFICULTY_TARGETS, reason: string }}
 */
export function pickCheck(actionText) {
  const text = String(actionText == null ? "" : actionText);
  const lower = text.toLowerCase();

  // 능력치 점수.
  /** @type {(keyof typeof ATTRIBUTES)[]} */
  const keys = /** @type {any} */ (Object.keys(ATTRIBUTE_KEYWORDS));
  let best = keys[0];
  let bestScore = -1;
  for (const key of keys) {
    let score = 0;
    for (const kw of ATTRIBUTE_KEYWORDS[key]) {
      if (lower.includes(kw.toLowerCase())) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = key;
    }
  }
  const hash = hashString(text);
  if (bestScore <= 0) {
    // 매칭이 없으면 해시로 능력치를 고르게 분배(무작위처럼 보이되 결정적).
    best = keys[hash % keys.length];
  }

  // 난이도: Average 기준에서 조정.
  /** @type {(keyof typeof DIFFICULTY_TARGETS)[]} */
  const ladder = ["Trivial", "Easy", "Average", "Hard", "Formidable"];
  let level = 2; // Average
  for (const kw of HARD_KEYWORDS) if (lower.includes(kw)) level += 1;
  for (const kw of EASY_KEYWORDS) if (lower.includes(kw)) level -= 1;
  // 긴 문장은 복잡한 시도로 보아 약간 어렵게, 해시로 ±1 흔들림.
  if (text.trim().length > 40) level += 1;
  level += (hash % 3) - 1; // -1, 0, +1
  level = Math.max(0, Math.min(ladder.length - 1, level));
  const difficulty = ladder[level];

  const circumstance = pickCircumstance(text);
  const baseReason =
    bestScore > 0
      ? `행동에서 ${ATTRIBUTES[best]} 관련 시도를 감지했어요.`
      : `상황상 ${ATTRIBUTES[best]} 판정이 필요해 보여요.`;
  const reason = circumstance.reason ? `${baseReason} ${circumstance.reason}` : baseReason;

  return { attribute: best, difficulty, advantage: circumstance.advantage, reason };
}

/**
 * 유리/불리에 따라 굴림 개수를 정한다(연출·계획용).
 * - advantage / disadvantage → 2 (d20 2개)
 * - none → 1
 * @param {"advantage" | "disadvantage" | "none"} advantage
 * @returns {number}
 */
export function rollCountFor(advantage) {
  return advantage === "advantage" || advantage === "disadvantage" ? 2 : 1;
}

/**
 * 굴림 결과들에서 유불리에 따라 채택값과 채택 인덱스를 고른다(순수).
 * - advantage: 가장 높은 값
 * - disadvantage: 가장 낮은 값
 * - none: 첫 번째 값
 *
 * @param {number[]} rolls 1개(보통) 또는 2개(유불리)의 d20 결과
 * @param {"advantage" | "disadvantage" | "none"} advantage
 * @returns {{ chosen: number, chosenIndex: number }}
 */
export function chooseRoll(rolls, advantage) {
  const list = Array.isArray(rolls) && rolls.length > 0 ? rolls : [1];
  if (advantage === "advantage") {
    let idx = 0;
    for (let i = 1; i < list.length; i++) if (list[i] > list[idx]) idx = i;
    return { chosen: list[idx], chosenIndex: idx };
  }
  if (advantage === "disadvantage") {
    let idx = 0;
    for (let i = 1; i < list.length; i++) if (list[i] < list[idx]) idx = i;
    return { chosen: list[idx], chosenIndex: idx };
  }
  return { chosen: list[0], chosenIndex: 0 };
}

/**
 * 난이도 목표값으로부터 결과 구간(밴드)을 만든다(판정표 표시용).
 * resolveOutcome 규칙과 일치한다: 대성공 ≥ target+8, 성공 ≥ target,
 * 부분 성공 ≥ target-3, 그 미만 실패(자연 20/1은 별도).
 *
 * @param {keyof typeof DIFFICULTY_TARGETS} difficulty
 * @returns {{ target: number, critFrom: number, successFrom: number, partialFrom: number }}
 */
export function describeBands(difficulty) {
  const target = DIFFICULTY_TARGETS[difficulty];
  if (target === undefined) throw new RangeError(`알 수 없는 난이도: ${difficulty}`);
  return {
    target,
    critFrom: target + 8,
    successFrom: target,
    partialFrom: target - 3,
  };
}

/**
 * d20 결과를 난이도 목표값과 비교해 결과 등급을 낸다.
 *
 * 규칙(테스트 하니스용, 직관적으로):
 * - 자연 20 → 대성공(Critical Success)
 * - 자연 1 → 실패(대실패 연출)
 * - total = roll + modifier
 *   - total ≥ target + 8 → 대성공
 *   - total ≥ target → 성공
 *   - total ≥ target - 3 → 부분 성공
 *   - 그 외 → 실패
 *
 * @param {number} roll d20 굴림 결과(1..20)
 * @param {keyof typeof DIFFICULTY_TARGETS} difficulty
 * @param {number} [modifier] 능력치 보정(기본 0)
 * @returns {{ outcome: keyof typeof OUTCOME_LABELS, total: number, target: number, roll: number, modifier: number, natural20: boolean, natural1: boolean }}
 */
export function resolveOutcome(roll, difficulty, modifier = 0) {
  const target = DIFFICULTY_TARGETS[difficulty];
  if (target === undefined) {
    throw new RangeError(`알 수 없는 난이도: ${difficulty}`);
  }
  const mod = Number.isFinite(modifier) ? modifier : 0;
  const total = roll + mod;
  const natural20 = roll === 20;
  const natural1 = roll === 1;

  /** @type {keyof typeof OUTCOME_LABELS} */
  let outcome;
  if (natural20) {
    outcome = "Critical Success";
  } else if (natural1) {
    outcome = "Failure";
  } else if (total >= target + 8) {
    outcome = "Critical Success";
  } else if (total >= target) {
    outcome = "Success";
  } else if (total >= target - 3) {
    outcome = "Partial Success";
  } else {
    outcome = "Failure";
  }

  return { outcome, total, target, roll, modifier: mod, natural20, natural1 };
}

/** 결과 등급별 GM 서술 후보(연출용). */
const OUTCOME_FLAVOR = Object.freeze({
  "Critical Success": [
    "완벽하다. 상상한 것 이상으로 멋지게 성공한다.",
    "운명이 당신 편이다 — 눈부신 성공이다.",
  ],
  Success: [
    "깔끔하게 성공한다.",
    "의도한 대로 해낸다.",
  ],
  "Partial Success": [
    "성공하지만 대가가 따른다.",
    "간신히 해내지만 무언가 어긋난다.",
  ],
  Failure: [
    "뜻대로 되지 않는다.",
    "시도는 빗나가고 상황이 나빠진다.",
  ],
});

/**
 * 결과를 한국어 서술 문장으로 만든다(결정적: roll 값으로 후보 선택).
 * @param {ReturnType<typeof resolveOutcome>} result
 * @param {{ attribute: keyof typeof ATTRIBUTES, difficulty: keyof typeof DIFFICULTY_TARGETS }} check
 * @returns {string}
 */
export function narrateOutcome(result, check) {
  const candidates = OUTCOME_FLAVOR[result.outcome];
  const flavor = candidates[result.roll % candidates.length];
  const tag = result.natural20 ? " (자연 20!)" : result.natural1 ? " (자연 1…)" : "";
  return (
    `${ATTRIBUTES[check.attribute]} · ${DIFFICULTY_LABELS[check.difficulty]} 판정 — ` +
    `${OUTCOME_LABELS[result.outcome]}${tag}\n${flavor}`
  );
}
