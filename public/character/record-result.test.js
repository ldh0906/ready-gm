// @ts-nocheck
/**
 * Property-based test for Character_Sheet_App record-result classification + state transition.
 * Feature: character-sheet
 *
 * Covers:
 * - Property 17: 기록 결과 분류는 상태를 정확히 전이하고 입력을 보존한다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  classifyRecordResult,
  reduce,
  createInitialState,
  RecordRejection,
  SAVE_CONFIRMED_MESSAGE,
  RECORD_REJECTION_MESSAGES,
} from "./logic.js";

// 유효한 인계(roomId/playerId 비어 있지 않음) 생성기 — 작성 상태의 기반.
const handoffGen = fc.record({
  roomId: fc.string({ minLength: 1, maxLength: 8 }),
  playerId: fc.string({ minLength: 1, maxLength: 8 }),
  token: fc.string({ maxLength: 8 }),
});

// 플레이어가 입력한 Narrative_Field 값(앞뒤 공백 포함 보존된 값) 생성기.
const narrativeValuesGen = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 6 }),
  fc.string({ maxLength: 40 }),
  { maxKeys: 5 },
);

// 플레이어가 입력한 Rated_Trait_Set(traitKey → Trait_Level) 생성기.
const traitValuesGen = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 6 }),
  fc.integer({ min: -2, max: 4 }),
  { maxKeys: 5 },
);

// 열거된 거부 사유 5종.
const REJECTIONS = [
  RecordRejection.NAME_TAKEN,
  RecordRejection.INVALID_ATTRIBUTES,
  RecordRejection.ALREADY_CONFIRMED,
  RecordRejection.UNKNOWN_PLAYER,
  RecordRejection.OTHER,
];

// 기록 요청 결과 생성기: success(2xx 정상 본문) + 5개 거부 사유.
// 각 샘플은 classifyRecordResult가 환원할 기대 분류(expected)를 함께 담는다.
const recordOutcomeGen = fc.oneof(
  // 성공: 2xx 정상 본문(거부 사유 없음).
  fc.constant({
    expected: "success",
    outcome: { kind: "response", response: { ok: true, status: 200 }, body: { character: {} } },
  }),
  // NAME_TAKEN / INVALID_ATTRIBUTES / ALREADY_CONFIRMED / UNKNOWN_PLAYER: 본문 reason 분류.
  ...[
    RecordRejection.NAME_TAKEN,
    RecordRejection.INVALID_ATTRIBUTES,
    RecordRejection.ALREADY_CONFIRMED,
    RecordRejection.UNKNOWN_PLAYER,
  ].map((reason) =>
    fc.constant({
      expected: reason,
      outcome: {
        kind: "response",
        response: { ok: true, status: 200 },
        body: { ok: false, reason },
      },
    }),
  ),
  // OTHER: 열거되지 않은 기타 거부 사유.
  fc.string({ minLength: 1, maxLength: 8 }).map((reason) => ({
    expected: REJECTIONS.includes(reason) ? reason : RecordRejection.OTHER,
    outcome: {
      kind: "response",
      response: { ok: true, status: 200 },
      body: { ok: false, reason },
    },
  })),
);

describe("character-sheet property tests — record result classification / transition", () => {
  it("Property 17: 기록 결과 분류는 상태를 정확히 전이하고 입력을 보존한다", () => {
    // Feature: character-sheet, Property 17: 기록 결과 분류는 상태를 정확히 전이하고 입력을 보존한다
    fc.assert(
      fc.property(
        handoffGen,
        narrativeValuesGen,
        traitValuesGen,
        recordOutcomeGen,
        (handoff, narrativeValues, traitValues, sample) => {
          // 플레이어가 입력한 작성 상태를 만든다(비확정 시작).
          const seed = {
            ...createInitialState(handoff),
            narrativeValues: { ...narrativeValues },
            traitValues: { ...traitValues },
          };
          expect(seed.confirmed).toBe(false);

          // 기록 결과를 분류한 뒤 RECORD_RESULT로 reduce 한다.
          const result = classifyRecordResult(sample.outcome);
          expect(result).toBe(sample.expected);

          const next = reduce(seed, { type: "RECORD_RESULT", result });

          if (result === "success") {
            // 성공: 저장 확인 안내 + 비확정(편집 가능) 유지(요구사항 6.3).
            expect(next.notice).toBe(SAVE_CONFIRMED_MESSAGE);
            expect(next.confirmed).toBe(false);
          } else {
            // 모든 거부 사유: 입력(Narrative_Field·Rated_Trait_Set) 보존(요구사항 6.4~6.8).
            expect(next.narrativeValues).toEqual(narrativeValues);
            expect(next.traitValues).toEqual(traitValues);
            // 거부 사유별 메시지가 설정된다.
            expect(next.notice).toBe(RECORD_REJECTION_MESSAGES[result]);
            // ALREADY_CONFIRMED만 Confirmed_State로 표시된다(요구사항 6.6).
            if (result === RecordRejection.ALREADY_CONFIRMED) {
              expect(next.confirmed).toBe(true);
            } else {
              expect(next.confirmed).toBe(false);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
