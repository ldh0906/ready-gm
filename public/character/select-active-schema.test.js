// @ts-nocheck
/**
 * Property-based test for Character_Sheet_App schema validation / adoption.
 * Feature: character-sheet
 *
 * Covers:
 * - Property 5: 스키마 검증·채택과 단일 Active_Sheet_Schema 불변식
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { selectActiveSchema, defaultSheetSchema, validateSchema } from "./logic.js";

// 기본 Trait_Ladder. 누락된 Trait_Ladder는 이 값으로 정규화되어야 한다. (요구사항 13.5)
const DEFAULT_LADDER = { min: -2, max: 4 };

// 유효한 정수 Trait_Ladder 생성기(min ≤ max).
const ladderGen = fc
  .tuple(fc.integer({ min: -10, max: 10 }), fc.integer({ min: 0, max: 10 }))
  .map(([min, span]) => ({ min, max: min + span }));

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

// 성공 + 유효 스키마 생성기: 1~5개의 고유 Trait_Key, 일부 Trait_Ladder 누락 포함.
const validOutcomeGen = fc
  .uniqueArray(
    fc.record({
      key: fc.string({ minLength: 1, maxLength: 6 }),
      hasLadder: fc.boolean(),
      ladder: ladderGen,
    }),
    { minLength: 1, maxLength: 5, selector: (t) => t.key },
  )
  .map((specs) => {
    const traits = specs.map((s) => {
      const trait = { key: s.key, label: "특성 " + s.key, sectionId: "attributes" };
      if (s.hasLadder) trait.ladder = s.ladder;
      return trait;
    });
    const body = {
      sections: [
        { id: "narrative", label: "서사" },
        { id: "attributes", label: "능력치" },
      ],
      narrativeFields: [nameField, conceptField],
      traits,
    };
    // 각 Trait_Key에 기대되는 정규화된 사다리(누락 시 기본 [-2,4]).
    const expectedLadders = {};
    for (const s of specs) {
      expectedLadders[s.key] = s.hasLadder ? s.ladder : DEFAULT_LADDER;
    }
    return {
      category: "valid",
      outcome: { kind: "response", response: { ok: true, status: 200 }, body },
      expectedKeys: specs.map((s) => s.key),
      expectedLadders,
    };
  });

// 성공 + 유효(서사 전용, Rated_Trait 0개) 생성기: traits: [] 이지만 name·concept를 갖춰 유효하다.
// 새 규칙에서 trait-less 스키마는 무효 폴백이 아니라 그대로 채택된다. (요구사항 13.2)
const narrativeOnlyOutcomeGen = fc.constant({
  category: "valid",
  narrativeOnly: true,
  outcome: {
    kind: "response",
    response: { ok: true, status: 200 },
    body: {
      sections: [{ id: "narrative", label: "서사" }],
      narrativeFields: [
        nameField,
        conceptField,
        {
          id: "disposition",
          label: "성향",
          guidance: "성향 안내",
          sectionId: "narrative",
          maxLength: 2000,
        },
        {
          id: "goal",
          label: "목표",
          guidance: "목표 안내",
          sectionId: "narrative",
          maxLength: 2000,
        },
      ],
      traits: [],
    },
  },
  expectedKeys: [],
  expectedLadders: {},
});

// 성공 + 무효 본문 생성기: Trait_Key 결여 / 이름·컨셉 결여 / 객체가 아닌 본문.
// (Rated_Trait 0개는 새 규칙에서 더 이상 무효가 아니므로 무효 표본에서 제외한다.)
const invalidOutcomeGen = fc.oneof(
  // 어떤 Rated_Trait가 Trait_Key를 결여.
  fc.constant({
    category: "invalid",
    outcome: {
      kind: "response",
      response: { ok: true, status: 200 },
      body: {
        sections: [],
        narrativeFields: [nameField, conceptField],
        traits: [{ label: "키 없음", sectionId: "attributes", ladder: { min: -2, max: 4 } }],
      },
    },
  }),
  // 이름·컨셉 Narrative_Field 결여(서사 전용 시트라도 name·concept는 필수).
  fc.constant({
    category: "invalid",
    outcome: {
      kind: "response",
      response: { ok: true, status: 200 },
      body: {
        sections: [],
        narrativeFields: [],
        traits: [],
      },
    },
  }),
  // 본문이 객체가 아님.
  fc.oneof(fc.constant(null), fc.constant("not-an-object"), fc.constant(42)).map((body) => ({
    category: "invalid",
    outcome: { kind: "response", response: { ok: true, status: 200 }, body },
  })),
);

// 전송/HTTP 오류 생성기: network / timeout / server(5xx) / auth(401·403).
const errorOutcomeGen = fc.oneof(
  fc.constant({ category: "error", outcome: { kind: "network" } }),
  fc.constant({ category: "error", outcome: { kind: "timeout" } }),
  fc.integer({ min: 500, max: 599 }).map((status) => ({
    category: "error",
    outcome: { kind: "response", response: { ok: false, status } },
  })),
  fc.oneof(fc.constant(401), fc.constant(403)).map((status) => ({
    category: "error",
    outcome: { kind: "response", response: { ok: false, status } },
  })),
);

const schemaOutcomeGen = fc.oneof(
  validOutcomeGen,
  narrativeOnlyOutcomeGen,
  invalidOutcomeGen,
  errorOutcomeGen,
);

describe("character-sheet property tests — schema validation / adoption", () => {
  it("Property 5: 스키마 검증·채택과 단일 Active_Sheet_Schema 불변식", () => {
    // Feature: character-sheet, Property 5: 스키마 검증·채택과 단일 Active_Sheet_Schema 불변식
    fc.assert(
      fc.property(schemaOutcomeGen, (sample) => {
        const result = selectActiveSchema(sample.outcome);

        // 단일 Active_Sheet_Schema 불변식: 항상 정확히 하나의 유효한 SheetSchema를 반환한다. (요구사항 13.7)
        expect(validateSchema(result).ok).toBe(true);
        expect(Array.isArray(result.traits)).toBe(true);
        // 서사 전용 시트는 Rated_Trait 0개일 수 있다(채택). 일반 유효 시트는 1개 이상.
        expect(result.traits.length).toBeGreaterThanOrEqual(0);

        if (sample.category === "valid") {
          // 유효하면 채택한다. (요구사항 13.2)
          const resultKeys = result.traits.map((t) => t.key);
          expect(new Set(resultKeys)).toEqual(new Set(sample.expectedKeys));
          expect(resultKeys.length).toBe(sample.expectedKeys.length);
          // 누락된 Trait_Ladder는 [-2,4]로, 지정된 사다리는 그대로 정규화된다. (요구사항 13.5)
          for (const trait of result.traits) {
            expect(trait.ladder).toEqual(sample.expectedLadders[trait.key]);
          }
          // 서사 전용(0-trait) 스키마는 폴백이 아니라 그대로 채택되어야 한다. (요구사항 13.2)
          if (sample.narrativeOnly) {
            expect(result.traits.length).toBe(0);
            expect(result).not.toEqual(defaultSheetSchema());
            expect(validateSchema(result).ok).toBe(true);
          }
        } else {
          // 무효·오류이면 Default_Sheet_Schema로 폴백한다. (요구사항 13.6, 13.7)
          expect(result).toEqual(defaultSheetSchema());
        }
      }),
      { numRuns: 100 },
    );
  });
});
