// @ts-nocheck
/**
 * Property-based tests for Character_Sheet_App 서사 입력 보존·길이 제한.
 * Feature: character-sheet
 *
 * Covers:
 * - Property 10: 서사 입력은 그대로 보존되고 길이만 제한된다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { reduce, createInitialState, clampFieldValue } from "./logic.js";

const VALID_HANDOFF = { roomId: "r1", playerId: "p1", token: "" };

/**
 * 테스트가 기대하는 보존 길이 한도를 도출한다(logic.js의 내부 fieldMaxLength 규칙을 미러링).
 * 스키마에 그 식별자의 Narrative_Field가 있으면 그 maxLength를, 없으면 이름은 100, 그 외는 2000.
 */
function expectedMaxLength(schema, fieldId) {
  const fields = Array.isArray(schema.narrativeFields) ? schema.narrativeFields : [];
  const field = fields.find((f) => f && f.id === fieldId);
  if (field && Number.isInteger(field.maxLength)) return field.maxLength;
  return fieldId === "name" ? 100 : 2000;
}

// 단일 UTF-16 코드 유닛 문자들(서로게이트 쌍 없음)이라 String.length와 배열 길이가 일치한다.
// 공백 문자를 포함해 내부·앞뒤 공백 보존을 함께 검증한다.
const charGen = fc.constantFrom("a", "B", "3", "_", "가", "é", "!", " ", "\t", "\n");
const wsGen = fc.stringOf(fc.constantFrom(" ", "\t", "\n", "\r"), { maxLength: 4 });

// 한도 경계(100/2000)와 그 주변, 그리고 임의 길이를 함께 다룬다.
const lengthGen = fc.oneof(
  fc.constantFrom(0, 1, 99, 100, 101, 1999, 2000, 2001, 2050),
  fc.integer({ min: 0, max: 2100 }),
);

// 길이를 정확히 통제한 본문 + 앞뒤 공백으로 입력 문자열을 만든다.
const bodyGen = lengthGen.chain((len) =>
  fc.array(charGen, { minLength: len, maxLength: len }).map((arr) => arr.join("")),
);
const valueGen = fc.tuple(wsGen, bodyGen, wsGen).map(([lead, body, trail]) => lead + body + trail);

// 기본 스키마의 Narrative_Field(name/concept)와 시나리오별 임의 식별자를 모두 다룬다.
const fieldIdGen = fc.oneof(
  fc.constantFrom("name", "concept"),
  fc.string({ minLength: 1, maxLength: 20 }),
);

describe("character-sheet property tests — 서사 입력 보존·길이 제한", () => {
  it("Property 10: 서사 입력은 그대로 보존되고 길이만 제한된다", () => {
    // Feature: character-sheet, Property 10: 서사 입력은 그대로 보존되고 길이만 제한된다
    // NARRATIVE_CHANGED를 reduce 한 뒤 그 필드의 보존 값은 입력을 (이름 100자, 그 외 2000자로)
    // 길이 제한한 결과와 정확히 일치하고, 한도 미만 입력은 앞뒤 공백을 포함해 입력과 완전히 동일하다.
    fc.assert(
      fc.property(fieldIdGen, valueGen, (fieldId, value) => {
        const initial = createInitialState(VALID_HANDOFF);
        const next = reduce(initial, { type: "NARRATIVE_CHANGED", fieldId, value });

        const preserved = next.narrativeValues[fieldId];
        const maxLength = expectedMaxLength(initial.activeSchema, fieldId);

        // 보존 값은 길이 제한 결과와 정확히 일치한다(요구사항 3.5, 3.6).
        expect(preserved).toBe(clampFieldValue(value, maxLength));

        // 보존 값의 길이는 한도를 절대 넘지 않는다.
        expect(preserved.length).toBeLessThanOrEqual(maxLength);

        // 한도에 걸리지 않는 입력은 앞뒤 공백을 포함해 입력과 완전히 동일하다(요구사항 3.1, 3.2).
        if (value.length <= maxLength) {
          expect(preserved).toBe(value);
        } else {
          // 한도를 넘는 입력은 앞에서부터 maxLength 만큼만 보존된다.
          expect(preserved).toBe(value.slice(0, maxLength));
        }

        // 다른 필드를 건드리지 않는다(해당 fieldId만 갱신).
        expect(Object.keys(next.narrativeValues)).toEqual([fieldId]);
      }),
      { numRuns: 100 },
    );
  });
});
