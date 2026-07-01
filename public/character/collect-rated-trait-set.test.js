// @ts-nocheck
/**
 * Property-based test for Character_Sheet_App Rated_Trait_Set collection.
 * Feature: character-sheet
 *
 * Covers:
 * - Property 16: Rated_Trait_Set은 변형 없이 수집된다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { collectRatedTraitSet } from "./logic.js";

// 기본 Trait_Ladder. 표시 규칙의 기본값 계산에 쓰인다. (요구사항 2.3, 5.4)
const DEFAULT_LADDER = { min: -2, max: 4 };

/**
 * renderModel·collectRatedTraitSet이 공유하는 표시 Trait_Level 기본값 규칙을 미러링한다.
 * 보존 값이 사다리 안 정수이면 그 값, 아니면 0이 사다리 안이면 0, 그 외에는 사다리 최소값.
 */
function expectedDisplayedLevel(value, ladder) {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= ladder.min &&
    value <= ladder.max
  ) {
    return value;
  }
  if (0 >= ladder.min && 0 <= ladder.max) return 0;
  return ladder.min;
}

// 유효한 정수 Trait_Ladder 생성기(min ≤ max).
const ladderGen = fc
  .tuple(fc.integer({ min: -10, max: 10 }), fc.integer({ min: 0, max: 12 }))
  .map(([min, span]) => ({ min, max: min + span }));

// 스키마 + 일관된 Trait_Level 한 벌 생성기.
// 1~5개의 고유 Trait_Key, 각 Rated_Trait는 자신의 Trait_Ladder를 갖고,
// 일부 Trait_Key에는 사다리 안 정수 Trait_Level을 보존(present), 일부는 누락(missing)한다.
const schemaAndValuesGen = fc
  .uniqueArray(
    fc.record({
      key: fc.string({ minLength: 1, maxLength: 6 }),
      ladder: ladderGen,
      present: fc.boolean(),
      // 사다리 폭 안에서 보존할 Trait_Level을 고르기 위한 0~1 비율.
      pick: fc.double({ min: 0, max: 1, noNaN: true }),
    }),
    { minLength: 1, maxLength: 5, selector: (t) => t.key },
  )
  .map((specs) => {
    const traits = specs.map((s) => ({
      key: s.key,
      label: "특성 " + s.key,
      sectionId: "attributes",
      ladder: s.ladder,
    }));
    const schema = {
      sections: [{ id: "attributes", label: "능력치" }],
      narrativeFields: [],
      traits,
    };
    // 보존된 Trait_Level 맵: present인 항목만 사다리 안 정수를 담는다.
    const values = {};
    for (const s of specs) {
      if (s.present) {
        const span = s.ladder.max - s.ladder.min;
        const level = s.ladder.min + Math.round(s.pick * span);
        values[s.key] = level;
      }
    }
    return { schema, values, specs };
  });

describe("character-sheet property tests — Rated_Trait_Set collection", () => {
  it("Property 16: Rated_Trait_Set은 변형 없이 수집된다", () => {
    // Feature: character-sheet, Property 16: Rated_Trait_Set은 변형 없이 수집된다
    fc.assert(
      fc.property(schemaAndValuesGen, ({ schema, values, specs }) => {
        const result = collectRatedTraitSet(values, schema);

        // 수집된 Rated_Trait_Set의 키 집합은 스키마가 정의한 Trait_Key 집합과 정확히 일치한다.
        const expectedKeys = specs.map((s) => s.key);
        expect(new Set(Object.keys(result))).toEqual(new Set(expectedKeys));
        expect(Object.keys(result).length).toBe(expectedKeys.length);

        for (const s of specs) {
          if (s.present) {
            // 사다리 안 정수로 보존된 Trait_Level은 변형 없이 그대로 담긴다. (요구사항 5.4)
            expect(result[s.key]).toBe(values[s.key]);
          } else {
            // 누락된 Trait_Key는 표시 기본 Trait_Level로 채워진다(변형 없는 표시 규칙).
            expect(result[s.key]).toBe(expectedDisplayedLevel(undefined, s.ladder));
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
