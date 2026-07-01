// @ts-nocheck
/**
 * 주사위 순수 로직(dice.js)에 대한 속성 기반 테스트(fast-check).
 * Feature: game-dice
 *
 * dice.js는 DOM·타이머에 의존하지 않는 순수 함수만 모은 모듈이므로 node 환경에서
 * 직접 import 하여 속성(property) 검증한다. 부수효과(애니메이션) 계층은 dice-tray.js가
 * 담당하며 별도 happy-dom 테스트로 검증한다.
 *
 * Covers:
 * - Property 1: rollDie 결과는 항상 1..sides 정수(경계 포함)
 * - Property 2: criticality는 d20 극단값에서만 crit/fumble
 * - Property 3: planRoll 결과·타이밍 계약
 * - Property 4: planRollSequence는 엄격히 순차/비중첩
 * - Property 5: isSupportedDie는 4/6/8/10/12/20에서만 참
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  DIE_TYPES,
  isSupportedDie,
  SPEED_PRESETS,
  EMPHASIS_DURATION_MULTIPLIER,
  SEQUENCE_GAP_MS,
  rollDie,
  randomFace,
  criticality,
  planRoll,
  planRollSequence,
  sequenceTotalMs,
} from "./dice.js";

// [0,1) 범위의 결정적 난수값(상한 제외). 이 값을 반환하는 고정 함수로 rng를 주입한다.
const unitGen = fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true });
const speedGen = fc.constantFrom("fast", "normal", "slow");

describe("game-dice 속성 테스트 — dice.js", () => {
  it("Property 1: rollDie bounds — 결과는 항상 1..sides 정수", () => {
    // Feature: game-dice, Property 1: rollDie bounds — 결과는 항상 1..sides 정수
    fc.assert(
      fc.property(
        fc.oneof(fc.constantFrom(...DIE_TYPES), fc.integer({ min: 1, max: 1000 })),
        unitGen,
        (sides, r) => {
          const rng = () => r;
          const v = rollDie(sides, rng);
          // 정수이며 1 이상 sides 이하.
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(1);
          expect(v).toBeLessThanOrEqual(sides);
          // randomFace는 rollDie와 동일한 의미.
          expect(randomFace(sides, rng)).toBe(v);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 1(경계): rng=0→1, rng≈1→sides, r>=1 클램프", () => {
    // Feature: game-dice, Property 1: rollDie bounds — 경계값 검증
    fc.assert(
      fc.property(fc.oneof(fc.constantFrom(...DIE_TYPES), fc.integer({ min: 1, max: 1000 })), (sides) => {
        // 하한: rng()=0 → 1.
        expect(rollDie(sides, () => 0)).toBe(1);
        // 상한: rng()=0.9999999 → sides.
        expect(rollDie(sides, () => 0.9999999)).toBe(sides);
        // r>=1 이어도 상한을 넘지 않고 sides로 클램프된다.
        expect(rollDie(sides, () => 1)).toBe(sides);
        expect(rollDie(sides, () => 1.5)).toBe(sides);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 1(예외): sides가 1 이상 정수가 아니면 RangeError", () => {
    // Feature: game-dice, Property 1: rollDie bounds — 유효하지 않은 sides는 RangeError
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -1000, max: 0 }),
          fc.double({ min: 1.1, max: 100, noNaN: true }).filter((n) => !Number.isInteger(n)),
        ),
        (badSides) => {
          expect(() => rollDie(badSides)).toThrow(RangeError);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 2: criticality — d20 극단값에서만 crit/fumble", () => {
    // Feature: game-dice, Property 2: criticality — d20 극단값에서만 crit/fumble
    fc.assert(
      fc.property(
        fc.constantFrom(...DIE_TYPES).chain((sides) =>
          fc.tuple(fc.constant(sides), fc.integer({ min: 1, max: sides })),
        ),
        ([sides, value]) => {
          const result = criticality(sides, value);
          if (sides === 20 && value === 20) {
            expect(result).toBe("crit");
          } else if (sides === 20 && value === 1) {
            expect(result).toBe("fumble");
          } else {
            expect(result).toBeNull();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 3: planRoll result + timing — 결과와 타이밍 계약", () => {
    // Feature: game-dice, Property 3: planRoll result + timing — 결과와 타이밍 계약
    fc.assert(
      fc.property(
        fc.constantFrom(...DIE_TYPES),
        // 때로는 범위 내, 때로는 범위 밖/부재인 result.
        fc.oneof(
          fc.constant(undefined),
          fc.integer({ min: 1, max: 20 }),
          fc.integer({ min: 21, max: 100 }),
          fc.integer({ min: -50, max: 0 }),
        ),
        speedGen,
        fc.boolean(),
        fc.integer({ min: 0, max: 10_000_000 }),
        unitGen,
        (sides, given, speed, emphasis, startAtMs, r) => {
          const rng = () => r;
          const spec = { sides, speed, emphasis };
          if (given !== undefined) spec.result = given;
          const plan = planRoll(spec, { rng, startAtMs });

          // 결과는 항상 1..sides.
          expect(plan.result).toBeGreaterThanOrEqual(1);
          expect(plan.result).toBeLessThanOrEqual(sides);

          // 유효 범위 result가 주어지면 그대로 사용.
          const givenValid = Number.isInteger(given) && given >= 1 && given <= sides;
          if (givenValid) {
            expect(plan.result).toBe(given);
          }

          const preset = SPEED_PRESETS[speed];
          const expectedDuration = Math.round(
            preset.durationMs * (emphasis ? EMPHASIS_DURATION_MULTIPLIER : 1),
          );
          expect(plan.durationMs).toBe(expectedDuration);
          expect(plan.intervalMs).toBe(preset.intervalMs);
          expect(plan.settleAtMs).toBe(startAtMs + plan.durationMs);
          expect(plan.speed).toBe(speed);

          // 강조 굴림은 같은 속도의 비강조보다 굴림 시간이 길거나 같다.
          const emphasized = planRoll({ sides, speed, emphasis: true }, { rng, startAtMs });
          const plain = planRoll({ sides, speed, emphasis: false }, { rng, startAtMs });
          expect(emphasized.durationMs).toBeGreaterThanOrEqual(plain.durationMs);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 3(기본 speed): speed 미지정 시 normal", () => {
    // Feature: game-dice, Property 3: planRoll result + timing — speed 기본값 normal
    fc.assert(
      fc.property(fc.constantFrom(...DIE_TYPES), unitGen, (sides, r) => {
        const plan = planRoll({ sides }, { rng: () => r });
        expect(plan.speed).toBe("normal");
        expect(plan.durationMs).toBe(SPEED_PRESETS.normal.durationMs);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 3(예외): planRoll도 유효하지 않은 sides면 RangeError", () => {
    // Feature: game-dice, Property 3: planRoll result + timing — 유효하지 않은 sides는 RangeError
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 0 }), (badSides) => {
        expect(() => planRoll({ sides: badSides })).toThrow(RangeError);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 4: planRollSequence — 엄격히 순차/비중첩", () => {
    // Feature: game-dice, Property 4: planRollSequence — 엄격히 순차/비중첩
    const specGen = fc.record({
      sides: fc.constantFrom(...DIE_TYPES),
      speed: speedGen,
      emphasis: fc.boolean(),
    });
    fc.assert(
      fc.property(
        fc.array(specGen, { minLength: 0, maxLength: 8 }),
        fc.integer({ min: 0, max: 2000 }),
        unitGen,
        (specs, gapMs, r) => {
          const startAtMs = 0;
          const plans = planRollSequence(specs, { rng: () => r, gapMs, startAtMs });

          // 길이 일치.
          expect(plans.length).toBe(specs.length);

          if (plans.length > 0) {
            // 첫 주사위는 startAtMs(기본 0)에서 시작.
            expect(plans[0].startAtMs).toBe(startAtMs);
          }

          for (let i = 1; i < plans.length; i++) {
            // 다음은 직전 settle + gap에서 시작(순차).
            expect(plans[i].startAtMs).toBe(plans[i - 1].settleAtMs + gapMs);
            // durationMs는 양수이므로 settle은 항상 start 이후.
            expect(plans[i].settleAtMs).toBeGreaterThan(plans[i].startAtMs);
            // gap이 양수이면 시작 시각은 직전 settle을 엄격히 초과(비중첩).
            if (gapMs > 0) {
              expect(plans[i].startAtMs).toBeGreaterThan(plans[i - 1].settleAtMs);
            } else {
              expect(plans[i].startAtMs).toBeGreaterThanOrEqual(plans[i - 1].settleAtMs);
            }
            // 시작 시각은 단조 증가.
            expect(plans[i].startAtMs).toBeGreaterThan(plans[i - 1].startAtMs);
          }

          // 전체 시간 = 마지막 settle(빈 배열은 0).
          if (plans.length === 0) {
            expect(sequenceTotalMs(plans)).toBe(0);
          } else {
            expect(sequenceTotalMs(plans)).toBe(plans[plans.length - 1].settleAtMs);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 4(기본 gap): gap 미지정 시 SEQUENCE_GAP_MS(220) 사용", () => {
    // Feature: game-dice, Property 4: planRollSequence — gap 기본값 220
    fc.assert(
      fc.property(
        fc.array(fc.record({ sides: fc.constantFrom(...DIE_TYPES) }), {
          minLength: 2,
          maxLength: 6,
        }),
        unitGen,
        (specs, r) => {
          const plans = planRollSequence(specs, { rng: () => r });
          for (let i = 1; i < plans.length; i++) {
            expect(plans[i].startAtMs).toBe(plans[i - 1].settleAtMs + SEQUENCE_GAP_MS);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 5: isSupportedDie — 4/6/8/10/12/20에서만 참", () => {
    // Feature: game-dice, Property 5: isSupportedDie — 4/6/8/10/12/20에서만 참
    // 지원 목록은 정확히 참.
    for (const s of DIE_TYPES) {
      expect(isSupportedDie(s)).toBe(true);
    }
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 1000 }), (n) => {
        const expected = DIE_TYPES.includes(n);
        expect(isSupportedDie(n)).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("DIE_TYPES와 SPEED_PRESETS는 동결(frozen)되어 있다", () => {
    // 불변 계약: 외부에서 변형 불가.
    expect(Object.isFrozen(DIE_TYPES)).toBe(true);
    expect(Object.isFrozen(SPEED_PRESETS)).toBe(true);
    expect(DIE_TYPES).toEqual([4, 6, 8, 10, 12, 20]);
    expect(EMPHASIS_DURATION_MULTIPLIER).toBe(1.6);
    expect(SEQUENCE_GAP_MS).toBe(220);
  });
});
