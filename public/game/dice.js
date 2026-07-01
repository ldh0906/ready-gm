// @ts-check
/**
 * 주사위 순수 로직 모듈 (TRPG 다이스: d4 · d6 · d8 · d10 · d12 · d20)
 *
 * 이 모듈은 DOM·애니메이션·타이머에 의존하지 않는 순수 함수들만 모은다.
 * 주사위 굴림(균등 분포), 애니메이션용 임의 면 생성, 속도/강조(중요 이벤트) 프리셋,
 * 그리고 여러 주사위를 "순서대로" 굴리기 위한 시퀀스 타이밍 계획을 담당하며
 * vitest(node 환경)에서 직접 import 하여 단위/속성 테스트한다.
 *
 * 실제 DOM 렌더·굴림 애니메이션은 dice-tray.js(부수효과 계층)가 담당하고,
 * 본 모듈이 만든 결정(결과값·타이밍 계획)을 실행만 한다.
 */

// ---------------------------------------------------------------------------
// 주사위 종류 (Die Types)
// ---------------------------------------------------------------------------

/** 지원하는 TRPG 주사위 면 수. (요청: d4, d6, d12, d20 + 보편적 d8, d10 포함) */
export const DIE_TYPES = Object.freeze([4, 6, 8, 10, 12, 20]);

/**
 * 주사위 면 수가 지원 목록에 있는지 판정한다.
 * @param {number} sides
 * @returns {boolean}
 */
export function isSupportedDie(sides) {
  return DIE_TYPES.includes(sides);
}

// ---------------------------------------------------------------------------
// 속도·강조 프리셋 (Speed / Emphasis Presets)
// ---------------------------------------------------------------------------

/**
 * 굴림 속도 프리셋. `durationMs`는 한 주사위가 구르는 전체 시간,
 * `intervalMs`는 애니메이션 중 면 숫자가 바뀌는 주기다(짧을수록 빠르게 깜빡인다).
 * - fast: 빠르게 후루룩 굴러 멈춤
 * - normal: 기본
 * - slow: 천천히 굴러 긴장감 있게 멈춤
 * @typedef {"fast" | "normal" | "slow"} RollSpeed
 * @type {Readonly<Record<RollSpeed, { durationMs: number, intervalMs: number }>>}
 */
export const SPEED_PRESETS = Object.freeze({
  fast: Object.freeze({ durationMs: 500, intervalMs: 45 }),
  normal: Object.freeze({ durationMs: 1000, intervalMs: 80 }),
  slow: Object.freeze({ durationMs: 1800, intervalMs: 120 }),
});

/** 중요 이벤트(강조) 시 굴림 시간을 늘리는 배수. (요청: 중요 이벤트에 의해 천천히/극적으로) */
export const EMPHASIS_DURATION_MULTIPLIER = 1.6;

/** 시퀀스에서 한 주사위가 멈춘 뒤 다음 주사위가 구르기 전까지의 기본 간격(ms). */
export const SEQUENCE_GAP_MS = 220;

// ---------------------------------------------------------------------------
// 단일 주사위 굴림 (Single Die Roll)
// ---------------------------------------------------------------------------

/**
 * 1..sides 사이의 균등 정수를 굴린다.
 *
 * @param {number} sides 면 수(1 이상 정수)
 * @param {() => number} [rng] [0,1) 난수원(기본 Math.random). 테스트에서 주입 가능.
 * @returns {number} 1 이상 sides 이하의 정수
 */
export function rollDie(sides, rng = Math.random) {
  if (!Number.isInteger(sides) || sides < 1) {
    throw new RangeError(`주사위 면 수는 1 이상의 정수여야 합니다: ${sides}`);
  }
  // Math.random은 [0,1)이므로 floor(r*sides)+1은 1..sides 균등.
  const r = rng();
  // 방어: 난수가 정확히 1(또는 그 이상)을 반환해도 상한을 넘지 않게 한다.
  const clamped = r >= 1 ? 1 - Number.EPSILON : r < 0 ? 0 : r;
  return Math.floor(clamped * sides) + 1;
}

/**
 * 애니메이션 프레임용 임의 면 숫자를 만든다(굴리는 동안 깜빡일 값).
 * 의미상 rollDie와 동일하지만 "최종 결과가 아닌 중간 프레임"임을 명확히 한다.
 *
 * @param {number} sides
 * @param {() => number} [rng]
 * @returns {number}
 */
export function randomFace(sides, rng = Math.random) {
  return rollDie(sides, rng);
}

/**
 * d20에서 20(대성공)·1(대실패)처럼 극단값인지 판정한다(강조 표시용).
 * @param {number} sides
 * @param {number} value
 * @returns {"crit" | "fumble" | null}
 */
export function criticality(sides, value) {
  if (sides === 20 && value === 20) return "crit";
  if (sides === 20 && value === 1) return "fumble";
  return null;
}

// ---------------------------------------------------------------------------
// 굴림 시퀀스 계획 (Roll Sequence Planning)
// ---------------------------------------------------------------------------

