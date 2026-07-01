// @ts-nocheck
/**
 * Property-based tests for Game_Play_App local echo of own confirm/pass actions.
 * Feature: game-play
 *
 * Covers:
 * - Property 10: 로컬 에코는 본인의 확정·패스를 행동 로그에 추가한다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { reduce, createInitialState, MAX_ENTRIES } from "./logic.js";

const validHandoff = { roomId: "r1", hostPlayerId: "h1", token: "t1" };

describe("game-play property tests — local echo", () => {
  it("Property 10: 로컬 에코는 본인의 확정·패스를 행동 로그에 추가한다", () => {
    // Feature: game-play, Property 10: 로컬 에코는 본인의 확정·패스를 행동 로그에 추가한다
    const actionGen = fc.oneof(
      fc.record({ kind: fc.constant("confirm"), action: fc.fullUnicodeString() }),
      fc.record({ kind: fc.constant("pass") }),
    );
    // 상한 초과도 자극하기 위해 최대 300개의 액션 시퀀스 생성.
    const seqGen = fc.array(actionGen, { minLength: 0, maxLength: 300 });

    fc.assert(
      fc.property(fc.string(), seqGen, (playerId, seq) => {
        let state = createInitialState(validHandoff);
        const expected = [];
        for (const a of seq) {
          if (a.kind === "confirm") {
            state = reduce(state, { type: "CONFIRM_ACTION", playerId, action: a.action });
            expected.push({ kind: "confirm", playerId, text: a.action });
          } else {
            state = reduce(state, { type: "PASS", playerId });
            expected.push({ kind: "pass", playerId, text: null });
          }
        }

        // 각 액션마다 하나씩 추가되며 길이는 상한을 넘지 않는다.
        expect(state.actionLog.length).toBe(Math.min(seq.length, MAX_ENTRIES));
        // 가장 최근 항목들이 상한 내에서 순서대로 보존된다.
        const tail = expected.slice(Math.max(0, expected.length - MAX_ENTRIES));
        expect(state.actionLog).toStrictEqual(tail);
      }),
      { numRuns: 100 },
    );
  });
});
