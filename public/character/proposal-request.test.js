// @ts-nocheck
/**
 * Property-based tests for Character_Sheet_App AI 제안 요청 구성과 빈 컨셉 차단.
 * Feature: character-sheet
 *
 * Covers:
 * - Property 13: 제안 요청과 빈 컨셉 차단
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  buildProposalRequest,
  renderedTraitKeys,
  reduce,
  createInitialState,
  BLANK_CONCEPT_MESSAGE,
} from "./logic.js";

// roomId·playerId: 인코딩이 필요한 문자(`/`, 공백, `?`, `#`, `&`, 한글, 이모지 등)를 포함할 수 있는 임의 문자열.
// (인계가 유효하도록 트림 후 비어있지 않게 보장한다.)
const idGen = fc
  .oneof(
    fc.string({ minLength: 1 }),
    fc.string({ minLength: 1, unit: fc.constantFrom("/", " ", "?", "#", "&", "=", "%", "가", "🙂") }),
  )
  .map((s) => "id" + s); // 트림 후 길이 ≥ 1 보장(공백만 들어가는 경우 방지).

const tokenGen = fc.oneof(fc.constant(""), fc.string({ minLength: 1 }));

// 공백 문자 집합.
const wsGen = fc.stringOf(fc.constantFrom(" ", "\t", "\n", "\r"), { maxLength: 5 });

// 트림 길이 ≥ 1인 비어있지 않은 컨셉(앞뒤 공백 + 내부 공백 보존 확인 포함).
const nonBlankConceptGen = fc
  .tuple(wsGen, fc.string({ minLength: 1 }).filter((s) => s.trim().length >= 1), wsGen)
  .map(([lead, core, trail]) => lead + core + trail);

// 트림 길이 0인 빈 컨셉(빈 문자열 또는 공백만).
const blankConceptGen = fc.stringOf(fc.constantFrom(" ", "\t", "\n", "\r"), { maxLength: 6 });

// Active_Sheet_Schema 생성기: 비어있지 않은 고유 Trait_Key를 1개 이상 갖는 traits.
const schemaGen = fc
  .uniqueArray(fc.string({ minLength: 1 }).filter((k) => k.trim().length >= 1), {
    minLength: 1,
    maxLength: 8,
  })
  .map((keys) => ({
    sections: [{ id: "attributes", label: "능력치" }],
    narrativeFields: [
      { id: "name", label: "이름", guidance: "g", sectionId: "narrative", maxLength: 100 },
      { id: "concept", label: "컨셉", guidance: "g", sectionId: "narrative", maxLength: 2000 },
    ],
    traits: keys.map((key) => ({
      key,
      label: key,
      sectionId: "attributes",
      ladder: { min: -2, max: 4 },
    })),
  }));

describe("character-sheet property tests — proposal request & blank concept", () => {
  it("Property 13: 제안 요청과 빈 컨셉 차단", () => {
    // Feature: character-sheet, Property 13: 제안 요청과 빈 컨셉 차단
    fc.assert(
      fc.property(
        schemaGen,
        idGen,
        idGen,
        tokenGen,
        fc.oneof(nonBlankConceptGen, blankConceptGen),
        (schema, roomId, playerId, token, concept) => {
          const traitKeys = renderedTraitKeys(schema);

          if (concept.trim().length >= 1) {
            // 컨셉 트림 길이 ≥ 1: 제안 요청 본문에 트림된 컨셉과 모든 Trait_Key가 포함된다(요구사항 4.1).
            const request = buildProposalRequest(roomId, playerId, concept, traitKeys, token);
            expect(request.method).toBe("POST");
            const body = JSON.parse(request.body);
            // 컨셉은 앞뒤 공백만 제거되어 포함된다.
            expect(body.concept).toBe(concept.trim());
            // Active_Sheet_Schema가 정의한 모든 Trait_Key가 변형 없이 포함된다.
            expect(body.traitKeys).toEqual(traitKeys);
            for (const key of traitKeys) {
              expect(body.traitKeys).toContain(key);
            }
          } else {
            // 컨셉 트림 길이 0: 제안 요청을 보내지 않고 컨셉 입력 안내로 전이한다(요구사항 4.2).
            const initial = createInitialState({ roomId, playerId, token });
            const next = reduce(initial, { type: "PROPOSAL_BLANK_CONCEPT" });
            // 제안 단계가 loading으로 진입하지 않는다(요청 미전송).
            expect(next.proposal).not.toBe("loading");
            // 컨셉 입력이 필요하다는 안내로 전이한다.
            expect(next.notice).toBe(BLANK_CONCEPT_MESSAGE);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
