// @ts-nocheck
/**
 * Property-based tests for Character_Sheet_App Default_Sheet_Schema 구성.
 * Feature: character-sheet
 *
 * Covers:
 * - Property 6: Default_Sheet_Schema 구성
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { defaultSheetSchema, DEFAULT_ATTRIBUTE_LADDER } from "./logic.js";

const EXPECTED_TRAIT_KEYS = ["Might", "Agility", "Wits", "Spirit"];

describe("character-sheet property tests — Default_Sheet_Schema 구성", () => {
  it("Property 6: Default_Sheet_Schema 구성", () => {
    // Feature: character-sheet, Property 6: Default_Sheet_Schema 구성
    // 임의 입력과 무관하게 defaultSheetSchema()는 정확히 네 Attribute_Key(Trait_Ladder [-2,4])와
    // 이름(maxLength 100)·컨셉(maxLength 2000) Narrative_Field를 갖는 동일한 스키마를 반환한다.
    fc.assert(
      fc.property(fc.anything(), (arbitraryInput) => {
        // defaultSheetSchema는 입력을 받지 않는 결정적 팩토리다. 임의 입력으로 호출 횟수를
        // 가변화해도(그리고 호출자가 반환값을 변형해도) 항상 동일한 스키마를 만들어야 한다.
        void arbitraryInput;
        const schema = defaultSheetSchema();

        // --- 정확히 네 Attribute_Key, 각각 Trait_Ladder [-2, +4] ---
        expect(Array.isArray(schema.traits)).toBe(true);
        expect(schema.traits).toHaveLength(EXPECTED_TRAIT_KEYS.length);
        const traitKeys = schema.traits.map((t) => t.key);
        expect(traitKeys).toEqual(EXPECTED_TRAIT_KEYS);
        for (const trait of schema.traits) {
          expect(trait.ladder).toEqual({
            min: DEFAULT_ATTRIBUTE_LADDER.min,
            max: DEFAULT_ATTRIBUTE_LADDER.max,
          });
          expect(trait.ladder.min).toBe(-2);
          expect(trait.ladder.max).toBe(4);
          // 모든 Rated_Trait는 비어 있지 않은 레이블을 가진다.
          expect(typeof trait.label).toBe("string");
          expect(trait.label.length).toBeGreaterThanOrEqual(1);
        }

        // --- 이름(maxLength 100)·컨셉(maxLength 2000) Narrative_Field ---
        expect(Array.isArray(schema.narrativeFields)).toBe(true);
        const byId = new Map(schema.narrativeFields.map((f) => [f.id, f]));
        expect(byId.has("name")).toBe(true);
        expect(byId.has("concept")).toBe(true);
        expect(byId.get("name").maxLength).toBe(100);
        expect(byId.get("concept").maxLength).toBe(2000);

        // --- 입력과 무관하게 동일한 스키마 (구조적 동일성) ---
        expect(schema).toEqual(defaultSheetSchema());
      }),
      { numRuns: 100 },
    );
  });
});
