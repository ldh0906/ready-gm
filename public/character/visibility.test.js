// @ts-nocheck
/**
 * Property-based test for Character_Sheet_App visibility/view model.
 * Feature: character-sheet
 *
 * Covers:
 * - Property 23: 가시성은 상태의 함수다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeVisibility, createInitialState, AreaPhase } from "./logic.js";

// 각 요청 영역(스키마/제안/기록/확정)의 단계 생성기: idle/loading/loaded/error.
const phaseGen = fc.constantFrom(
  AreaPhase.IDLE,
  AreaPhase.LOADING,
  AreaPhase.LOADED,
  AreaPhase.ERROR,
);

// 임의 화면 상태 생성기: 인계 유효/무효, 각 단계 조합, confirmed·nextHandoffDone 토글.
const stateGen = fc
  .record({
    handoffValid: fc.boolean(),
    schemaArea: phaseGen,
    proposal: phaseGen,
    record: phaseGen,
    confirm: phaseGen,
    confirmed: fc.boolean(),
    nextHandoffDone: fc.boolean(),
  })
  .map((overrides) => {
    // 유효/무효 인계로 기준 상태를 만든 뒤 단계·확정 플래그를 덮어쓴다.
    const base = createInitialState(
      overrides.handoffValid
        ? { roomId: "r1", playerId: "p1", token: "" }
        : { roomId: "", playerId: "", token: "" },
    );
    return { ...base, ...overrides };
  });

describe("character-sheet property tests — visibility / view model", () => {
  it("Property 23: 가시성은 상태의 함수다", () => {
    // Feature: character-sheet, Property 23: 가시성은 상태의 함수다
    fc.assert(
      fc.property(stateGen, (state) => {
        const vis = computeVisibility(state);

        const anyLoading =
          state.schemaArea === AreaPhase.LOADING ||
          state.proposal === AreaPhase.LOADING ||
          state.record === AreaPhase.LOADING ||
          state.confirm === AreaPhase.LOADING;
        const authoringEnabled = state.handoffValid && !state.confirmed;

        // (a) 인계 무효 시 작성 컨트롤 비활성, 유효·비확정 시 활성. (요구사항 1.4, 2.4, 5.3)
        if (!state.handoffValid) {
          expect(vis.narrativeInputsEnabled).toBe(false);
          expect(vis.traitEditEnabled).toBe(false);
          expect(vis.proposeEnabled).toBe(false);
          expect(vis.saveEnabled).toBe(false);
          expect(vis.confirmEnabled).toBe(false);
        } else if (!state.confirmed) {
          expect(vis.narrativeInputsEnabled).toBe(true);
          expect(vis.traitEditEnabled).toBe(true);
        }
        expect(vis.narrativeInputsEnabled).toBe(authoringEnabled);
        expect(vis.traitEditEnabled).toBe(authoringEnabled);

        // (b) loading 단계는 인디케이터를 표시하고, 진행 중이면 동작을 비활성으로 유지한다. (요구사항 9.2, 9.3, 13.9)
        expect(vis.schemaLoading).toBe(state.schemaArea === AreaPhase.LOADING);
        expect(vis.proposalLoading).toBe(state.proposal === AreaPhase.LOADING);
        expect(vis.recordLoading).toBe(state.record === AreaPhase.LOADING);
        expect(vis.confirmLoading).toBe(state.confirm === AreaPhase.LOADING);
        expect(vis.anyRequestLoading).toBe(anyLoading);
        if (anyLoading) {
          expect(vis.proposeEnabled).toBe(false);
          expect(vis.saveEnabled).toBe(false);
          expect(vis.confirmEnabled).toBe(false);
        }
        // 동작은 작성 가능 && 진행 중 아님일 때만 활성 (확정 시 잠금 우선). (요구사항 9.4)
        const actionsEnabled = authoringEnabled && !anyLoading;
        expect(vis.proposeEnabled).toBe(actionsEnabled);
        expect(vis.saveEnabled).toBe(actionsEnabled);
        expect(vis.confirmEnabled).toBe(actionsEnabled);

        // (c) 오류로 종료된 요청은 동일 입력 재시도를 활성으로 둔다(진행 중 아님 + 인계 유효). (요구사항 10.4)
        const hasRecoverableError =
          state.proposal === AreaPhase.ERROR ||
          state.record === AreaPhase.ERROR ||
          state.confirm === AreaPhase.ERROR;
        expect(vis.retryEnabled).toBe(
          state.handoffValid && hasRecoverableError && !anyLoading,
        );

        // (d) Next_Screen 진입은 confirmed일 때만 활성(인계 1회 보장). (요구사항 8.1, 8.4)
        expect(vis.nextEnabled).toBe(state.confirmed && !state.nextHandoffDone);
        if (vis.nextEnabled) {
          expect(state.confirmed).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
