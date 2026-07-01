// @ts-nocheck
/**
 * Property-based test for Character_Sheet_App render model.
 * Feature: character-sheet
 *
 * Covers:
 * - Property 7: 렌더 모델은 Active_Sheet_Schema와 정확히 일치한다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  renderModel,
  renderedTraitKeys,
  renderedFieldIds,
  renderedSectionIds,
} from "./logic.js";

// 유효한 정수 Trait_Ladder 생성기(min ≤ max, 옵션 폭이 과도하지 않도록 제한). (요구사항 5.2)
const ladderGen = fc
  .tuple(fc.integer({ min: -8, max: 8 }), fc.integer({ min: 0, max: 8 }))
  .map(([min, span]) => ({ min, max: min + span }));

// 정수 포함 구간 [min..max]의 모든 정수 집합(렌더 옵션 기대값).
function integerRange(ladder) {
  const out = [];
  for (let level = ladder.min; level <= ladder.max; level += 1) out.push(level);
  return out;
}

// 임의 개수 Sheet_Section·Narrative_Field·Rated_Trait를 가진 스키마 생성기.
// Narrative_Field·Rated_Trait는 항상 정의된 Sheet_Section을 참조하도록 구성해 모두 렌더되게 한다.
const schemaGen = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 5 }), {
    minLength: 1,
    maxLength: 4,
  })
  .chain((sectionIds) => {
    const sectionPick = fc.constantFrom(...sectionIds);
    // 이름·컨셉을 항상 포함하는 Narrative_Field 집합(추가 필드는 고유 식별자). (요구사항 13.8)
    const extraFieldsGen = fc.uniqueArray(
      fc.record({
        id: fc.string({ minLength: 1, maxLength: 6 }),
        label: fc.string({ maxLength: 8 }),
        guidance: fc.string({ maxLength: 12 }),
        sectionId: sectionPick,
        maxLength: fc.constantFrom(100, 2000),
      }),
      { minLength: 0, maxLength: 4, selector: (f) => f.id },
    );
    // Rated_Trait 1개 이상, 고유 Trait_Key. (요구사항 13.2)
    const traitsGen = fc.uniqueArray(
      fc.record({
        key: fc.string({ minLength: 1, maxLength: 6 }),
        label: fc.string({ maxLength: 8 }),
        sectionId: sectionPick,
        ladder: ladderGen,
      }),
      { minLength: 1, maxLength: 6, selector: (t) => t.key },
    );
    return fc.record({
      sectionIds: fc.constant(sectionIds),
      extraFields: extraFieldsGen,
      traits: traitsGen,
    });
  })
  .map(({ sectionIds, extraFields, traits }) => {
    const homeSection = sectionIds[0];
    // 추가 필드 식별자가 name/concept과 충돌하지 않도록 걸러낸다.
    const safeExtras = extraFields.filter((f) => f.id !== "name" && f.id !== "concept");
    const narrativeFields = [
      {
        id: "name",
        label: "이름",
        guidance: "이름 안내",
        sectionId: homeSection,
        maxLength: 100,
      },
      {
        id: "concept",
        label: "컨셉",
        guidance: "컨셉 안내",
        sectionId: homeSection,
        maxLength: 2000,
      },
      ...safeExtras,
    ];
    // scenario-character-cards 요구사항 2.4 이후 renderModel은 소속 Narrative_Field·Rated_Trait가
    // 모두 0개인 Sheet_Section을 결과에서 제외한다. 본 속성(렌더 모델이 스키마와 정확히 일치)은
    // 비어 있지 않은 섹션에 대해 정의되므로, 모든 Sheet_Section이 최소 1개의 평가 항목을 갖도록
    // 보장하는 커버리지 Rated_Trait를 섹션마다 추가한다(키 충돌 없는 고유 접두어 사용).
    const coverageTraits = sectionIds.map((sectionId, index) => ({
      key: "__cov_" + index,
      label: "항목 " + index,
      sectionId,
      ladder: { min: 0, max: 2 },
    }));
    const safeTraits = traits.filter((t) => !t.key.startsWith("__cov_"));
    return {
      sections: sectionIds.map((id) => ({ id, label: "구획 " + id })),
      narrativeFields,
      traits: [...coverageTraits, ...safeTraits],
    };
  });

// 렌더 모델 전체에서 식별자 집합·옵션·레이블을 수집한다.
function collectRendered(model) {
  const sectionIds = [];
  const fieldIds = [];
  const traitKeys = [];
  const traitOptions = {};
  let allGuidanceNonEmpty = true;
  let allTraitLabelsNonEmpty = true;
  for (const section of model.sections) {
    sectionIds.push(section.id);
    for (const field of section.narrativeFields) {
      fieldIds.push(field.id);
      if (typeof field.guidance !== "string" || field.guidance.length === 0) {
        allGuidanceNonEmpty = false;
      }
    }
    for (const trait of section.traits) {
      traitKeys.push(trait.key);
      traitOptions[trait.key] = trait.options;
      if (typeof trait.label !== "string" || trait.label.length === 0) {
        allTraitLabelsNonEmpty = false;
      }
    }
  }
  return { sectionIds, fieldIds, traitKeys, traitOptions, allGuidanceNonEmpty, allTraitLabelsNonEmpty };
}

describe("character-sheet property tests — render model", () => {
  it("Property 7: 렌더 모델은 Active_Sheet_Schema와 정확히 일치한다", () => {
    // Feature: character-sheet, Property 7: 렌더 모델은 Active_Sheet_Schema와 정확히 일치한다
    fc.assert(
      fc.property(schemaGen, (schema) => {
        const model = renderModel(schema, { narrativeValues: {}, traitValues: {} });
        const rendered = collectRendered(model);

        // Sheet_Section 집합·개수가 스키마와 정확히 일치한다. (요구사항 13.3, 13.4)
        const schemaSectionIds = renderedSectionIds(schema);
        expect(rendered.sectionIds.length).toBe(schemaSectionIds.length);
        expect(new Set(rendered.sectionIds)).toEqual(new Set(schemaSectionIds));

        // Narrative_Field 집합(식별자)·개수가 스키마와 정확히 일치한다. (요구사항 2.1, 13.4)
        const schemaFieldIds = renderedFieldIds(schema);
        expect(rendered.fieldIds.length).toBe(schemaFieldIds.length);
        expect(new Set(rendered.fieldIds)).toEqual(new Set(schemaFieldIds));

        // Rated_Trait 집합(Trait_Key)·개수가 스키마와 정확히 일치한다. (요구사항 2.2, 13.4)
        const schemaTraitKeys = renderedTraitKeys(schema);
        expect(rendered.traitKeys.length).toBe(schemaTraitKeys.length);
        expect(new Set(rendered.traitKeys)).toEqual(new Set(schemaTraitKeys));

        // 각 Rated_Trait 선택 값 집합이 Trait_Ladder의 정수 집합 [min..max]와 일치한다. (요구사항 5.2)
        for (const trait of schema.traits) {
          expect(rendered.traitOptions[trait.key]).toEqual(integerRange(trait.ladder));
        }

        // 모든 Narrative_Field 안내·Rated_Trait 레이블이 비어 있지 않다. (요구사항 2.1, 2.2)
        expect(rendered.allGuidanceNonEmpty).toBe(true);
        expect(rendered.allTraitLabelsNonEmpty).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