/**
 * 한 주사위의 굴림 명세.
 * @typedef {Object} DieSpec
 * @property {number} sides 면 수(지원 목록: 4/6/8/10/12/20)
 * @property {number} [result] 미리 정해진 결과(서버 값 등). 없으면 굴린다.
 * @property {RollSpeed} [speed] 속도 프리셋(기본 "normal")
 * @property {boolean} [emphasis] 중요 이벤트 강조 여부(굴림 시간 연장 + 흔들림 강조)
 * @property {string} [label] 표시용 라벨(예: 캐릭터/체크 이름)
 */

/**
 * 한 주사위의 계획된 굴림.
 * @typedef {Object} PlannedRoll
 * @property {number} sides
 * @property {number} result 1..sides 최종 결과
 * @property {RollSpeed} speed
 * @property {boolean} emphasis
 * @property {string | null} label
 * @property {number} durationMs 이 주사위가 구르는 시간(강조 시 연장됨)
 * @property {number} intervalMs 면 숫자 깜빡임 주기
 * @property {number} startAtMs 시퀀스 시작 기준 이 주사위가 구르기 시작하는 시각(순차)
 * @property {number} settleAtMs 이 주사위가 멈추는 시각(startAtMs + durationMs)
 * @property {"crit" | "fumble" | null} criticality 극단값 강조 표시
 */

/**
 * 한 주사위 명세를 결과·타이밍이 채워진 계획으로 정규화한다(순수).
 *
 * - result가 1..sides 범위로 주어지면 그대로 쓰고, 아니면 rng로 굴린다.
 * - speed 프리셋으로 durationMs/intervalMs를 정하고, emphasis면 durationMs를 연장한다.
 * - startAtMs는 호출자가 넘긴 시작 시각(순차 누적)을 그대로 기록한다.
 *
 * @param {DieSpec} spec
 * @param {{ rng?: () => number, startAtMs?: number }} [opts]
 * @returns {PlannedRoll}
 */
export function planRoll(spec, opts = {}) {
  const rng = opts.rng ?? Math.random;
  const startAtMs = typeof opts.startAtMs === "number" ? opts.startAtMs : 0;
  const sides = spec && spec.sides;
  if (!Number.isInteger(sides) || sides < 1) {
    throw new RangeError(`주사위 면 수는 1 이상의 정수여야 합니다: ${sides}`);
  }
  /** @type {RollSpeed} */
  const speed =
    spec.speed === "fast" || spec.speed === "slow" || spec.speed === "normal"
      ? spec.speed
      : "normal";
  const preset = SPEED_PRESETS[speed];
  const emphasis = spec.emphasis === true;

  // result가 유효 범위로 주어지면 사용(서버 결정값 시각화), 아니면 굴린다.
  const hasGivenResult =
    Number.isInteger(spec.result) &&
    /** @type {number} */ (spec.result) >= 1 &&
    /** @type {number} */ (spec.result) <= sides;
  const result = hasGivenResult ? /** @type {number} */ (spec.result) : rollDie(sides, rng);

  const durationMs = Math.round(
    preset.durationMs * (emphasis ? EMPHASIS_DURATION_MULTIPLIER : 1),
  );

  return {
    sides,
    result,
    speed,
    emphasis,
    label: typeof spec.label === "string" ? spec.label : null,
    durationMs,
    intervalMs: preset.intervalMs,
    startAtMs,
    settleAtMs: startAtMs + durationMs,
    criticality: criticality(sides, result),
  };
}

/**
 * 여러 주사위를 "순서대로" 굴리기 위한 타이밍 계획을 만든다(순수).
 *
 * 각 주사위는 앞 주사위가 멈춘 뒤 `gapMs` 간격을 두고 구르기 시작한다(순차).
 * 속도(fast/normal/slow)와 강조(중요 이벤트)에 따라 개별 굴림 시간이 달라지므로,
 * 빠른 주사위는 짧게, 강조된 주사위는 길게 구른 뒤 다음으로 넘어간다.
 *
 * @param {DieSpec[]} specs 굴릴 주사위 목록(순서가 곧 굴림 순서)
 * @param {{ rng?: () => number, gapMs?: number, startAtMs?: number }} [opts]
 * @returns {PlannedRoll[]}
 */
export function planRollSequence(specs, opts = {}) {
  const list = Array.isArray(specs) ? specs : [];
  const rng = opts.rng ?? Math.random;
  const gapMs = typeof opts.gapMs === "number" ? opts.gapMs : SEQUENCE_GAP_MS;
  let cursor = typeof opts.startAtMs === "number" ? opts.startAtMs : 0;
  /** @type {PlannedRoll[]} */
  const plans = [];
  for (const spec of list) {
    const plan = planRoll(spec, { rng, startAtMs: cursor });
    plans.push(plan);
    // 다음 주사위는 이 주사위가 멈춘 뒤 gap 만큼 쉬고 시작한다(순차).
    cursor = plan.settleAtMs + gapMs;
  }
  return plans;
}

/**
 * 시퀀스 전체가 끝나는(마지막 주사위가 멈추는) 시각을 반환한다.
 * @param {PlannedRoll[]} plans
 * @returns {number}
 */
export function sequenceTotalMs(plans) {
  const list = Array.isArray(plans) ? plans : [];
  let max = 0;
  for (const p of list) {
    if (p.settleAtMs > max) max = p.settleAtMs;
  }
  return max;
}
