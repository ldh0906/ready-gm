// @ts-nocheck
/**
 * Property-based test for Character_Sheet_App AI 평가 항목 제안 검증·적용.
 * Feature: character-sheet
 *
 * Covers:
 * - Property 14: 제안 응답 검증과 적용
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  validateProposal,
  reduce,
  createInitialState,
  PROPOSAL_INVALID_MESSAGE,
} from "./logic.js";

// 이름·컨셉 Narrative_Field(유효 스키마 필수 구성). (요구사항 13.2, 13.8)
const nameField = {
  id: "name",
  label: "이름",
  guidance: "이름 안내",
  sectionId: "narrative",
  maxLength: 100,
};
const conceptField = {
  id: "concept",
  label: "컨셉",
  guidance: "컨셉 안내",
  sectionId: "narrative",
  maxLength: 2000,
};

// 유효한 정수 Trait_Ladder 생성기(min ≤ max).
const ladderGen = fc
  .tuple(fc.integer({ min: -10, max: 10 }), fc.integer({ min: 0, max: 10 }))
  .map(([min, span]) => ({ min, max: min + span }));

// 1~5개의 고유 Trait_Key + Trait_Ladder를 갖는 Rated_Trait 명세 생성기.
const traitSpecsGen = fc.uniqueArray(
  fc.record({ key: fc.string({ minLength: 1, maxLength: 6 }), ladder: ladderGen }),
  { minLength: 1, maxLength: 5, selector: (t) => t.key },
);

// 명세 → Active_Sheet_Schema.
function buildSchema(specs) {
  return {
    sections: [
      { id: "narrative", label: "서사" },
      { id: "attributes", label: "능력치" },
    ],
    narrativeFields: [nameField, conceptField],
    traits: specs.map((s) => ({
      key: s.key,
      label: "특성 " + s.key,
      sectionId: "attributes",
      ladder: s.ladder,
    })),
  };
}

// 알려진 activeSchema와 기존 Trait_Level을 가진 상태를 만든다.
function buildState(schema, baselineValues) {
  const base = createInitialState({ roomId: "r1", playerId: "p1", token: "" });
  return { ...base, activeSchema: schema, traitValues: { ...baselineValues } };
}

// 명세 배열 인덱스별 정수값(사다리 안)을 traitKey 맵으로 환원.
function toValueMap(specs, levels) {
  const map = {};
  specs.forEach((s, i) => {
    map[s.key] = levels[i];
  });
  return map;
}

// 유효 표본: 모든 Trait_Key에 사다리 안 정수값을 담은 제안 본문.
const validSampleGen = traitSpecsGen.chain((specs) => {
  const baselineGens = specs.map((s) => fc.integer({ min: s.ladder.min, max: s.ladder.max }));
  const proposedGens = specs.map((s) => fc.integer({ min: s.ladder.min, max: s.ladder.max }));
  return fc
    .record({ baseline: fc.tuple(...baselineGens), proposed: fc.tuple(...proposedGens) })
    .map(({ baseline, proposed }) => {
      const proposedMap = toValueMap(specs, proposed);
      return {
        category: "valid",
        schema: buildSchema(specs),
        baselineValues: toValueMap(specs, baseline),
        body: { values: { ...proposedMap, ExtraKeyNotInSchema: 0 } }, // 스키마 외 키는 무시되어야 한다.
        proposedMap,
      };
    });
});

// 무효 표본: 한 Trait_Key 누락 / 사다리 밖 / 비정수 중 하나로 오염한 제안 본문.
const invalidSampleGen = traitSpecsGen.chain((specs) => {
  const baselineGens = specs.map((s) => fc.integer({ min: s.ladder.min, max: s.ladder.max }));
  const proposedGens = specs.map((s) => fc.integer({ min: s.ladder.min, max: s.ladder.max }));
  return fc
    .record({
      baseline: fc.tuple(...baselineGens),
      proposed: fc.tuple(...proposedGens),
      targetIndex: fc.integer({ min: 0, max: specs.length - 1 }),
      corruption: fc.constantFrom("missing", "outOfLadder", "nonInteger"),
    })
    .map(({ baseline, proposed, targetIndex, corruption }) => {
      const values = toValueMap(specs, proposed);
      const targetKey = specs[targetIndex].key;
      const targetLadder = specs[targetIndex].ladder;
      if (corruption === "missing") {
        delete values[targetKey]; // 일부 Rated_Trait 값 누락.
      } else if (corruption === "outOfLadder") {
        values[targetKey] = targetLadder.max + 1; // 사다리 밖 정수.
      } else {
        values[targetKey] = proposed[targetIndex] + 0.5; // 비정수.
      }
      return {
        category: "invalid",
        schema: buildSchema(specs),
        baselineValues: toValueMap(specs, baseline),
        body: { values },
      };
    });
});

const sampleGen = fc.oneof(validSampleGen, invalidSampleGen);

describe("character-sheet property tests — proposal validation / application", () => {
  it("Property 14: 제안 응답 검증과 적용", () => {
    // Feature: character-sheet, Property 14: 제안 응답 검증과 적용
    fc.assert(
      fc.property(sampleGen, (sample) => {
        const result = validateProposal(sample.body, sample.schema);
        const state = buildState(sample.schema, sample.baselineValues);
        const next = reduce(state, { type: "PROPOSAL_SUCCEEDED", body: sample.body });

        if (sample.category === "valid") {
          // 모든 Trait_Key에 사다리 안 정수가 있으면 유효 판정. (요구사항 4.3)
          expect(result.ok).toBe(true);
          // 스키마가 정의한 Trait_Key만 정규화해 담는다(스키마 외 키는 버린다).
          expect(new Set(Object.keys(result.values))).toEqual(
            new Set(sample.schema.traits.map((t) => t.key)),
          );
          // 유효 시 모든 Rated_Trait의 Trait_Level이 제안 값으로 갱신된다. (요구사항 4.3)
          for (const trait of sample.schema.traits) {
            expect(next.traitValues[trait.key]).toBe(sample.proposedMap[trait.key]);
            expect(result.values[trait.key]).toBe(sample.proposedMap[trait.key]);
          }
        } else {
          // 하나라도 누락·사다리 밖·비정수이면 무효 판정. (요구사항 4.5)
          expect(result.ok).toBe(false);
          // 무효 시 기존 Trait_Level은 변경 없이 유지된다. (요구사항 4.5)
          expect(next.traitValues).toEqual(state.traitValues);
          // 형식 위반 안내를 표시한다.
          expect(next.notice).toBe(PROPOSAL_INVALID_MESSAGE);
        }
      }),
      { numRuns: 100 },
    );
  });
});
