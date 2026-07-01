// @ts-nocheck
/**
 * Property-based test for Character_Sheet_App confirm step decision / NO_CHARACTER guard.
 * Feature: character-sheet
 *
 * Covers:
 * - Property 19: 확정은 기록 성공 시에만 진행된다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  decideConfirmStep,
  reduce,
  createInitialState,
  RecordRejection,
  NO_CHARACTER_MESSAGE,
} from "./logic.js";

// 유효한 인계. createInitialState로 handoffValid=true 상태를 만든다.
const HANDOFF = { roomId: "r1", playerId: "p1", token: "t1" };

// 선행 기록 결과 생성기: success + 5개 거부 사유.
const recordResultGen = fc.constantFrom(
  "success",
  RecordRejection.NAME_TAKEN,
  RecordRejection.INVALID_ATTRIBUTES,
  RecordRejection.ALREADY_CONFIRMED,
  RecordRejection.UNKNOWN_PLAYER,
  RecordRejection.OTHER,
);

// 플레이어가 입력한 보존 값(Narrative_Field·Rated_Trait_Set) 생성기.
const narrativeValuesGen = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 8 }),
  fc.string({ maxLength: 30 }),
  { maxKeys: 5 },
);
const traitValuesGen = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 6 }),
  fc.integer({ min: -2, max: 4 }),
  { maxKeys: 4 },
);

describe("character-sheet property tests — confirm step / NO_CHARACTER guard", () => {
  it("Property 19: 확정은 기록 성공 시에만 진행된다", () => {
    // Feature: character-sheet, Property 19: 확정은 기록 성공 시에만 진행된다
    fc.assert(
      fc.property(
        recordResultGen,
        narrativeValuesGen,
        traitValuesGen,
        (recordResult, narrativeValues, traitValues) => {
          // (1) decideConfirmStep: 선행 기록 결과에 따른 다음 단계 결정. (요구사항 7.2, 7.3, 7.4)
          const step = decideConfirmStep(recordResult);
          if (recordResult === "success") {
            // 기록 성공 → 확정 전송. (요구사항 7.2)
            expect(step).toBe("send-confirm");
          } else if (
            recordResult === RecordRejection.NAME_TAKEN ||
            recordResult === RecordRejection.INVALID_ATTRIBUTES
          ) {
            // NAME_TAKEN/INVALID_ATTRIBUTES → 확정 미전송 + 대응 메시지. (요구사항 7.3)
            expect(step).toBe("blocked-rejection");
          } else if (recordResult === RecordRejection.ALREADY_CONFIRMED) {
            // ALREADY_CONFIRMED → 확정 미전송 + Confirmed_State 표시. (요구사항 7.4)
            expect(step).toBe("blocked-already-confirmed");
          } else {
            // 그 외 거부(UNKNOWN_PLAYER·OTHER)도 확정을 보내지 않는다. (요구사항 7.3)
            expect(step).toBe("blocked-rejection");
          }

          // send-confirm은 오직 기록 성공일 때에만 나온다(확정은 기록 성공 시에만 진행).
          expect(step === "send-confirm").toBe(recordResult === "success");

          // (2) CONFIRM_RESULT가 NO_CHARACTER이면 Confirmed_State 비전이 + 입력 보존. (요구사항 7.5)
          const base = {
            ...createInitialState(HANDOFF),
            narrativeValues,
            traitValues,
            confirmed: false,
          };
          const next = reduce(base, { type: "CONFIRM_RESULT", result: "NO_CHARACTER" });

          // Confirmed_State로 전이하지 않는다. (요구사항 7.5)
          expect(next.confirmed).toBe(false);
          // 플레이어가 입력한 값은 변형 없이 보존된다. (요구사항 7.5)
          expect(next.narrativeValues).toEqual(narrativeValues);
          expect(next.traitValues).toEqual(traitValues);
          // 인계 식별자도 보존된다.
          expect(next.handoff).toEqual(base.handoff);
          // NO_CHARACTER 안내로 전이한다. (요구사항 7.5)
          expect(next.notice).toBe(NO_CHARACTER_MESSAGE);
        },
      ),
      { numRuns: 100 },
    );
  });
});
