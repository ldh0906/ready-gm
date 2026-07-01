// @ts-nocheck
/**
 * Property-based tests for Room_Lobby_App scenario matching and scenario state.
 * Feature: room-lobby
 *
 * Covers:
 * - Property 7: 시나리오 매칭과 기본 선택
 * - Property 8: scenario_set 이벤트는 표시 시나리오를 갱신한다
 * - Property 9: 시나리오 실패는 기존 표시를 보존한다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  selectScenario,
  reduce,
  createInitialState,
  AreaPhase,
  ErrorKind,
} from "./logic.js";

const validHandoff = { roomId: "r1", hostPlayerId: "h1", token: "" };

// 시나리오 항목 (id는 "/?#" 없는 비어있지 않은 ASCII 문자열, 고유).
const scenarioItem = fc.record({
  id: fc.string({ minLength: 1 }),
  title: fc.string(),
  summary: fc.string(),
});
const uniqueList = (opts) => fc.uniqueArray(scenarioItem, { selector: (s) => s.id, ...opts });

describe("room-lobby property tests — scenario", () => {
  it("Property 7: 시나리오 매칭과 기본 선택", () => {
    // Feature: room-lobby, Property 7: 시나리오 매칭과 기본 선택
    const emptyCase = fc
      .oneof(fc.constant(null), fc.constant(""), fc.string({ minLength: 1 }))
      .map((selectedId) => ({ scenarios: [], selectedId, expectedKind: "empty" }));

    const matchedCase = uniqueList({ minLength: 1 }).chain((list) =>
      fc.nat({ max: list.length - 1 }).map((idx) => ({
        scenarios: list,
        selectedId: list[idx].id,
        expectedKind: "matched",
        expectedScenario: { title: list[idx].title, summary: list[idx].summary },
      })),
    );

    const defaultCase = scenarioItem.chain((only) =>
      fc.constantFrom(null, "").map((selectedId) => ({
        scenarios: [only],
        selectedId,
        expectedKind: "default",
        expectedScenario: { title: only.title, summary: only.summary },
      })),
    );

    // 비어있지 않은 식별자가 어떤 id와도 일치하지 않음(충돌 불가한 제어문자 접미사 사용).
    const unmatchedIdCase = uniqueList({ minLength: 1 }).chain((list) =>
      fc.string().map((s) => ({
        scenarios: list,
        selectedId: s + "\u0000_absent_\u0001",
        expectedKind: "unmatched",
      })),
    );

    // 식별자 미확정 + 목록 2개 이상 → unmatched(어느 것을 표시할지 확정 불가).
    const unmatchedEmptyIdCase = uniqueList({ minLength: 2 }).chain((list) =>
      fc.constantFrom(null, "").map((selectedId) => ({
        scenarios: list,
        selectedId,
        expectedKind: "unmatched",
      })),
    );

    fc.assert(
      fc.property(
        fc.oneof(emptyCase, matchedCase, defaultCase, unmatchedIdCase, unmatchedEmptyIdCase),
        ({ scenarios, selectedId, expectedKind, expectedScenario }) => {
          const result = selectScenario(scenarios, selectedId);
          expect(result.kind).toBe(expectedKind);
          if (expectedScenario) {
            expect(result.scenario).toEqual(expectedScenario);
          } else {
            expect(result.scenario).toBeUndefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 8: scenario_set 이벤트는 표시 시나리오를 갱신한다", () => {
    // Feature: room-lobby, Property 8: scenario_set 이벤트는 표시 시나리오를 갱신한다
    fc.assert(
      fc.property(
        fc.record({ scenarioId: fc.string(), title: fc.string(), summary: fc.string() }),
        ({ scenarioId, title, summary }) => {
          // 사전에 다른 시나리오가 표시되어 있던 상태에서 출발.
          const state = {
            ...createInitialState(validHandoff),
            selectedScenario: { scenarioId: "prev", title: "이전 제목", summary: "이전 소개" },
            scenarioNotice: "이전 안내",
          };
          const next = reduce(state, { type: "SCENARIO_SET", scenarioId, title, summary });
          expect(next.selectedScenario.scenarioId).toBe(scenarioId);
          expect(next.selectedScenario.title).toBe(title);
          expect(next.selectedScenario.summary).toBe(summary);
          // 새 시나리오가 확정되었으므로 빈/불일치 안내는 해제된다.
          expect(next.scenarioNotice).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 9: 시나리오 실패는 기존 표시를 보존한다", () => {
    // Feature: room-lobby, Property 9: 시나리오 실패는 기존 표시를 보존한다
    const errorKindGen = fc.constantFrom(...Object.values(ErrorKind));
    fc.assert(
      fc.property(
        fc.record({ scenarioId: fc.string({ minLength: 1 }), title: fc.string({ minLength: 1 }), summary: fc.string() }),
        errorKindGen,
        (sel, kind) => {
          // 이미 시나리오가 채워진 상태.
          const state = {
            ...createInitialState(validHandoff),
            selectedScenario: { scenarioId: sel.scenarioId, title: sel.title, summary: sel.summary },
          };
          const next = reduce(state, { type: "SCENARIOS_FAILED", kind });
          // scenarios 영역은 error가 되지만 selectedScenario는 불변.
          expect(next.scenarios.phase).toBe(AreaPhase.ERROR);
          expect(next.scenarios.errorKind).toBe(kind);
          expect(next.selectedScenario.title).toBe(sel.title);
          expect(next.selectedScenario.summary).toBe(sel.summary);
          expect(next.selectedScenario.scenarioId).toBe(sel.scenarioId);
        },
      ),
      { numRuns: 100 },
    );
  });
});
