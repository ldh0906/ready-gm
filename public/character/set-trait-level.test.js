// @ts-nocheck
/**
 * Property-based test for Character_Sheet_App trait-level editing.
 * Feature: character-sheet
 *
 * Covers:
 * - Property 15: 평가 편집은 해당 항목만 갱신하고 무효 값은 거부한다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { setTraitLevel } from "./logic.js";

// 유효한 정수 Trait_Ladder 생성기(min ≤ max). select-active-schema.test.js와 동일한 형태.
const ladderGen = fc
  .tuple(fc.integer({ min: -10, max: 10 }), fc.integer({ min: 0, max: 10 }))
  .map(([min, span]) => ({ min, max: min + span }));

// 1~5개의 고유 Trait_Key를 갖는 Active_Sheet_Schema 생성기.
const schemaGen = fc
  .uniqueArray(
    fc.record({ key: fc.string({ minLength: 1, maxLength: 6 }), ladder: ladderGen }),
    { minLength: 1, maxLength: 5, selector: (t) => t.key },
  )
  .map((specs) => ({
    sections: [{ id: "attributes", label: "능력치" }],
    narrativeFields: [],
    traits: specs.map((s) => ({
      key: s.key,
      label: "특성 " + s.key,
      sectionId: "attributes",
      ladder: s.ladder,
    })),
  }));

// 사다리 안 정수(유효 값) 생성기.
function validLevelGen(ladder) {
  return fc.integer({ min: ladder.min, max: ladder.max });
}

// 사다리 밖 정수 생성기.
function outOfLadderGen(ladder) {
  return fc.oneof(
    fc.integer({ min: ladder.max + 1, max: ladder.max + 50 }),
    fc.integer({ min: ladder.min - 50, max: ladder.min - 1 }),
  );
}

// 비정수 값 생성기(소수·NaN·무한대).
const nonIntegerGen = fc.oneof(
  fc.double({ min: -100, max: 100, noInteger: true, noNaN: true }),
  fc.constant(NaN),
  fc.constant(Infinity),
  fc.constant(-Infinity),
);

// 현재 Trait_Level 한 벌(스키마 키 일부/전부에 임의 정수)을 만든다.
function valuesGen(schema) {
  return fc
    .uniqueArray(
      fc.record({ key: fc.constantFrom(...schema.traits.map((t) => t.key)), level: fc.integer() }),
      { selector: (e) => e.key },
    )
    .map((entries) => {
      const map = {};
      for (const e of entries) map[e.key] = e.level;
      return map;
    });
}

// schema · values · traitKey · level · category 를 한 샘플로 묶는다.
const sampleGen = schemaGen.chain((schema) => {
  const keys = schema.traits.map((t) => t.key);
  return valuesGen(schema).chain((values) =>
    fc.constantFrom(...keys).chain((traitKey) => {
      const ladder = schema.traits.find((t) => t.key === traitKey).ladder;
      return fc.oneof(
        validLevelGen(ladder).map((level) => ({
          schema,
          values,
          traitKey,
          level,
          category: "valid",
        })),
        outOfLadderGen(ladder).map((level) => ({
          schema,
          values,
          traitKey,
          level,
          category: "invalid",
        })),
        nonIntegerGen.map((level) => ({
          schema,
          values,
          traitKey,
          level,
          category: "invalid",
        })),
      );
    }),
  );
});

describe("character-sheet property tests — trait-level editing", () => {
  it("Property 15: 평가 편집은 해당 항목만 갱신하고 무효 값은 거부한다", () => {
    // Feature: character-sheet, Property 15: 평가 편집은 해당 항목만 갱신하고 무효 값은 거부한다
    fc.assert(
      fc.property(sampleGen, (sample) => {
        const { schema, values, traitKey, level, category } = sample;
        const before = { ...values };
        const result = setTraitLevel(values, schema, traitKey, level);

        // 입력 맵은 어느 경우에도 변형되지 않는다(순수 함수). (요구사항 5.1, 5.5)
        expect(values).toEqual(before);

        if (category === "valid") {
          // 유효 값이면 해당 Trait_Key만 지정 값으로 갱신한다. (요구사항 5.1)
          expect(result[traitKey]).toBe(level);
          // 나머지 모든 Rated_Trait의 Trait_Level은 변경되지 않는다. (요구사항 5.1)
          for (const key of Object.keys(before)) {
            if (key !== traitKey) {
              expect(result[key]).toBe(before[key]);
            }
          }
          // 갱신 대상 외에 새 키가 추가되지 않는다.
          const expectedKeys = new Set([...Object.keys(before), traitKey]);
          expect(new Set(Object.keys(result))).toEqual(expectedKeys);
        } else {
          // 사다리 밖이거나 정수가 아니면 Rated_Trait_Set 전체가 변경 없이 유지된다. (요구사항 5.5)
          expect(result).toEqual(before);
        }
      }),
      { numRuns: 100 },
    );
  });
});
