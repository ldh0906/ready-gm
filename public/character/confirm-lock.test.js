// @ts-nocheck
/**
 * Property-based test for Character_Sheet_App 확정 잠금(Confirmed_State lock).
 * Feature: character-sheet
 *
 * Covers:
 * - Property 20: 확정 성공은 작성 상태를 잠근다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { reduce, createInitialState, computeVisibility, AreaPhase } from "./logic.js";

// 요청 영역(schema/proposal/record/confirm)이 가질 수 있는 단계.
const phaseGen = fc.constantFrom(
  AreaPhase.IDLE,
  AreaPhase.LOADING,
  AreaPhase.LOADED,
  AreaPhase.ERROR,
);

// 임의의 인계(roomId/playerId가 비어 있을 수 있어 handoffValid가 true/false 모두 가능).
const handoffGen = fc.record({
  roomId: fc.string({ maxLength: 8 }),
  playerId: fc.string({ maxLength: 8 }),
  token: fc.string({ maxLength: 8 }),
});

// 임의의 작성 상태 생성기: 초기 상태에서 인계·작성 값·요청 단계·확정 여부를 임의로 변형한다.
const authoringStateGen = fc
  .record({
    handoff: handoffGen,
    narrativeValues: fc.dictionary(
      fc.string({ minLength: 1, maxLength: 6 }),
      fc.string({ maxLength: 20 }),
    ),
    traitValues: fc.dictionary(
      fc.string({ minLength: 1, maxLength: 6 }),
      fc.integer({ min: -2, max: 4 }),
    ),
    proposal: phaseGen,
    record: phaseGen,
    confirm: phaseGen,
    confirmed: fc.boolean(),
    nextHandoffDone: fc.boolean(),
  })
  .map((parts) => {
    const base = createInitialState(parts.handoff);
    return {
      ...base,
      narrativeValues: parts.narrativeValues,
      traitValues: parts.traitValues,
      proposal: parts.proposal,
      record: parts.record,
      confirm: parts.confirm,
      confirmed: parts.confirmed,
      nextHandoffDone: parts.nextHandoffDone,
    };
  });

describe("character-sheet property tests — 확정 성공 잠금", () => {
  it("Property 20: 확정 성공은 작성 상태를 잠근다", () => {
    // Feature: character-sheet, Property 20: 확정 성공은 작성 상태를 잠근다
    fc.assert(
      fc.property(authoringStateGen, (state) => {
        // 임의 작성 상태에서 CONFIRM_RESULT가 success이면 캐릭터가 확정된다. (요구사항 7.7)
        const next = reduce(state, { type: "CONFIRM_RESULT", result: "success" });
        expect(next.confirmed).toBe(true);

        // computeVisibility가 작성 컨트롤·동작을 비활성(읽기 전용)으로 도출한다. (요구사항 7.7, 7.8)
        const vis = computeVisibility(next);
        expect(vis.narrativeInputsEnabled).toBe(false); // Narrative_Field 입력 비활성
        expect(vis.traitEditEnabled).toBe(false); // Rated_Trait 편집 비활성
        expect(vis.proposeEnabled).toBe(false); // Propose_Action 비활성
        expect(vis.saveEnabled).toBe(false); // Save_Action 비활성
        expect(vis.readonly).toBe(true); // 확정 값 읽기 전용 표시
      }),
      { numRuns: 100 },
    );
  });
});
