// @ts-nocheck
/**
 * Property-based test for Character_Sheet_App blank-name blocking on save/confirm.
 * Feature: character-sheet
 *
 * Covers:
 * - Property 18: 빈 이름은 저장·확정을 차단하고 입력을 보존한다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { reduce, createInitialState, trimForSend, BLANK_NAME_MESSAGE } from "./logic.js";

// 공백 제거 후 길이가 0인 Character_Name 생성기(빈 문자열·공백/탭/개행만으로 구성). (요구사항 6.2, 7.6)
const blankNameGen = fc
  .array(fc.constantFrom(" ", "\t", "\n", "\r", "\u00a0", "\u3000", ""), { maxLength: 8 })
  .map((parts) => parts.join(""));

// 임의 서사 입력 맵 생성기(이름 외 자유 필드 포함).
const narrativeValuesGen = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 8 }),
  fc.string({ maxLength: 40 }),
  { maxKeys: 5 },
);

// 임의 Rated_Trait_Set 생성기(Trait_Key → Trait_Level 정수).
const traitValuesGen = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 8 }),
  fc.integer({ min: -10, max: 10 }),
  { maxKeys: 5 },
);

// 임의 작성 상태 생성기: 유효 인계 + 빈 이름 + 임의 서사·평가 입력.
const writingStateGen = fc
  .record({
    blankName: blankNameGen,
    narrativeValues: narrativeValuesGen,
    traitValues: traitValuesGen,
  })
  .map(({ blankName, narrativeValues, traitValues }) => {
    const base = createInitialState({ roomId: "room-1", playerId: "player-1", token: "" });
    return {
      ...base,
      narrativeValues: { ...narrativeValues, name: blankName },
      traitValues: { ...traitValues },
    };
  });

describe("character-sheet property tests — blank name blocks save/confirm", () => {
  it("Property 18: 빈 이름은 저장·확정을 차단하고 입력을 보존한다", () => {
    // Feature: character-sheet, Property 18: 빈 이름은 저장·확정을 차단하고 입력을 보존한다
    fc.assert(
      fc.property(
        writingStateGen,
        fc.constantFrom("SAVE_BLANK_NAME", "CONFIRM_BLANK_NAME"),
        (state, actionType) => {
          // 전제: 이름은 공백 제거 후 길이 0이다(빈 이름 차단 조건). (요구사항 6.2, 7.6)
          expect(trimForSend(state.narrativeValues.name).length).toBe(0);

          const next = reduce(state, { type: actionType });

          // Record·Confirm 요청을 모두 보내지 않는다: 어떤 요청 영역도 loading으로 진입하지 않는다.
          expect(next.record).not.toBe("loading");
          expect(next.confirm).not.toBe("loading");
          expect(next.schemaArea).not.toBe("loading");
          expect(next.proposal).not.toBe("loading");

          // 이름 입력이 필요하다는 안내로 전이한다. (요구사항 6.2, 7.6)
          expect(next.notice).toBe(BLANK_NAME_MESSAGE);

          // 확정 상태로 전이하지 않는다.
          expect(next.confirmed).toBe(false);

          // 모든 입력(Narrative_Field·Rated_Trait_Set)은 변경 없이 보존된다.
          expect(next.narrativeValues).toEqual(state.narrativeValues);
          expect(next.traitValues).toEqual(state.traitValues);
        },
      ),
      { numRuns: 100 },
    );
  });
});
