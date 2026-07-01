// @ts-nocheck
/**
 * Example tests for scenario-adaptive Character_Sheet schemas.
 * Feature: character-sheet
 *
 * Covers two new scenario sheets validated/adopted/rendered end-to-end:
 *  (a) a custom 3-stat sheet (Sneaky/Fast/Tenacious, ladder [1,4] with rungLabels)
 *      plus an extra "special" narrative field.
 *  (b) a narrative-only sheet (traits: []) with name/concept/disposition/goal fields.
 */
import { describe, it, expect } from "vitest";
import { validateSchema, selectActiveSchema, renderModel, defaultSheetSchema } from "./logic.js";

// 한 성공(2xx) 응답 outcome으로 감싼다.
function okOutcome(body) {
  return { kind: "response", response: { ok: true, status: 200 }, body };
}

// 렌더 모델 전체에서 trait 편집/서사 입력을 평탄화해 수집한다.
function collect(model) {
  const traits = [];
  const fields = [];
  for (const section of model.sections) {
    for (const trait of section.traits) traits.push(trait);
    for (const field of section.narrativeFields) fields.push(field);
  }
  return { traits, fields };
}

describe("character-sheet — scenario-adaptive schemas (examples)", () => {
  it("(a) geese-like 3-stat schema validates, is adopted, and renders 3 trait editors with options [1,2,3,4] + special field", () => {
    const rungLabels = { 1: "서툼", 2: "보통", 3: "능숙", 4: "달인" };
    const body = {
      sections: [
        { id: "narrative", label: "서사" },
        { id: "attributes", label: "능력치" },
      ],
      narrativeFields: [
        { id: "name", label: "이름", guidance: "이름 안내", sectionId: "narrative", maxLength: 100 },
        { id: "concept", label: "컨셉", guidance: "컨셉 안내", sectionId: "narrative", maxLength: 2000 },
        { id: "special", label: "특기", guidance: "특기 안내", sectionId: "narrative", maxLength: 2000 },
      ],
      traits: [
        { key: "Sneaky", label: "은밀", sectionId: "attributes", ladder: { min: 1, max: 4 }, rungLabels },
        { key: "Fast", label: "신속", sectionId: "attributes", ladder: { min: 1, max: 4 }, rungLabels },
        { key: "Tenacious", label: "끈기", sectionId: "attributes", ladder: { min: 1, max: 4 }, rungLabels },
      ],
    };

    // 검증을 통과한다.
    const validated = validateSchema(body);
    expect(validated.ok).toBe(true);

    // 성공 outcome이면 그대로 채택된다(기본 시트 폴백이 아님).
    const active = selectActiveSchema(okOutcome(body));
    expect(active).not.toEqual(defaultSheetSchema());
    expect(active.traits.map((t) => t.key)).toEqual(["Sneaky", "Fast", "Tenacious"]);

    // renderModel은 3개의 trait 편집기를 만들고 각 옵션은 [1,2,3,4]다.
    const model = renderModel(active, { narrativeValues: {}, traitValues: {} });
    const { traits, fields } = collect(model);
    expect(traits.length).toBe(3);
    for (const trait of traits) {
      expect(trait.options).toEqual([1, 2, 3, 4]);
    }
    expect(traits.map((t) => t.key).sort()).toEqual(["Fast", "Sneaky", "Tenacious"]);

    // special 서사 필드가 렌더된다.
    const fieldIds = fields.map((f) => f.id);
    expect(fieldIds).toContain("special");
    expect(fieldIds).toContain("name");
    expect(fieldIds).toContain("concept");
  });

  it("(b) narrative-only schema (traits: []) validates, is adopted, and renders 0 trait editors + 4 narrative inputs", () => {
    const body = {
      sections: [{ id: "narrative", label: "서사" }],
      narrativeFields: [
        { id: "name", label: "이름", guidance: "이름 안내", sectionId: "narrative", maxLength: 100 },
        { id: "concept", label: "컨셉", guidance: "컨셉 안내", sectionId: "narrative", maxLength: 2000 },
        { id: "disposition", label: "성향", guidance: "성향 안내", sectionId: "narrative", maxLength: 2000 },
        { id: "goal", label: "목표", guidance: "목표 안내", sectionId: "narrative", maxLength: 2000 },
      ],
      traits: [],
    };

    // 서사 전용 시트도 검증을 통과한다.
    const validated = validateSchema(body);
    expect(validated.ok).toBe(true);
    expect(validated.schema.traits.length).toBe(0);

    // 채택된다(기본 시트로 폴백하지 않는다).
    const active = selectActiveSchema(okOutcome(body));
    expect(active).not.toEqual(defaultSheetSchema());
    expect(active.traits.length).toBe(0);

    // renderModel은 trait 편집기를 0개, 서사 입력을 4개 만든다.
    const model = renderModel(active, { narrativeValues: {}, traitValues: {} });
    const { traits, fields } = collect(model);
    expect(traits.length).toBe(0);
    expect(fields.length).toBe(4);
    expect(fields.map((f) => f.id).sort()).toEqual(["concept", "disposition", "goal", "name"]);
  });
});
