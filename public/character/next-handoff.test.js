// @ts-nocheck
/**
 * Property-based test for Character_Sheet_App Next_Screen handoff payload / once-only handoff.
 * Feature: character-sheet
 *
 * Covers:
 * - Property 21: Next_Screen 인계 페이로드와 1회 인계
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildNextHandoff, buildNextSearch, reduce, createInitialState } from "./logic.js";

// 비어 있지 않은 식별자 생성기(앞뒤 공백·특수문자·유니코드 포함 가능, 트림 후 비어 있지 않음).
const idGen = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length >= 1);

// 토큰 생성기: 빈 문자열(미포함) 또는 비어 있지 않은 임의 문자열(특수문자 포함).
const tokenGen = fc.oneof(
  fc.constant(""),
  fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.length >= 1),
);

const handoffGen = fc.record({
  roomId: idGen,
  playerId: idGen,
  token: tokenGen,
  ticket: tokenGen,
});

describe("character-sheet property tests — Next_Screen 인계 페이로드와 1회 인계", () => {
  it("보안: game URL에는 token/ticket bearer 값을 싣지 않는다", () => {
    const search = buildNextSearch({
      roomId: "r1",
      playerId: "p1",
      token: "secret",
      ticket: "ticket-1",
    });
    const params = new URLSearchParams(search);

    expect(params.get("roomId")).toBe("r1");
    expect(params.get("playerId")).toBe("p1");
    expect(params.has("token")).toBe(false);
    expect(params.has("ticket")).toBe(false);
    expect(search).not.toContain("secret");
    expect(search).not.toContain("ticket-1");
  });

  it("Property 21: Next_Screen 인계 페이로드와 1회 인계", () => {
    // Feature: character-sheet, Property 21: Next_Screen 인계 페이로드와 1회 인계
    fc.assert(
      fc.property(
        handoffGen,
        fc.boolean(), // confirmed 여부
        fc.integer({ min: 1, max: 8 }), // NEXT_HANDOFF 디스패치 횟수 N ≥ 1
        (handoff, confirmed, dispatchCount) => {
          // -- 인계 페이로드(buildNextHandoff): roomId·playerId(+비어있지 않은 토큰) 포함, 변형 없음. --
          // (요구사항 8.2, 11.3, 11.4)
          const payload = buildNextHandoff(handoff);
          expect(payload.roomId).toBe(handoff.roomId);
          expect(payload.playerId).toBe(handoff.playerId);
          if (handoff.token.length >= 1) {
            expect(payload.token).toBe(handoff.token);
          } else {
            expect("token" in payload).toBe(false);
          }
          // 연결 티켓(auth-hardening): 비어있지 않을 때만 변형 없이 포함.
          if (handoff.ticket.length >= 1) {
            expect(payload.ticket).toBe(handoff.ticket);
          } else {
            expect("ticket" in payload).toBe(false);
          }

          // -- 인계 쿼리(buildNextSearch): roomId·playerId만 URL 인코딩해 포함. --
          const search = buildNextSearch(handoff);
          const params = new URLSearchParams(search);
          expect(params.get("roomId")).toBe(handoff.roomId);
          expect(params.get("playerId")).toBe(handoff.playerId);
          expect(params.has("token")).toBe(false);
          expect(params.has("ticket")).toBe(false);

          // -- 초기 상태 구성 후 confirmed 여부만 설정한다. --
          const initial = { ...createInitialState(handoff), confirmed };
          expect(initial.nextHandoffDone).toBe(false);

          // NEXT_HANDOFF를 N회(N ≥ 1) 디스패치한다.
          let state = initial;
          let transitions = 0;
          for (let i = 0; i < dispatchCount; i += 1) {
            const before = state.nextHandoffDone;
            state = reduce(state, { type: "NEXT_HANDOFF" });
            if (before === false && state.nextHandoffDone === true) {
              transitions += 1;
            }
          }

          if (confirmed === true) {
            // confirmed이면 nextHandoffDone은 정확히 한 번만 false→true로 전이한다. (요구사항 8.3)
            expect(transitions).toBe(1);
            expect(state.nextHandoffDone).toBe(true);
          } else {
            // confirmed가 아니면 인계하지 않는다(미인계). (요구사항 8.4)
            expect(transitions).toBe(0);
            expect(state.nextHandoffDone).toBe(false);
          }

          // -- 어느 경우에도 handoff(roomId·playerId·token·ticket)는 불변이다. (요구사항 8.5, 11.3, 11.4) --
          expect(state.handoff).toEqual(initial.handoff);
          expect(state.handoff.roomId).toBe(handoff.roomId);
          expect(state.handoff.playerId).toBe(handoff.playerId);
          expect(state.handoff.token).toBe(handoff.token);
          expect(state.handoff.ticket).toBe(handoff.ticket);
        },
      ),
      { numRuns: 100 },
    );
  });
});
