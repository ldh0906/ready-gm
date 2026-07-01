// @ts-nocheck
/**
 * Property-based test for Character_Sheet_App recoverable transmission errors.
 * Feature: character-sheet
 *
 * Covers:
 * - Property 22: 복구 가능 오류는 입력을 보존하고 동일 입력 재시도를 허용한다
 *
 * 임의 작성 상태 + 임의 전송 오류(timeout/network/server/auth)로 *_FAILED를 reduce 한 뒤
 * 인계(handoff)·Narrative_Field(narrativeValues)·Rated_Trait_Set(traitValues)이 보존되고,
 * lastRequest가 기록되며, nextRequestForRetry가 동일 보존 입력으로 직전 요청을 1회
 * 재구성함을 검증한다. (요구사항 10.5, 10.6, 11.5)
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  createInitialState,
  reduce,
  nextRequestForRetry,
  ErrorKind,
  LastRequest,
  ERROR_MESSAGES,
  buildSchemaRequest,
  buildProposalRequest,
  buildRecordRequest,
  buildConfirmRequest,
  renderedTraitKeys,
  collectRatedTraitSet,
} from "./logic.js";

// 유효 스키마의 필수 Narrative_Field(이름·컨셉). (요구사항 13.2, 13.8)
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

// 정수 Trait_Ladder 생성기(min ≤ max).
const ladderGen = fc
  .tuple(fc.integer({ min: -5, max: 5 }), fc.integer({ min: 0, max: 8 }))
  .map(([min, span]) => ({ min, max: min + span }));

// Active_Sheet_Schema + 그 스키마와 일관된 Rated_Trait_Set(traitValues) 생성기.
const schemaWithValuesGen = fc
  .uniqueArray(fc.record({ key: fc.string({ minLength: 1, maxLength: 6 }), ladder: ladderGen }), {
    minLength: 1,
    maxLength: 4,
    selector: (t) => t.key,
  })
  .chain((specs) => {
    const traits = specs.map((s) => ({
      key: s.key,
      label: "특성 " + s.key,
      sectionId: "attributes",
      ladder: s.ladder,
    }));
    const schema = {
      sections: [
        { id: "narrative", label: "서사" },
        { id: "attributes", label: "능력치" },
      ],
      narrativeFields: [nameField, conceptField],
      traits,
    };
    // 각 Trait_Key에 해당 Trait_Ladder 안의 정수 Trait_Level을 배정한다.
    const traitValuesGen = fc.record(
      Object.fromEntries(
        specs.map((s) => [s.key, fc.integer({ min: s.ladder.min, max: s.ladder.max })]),
      ),
    );
    return fc.record({ schema: fc.constant(schema), traitValues: traitValuesGen });
  });

// 임의 인계(앞뒤 공백·특수문자·빈 토큰 포함). *_FAILED는 인계 식별자·토큰을 보존해야 한다.
const handoffGen = fc.record({
  roomId: fc.string({ minLength: 1, maxLength: 12 }),
  playerId: fc.string({ minLength: 1, maxLength: 12 }),
  token: fc.oneof(fc.constant(""), fc.string({ minLength: 1, maxLength: 12 })),
});

// 임의 서사 입력(앞뒤 공백 포함 보존 값).
const narrativeValuesGen = fc.record({
  name: fc.string({ maxLength: 120 }),
  concept: fc.string({ maxLength: 200 }),
});

// 임의 전송 오류 종류(timeout/network/server/auth). (요구사항 10.1~10.3, 11.5)
const errorKindGen = fc.constantFrom(
  ErrorKind.TIMEOUT,
  ErrorKind.NETWORK,
  ErrorKind.SERVER,
  ErrorKind.AUTH,
);

// 실패 액션 종류. proposal/record/confirm 전송 오류는 모든 입력(인계·서사·Rated_Trait_Set)을
// 보존한다(요구사항 10.5). SCHEMA_FAILED는 설계상 기본 시트로 폴백하므로 traitValues를
// 재구성한다(요구사항 13.6) — 따라서 Rated_Trait_Set 불변은 전송 오류에만 해당한다.
const failureGen = fc.constantFrom(
  { type: "PROPOSAL_FAILED", lastRequest: LastRequest.PROPOSAL, preservesTraits: true },
  { type: "RECORD_FAILED", lastRequest: LastRequest.RECORD, preservesTraits: true },
  { type: "CONFIRM_FAILED", lastRequest: LastRequest.CONFIRM, preservesTraits: true },
  { type: "SCHEMA_FAILED", lastRequest: LastRequest.SCHEMA, preservesTraits: false },
);

describe("character-sheet property tests — recoverable errors preserve input and allow retry", () => {
  it("Property 22: 복구 가능 오류는 입력을 보존하고 동일 입력 재시도를 허용한다", () => {
    // Feature: character-sheet, Property 22: 복구 가능 오류는 입력을 보존하고 동일 입력 재시도를 허용한다
    fc.assert(
      fc.property(
        handoffGen,
        schemaWithValuesGen,
        narrativeValuesGen,
        failureGen,
        errorKindGen,
        (handoff, schemaWithValues, narrativeValues, failure, kind) => {
          const { schema, traitValues } = schemaWithValues;

          // 임의 작성 상태를 구성한다(채택된 스키마 + 작성된 서사·Rated_Trait_Set).
          const base = createInitialState(handoff);
          const state = {
            ...base,
            activeSchema: schema,
            traitValues: { ...traitValues },
            narrativeValues: { ...narrativeValues },
          };

          // 비교를 위해 보존 대상 입력의 사본을 미리 떠 둔다.
          const handoffBefore = { ...state.handoff };
          const narrativeBefore = { ...state.narrativeValues };
          const traitValuesBefore = { ...state.traitValues };

          const next = reduce(state, { type: failure.type, kind });

          // 인계 식별자·토큰은 어떤 전송 오류로도 변하지 않는다. (요구사항 10.5)
          expect(next.handoff).toEqual(handoffBefore);
          // Narrative_Field 보존 값은 변하지 않는다. (요구사항 10.5)
          expect(next.narrativeValues).toEqual(narrativeBefore);

          // 복구 가능한 전송 오류(proposal/record/confirm)는 Rated_Trait_Set도 보존한다. (요구사항 10.5)
          if (failure.preservesTraits) {
            expect(next.traitValues).toEqual(traitValuesBefore);
            // auth 거부는 별도의 구분되는 한국어 메시지로 환원된다. (요구사항 11.5)
            if (kind === ErrorKind.AUTH) {
              expect(next.notice).toBe(ERROR_MESSAGES.auth);
            }
          }

          // 직전 실패 요청이 lastRequest에 기록된다(재시도 대상). (요구사항 10.6)
          expect(next.lastRequest).toBe(failure.lastRequest);

          // nextRequestForRetry는 보존된 동일 입력으로 직전 요청을 1회 재구성한다. (요구사항 10.6)
          const retry = nextRequestForRetry(next);
          let expected;
          switch (failure.lastRequest) {
            case LastRequest.PROPOSAL:
              expected = buildProposalRequest(
                handoffBefore.roomId,
                handoffBefore.playerId,
                narrativeBefore.concept,
                renderedTraitKeys(schema),
                handoffBefore.token,
              );
              break;
            case LastRequest.RECORD:
              expected = buildRecordRequest(
                handoffBefore,
                narrativeBefore.name,
                narrativeBefore,
                collectRatedTraitSet(traitValuesBefore, schema),
              );
              break;
            case LastRequest.CONFIRM:
              expected = buildConfirmRequest(handoffBefore);
              break;
            case LastRequest.SCHEMA:
              expected = buildSchemaRequest(handoffBefore.roomId, handoffBefore.token);
              break;
            default:
              expected = null;
          }
          expect(retry).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});
