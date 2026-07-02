// @ts-nocheck
/**
 * Property-based tests for Room_Lobby_App handoff parsing/validation,
 * invite-token extraction, and game-screen handoff.
 * Feature: room-lobby
 *
 * Covers:
 * - Property 1: 인계 파싱과 검증
 * - Property 5: 초대 토큰 추출 라운드트립
 * - Property 13: 세션 활성 감지와 게임 화면 인계 1회
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  parseHandoff,
  isHandoffValid,
  extractInviteToken,
  detectSessionActive,
  buildGameHandoff,
  effectiveViewerId,
  reduce,
  createInitialState,
  AreaPhase,
} from "./logic.js";

// 앞뒤 임의 공백(공백/탭) + 임의 내부 문자열(빈/공백만 포함).
const ws = fc.stringOf(fc.constantFrom(" ", "\t"), { maxLength: 3 });
const rawValueGen = fc.tuple(ws, fc.string(), ws).map(([a, b, c]) => a + b + c);

// 기본 초대 베이스 URL (design: DEFAULT_INVITE_BASE_URL = "https://ready-gm/r/").
const INVITE_BASE = "https://ready-gm/r/";
// "/", "?", "#"를 포함하지 않는 비어있지 않은 토큰(마지막 세그먼트로 그대로 복원 가능).
const cleanTokenGen = fc.string({ minLength: 1 }).filter((t) => !/[/?#]/.test(t));

describe("room-lobby property tests — handoff", () => {
  it("Property 1: 인계 파싱과 검증", () => {
    // Feature: room-lobby, Property 1: 인계 파싱과 검증
    fc.assert(
      fc.property(rawValueGen, rawValueGen, rawValueGen, (roomIdRaw, hostRaw, tokenRaw) => {
        // 생성된 값으로 URLSearchParams를 통해 쿼리 문자열을 구성한다(라운드트립).
        const params = new URLSearchParams();
        params.set("roomId", roomIdRaw);
        params.set("hostPlayerId", hostRaw);
        params.set("token", tokenRaw);
        params.set("ticket", tokenRaw);
        const search = "?" + params.toString();

        const handoff = parseHandoff(search);
        // 각 값은 공백 제거(trim)된 결과로 추출된다.
        expect(handoff.roomId).toBe(roomIdRaw.trim());
        expect(handoff.hostPlayerId).toBe(hostRaw.trim());
        expect(handoff.token).toBe(tokenRaw.trim());
        // ticket(auth-hardening)도 트림되어 라운드트립된다.
        expect(handoff.ticket).toBe(tokenRaw.trim());

        // isHandoffValid는 트림된 roomId와 hostPlayerId가 모두 비어있지 않을 때만 true.
        const expectedValid = roomIdRaw.trim().length >= 1 && hostRaw.trim().length >= 1;
        expect(isHandoffValid(handoff)).toBe(expectedValid);

        // 무효 인계는 HANDOFF_PARSED reduce 후에도 어떤 REST 영역도 loading이 아니다.
        if (!expectedValid) {
          const next = reduce(createInitialState({ roomId: "", hostPlayerId: "", token: "" }), {
            type: "HANDOFF_PARSED",
            handoff,
          });
          expect(next.handoffValid).toBe(false);
          expect(next.invite.phase).not.toBe(AreaPhase.LOADING);
          expect(next.room.phase).not.toBe(AreaPhase.LOADING);
          expect(next.scenarios.phase).not.toBe(AreaPhase.LOADING);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("Property 5: 초대 토큰 추출 라운드트립", () => {
    // Feature: room-lobby, Property 5: 초대 토큰 추출 라운드트립
    const recoverableGen = fc
      .record({
        token: cleanTokenGen,
        trailingSlashes: fc.integer({ min: 0, max: 3 }),
        suffix: fc.constantFrom("", "?foo=bar", "#frag", "?a=1&b=2"),
      })
      .map(({ token, trailingSlashes, suffix }) => ({
        link: INVITE_BASE + token + "/".repeat(trailingSlashes) + suffix,
        expected: token,
      }));

    // 마지막 경로 세그먼트를 만들 수 없는 입력은 "" 반환 → 방 정보 조회 생략.
    const nonExtractableGen = fc.constantFrom(
      { link: "", expected: "" },
      { link: "/", expected: "" },
      { link: "//", expected: "" },
      { link: "///", expected: "" },
      { link: "?only=query", expected: "" },
      { link: "#frag", expected: "" },
      { link: "/?q=1", expected: "" },
      { link: "///#f", expected: "" },
    );

    fc.assert(
      fc.property(fc.oneof(recoverableGen, nonExtractableGen), ({ link, expected }) => {
        expect(extractInviteToken(link)).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 13: 세션 활성 감지와 게임 화면 인계 1회", () => {
    // Feature: room-lobby, Property 13: 세션 활성 감지와 게임 화면 인계 1회
    const turnGen = fc.record({
      roundNumber: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 5 }), fc.constant(undefined)),
      roomState: fc.constantFrom("lobby", "in_session", undefined),
    });
    const handoffGen = fc.record({
      roomId: fc.string({ minLength: 1 }),
      hostPlayerId: fc.string({ minLength: 1 }),
      playerId: fc.oneof(fc.constant(""), fc.string({ minLength: 1 })),
      token: fc.oneof(fc.constant(""), fc.string({ minLength: 1 })),
      ticket: fc.oneof(fc.constant(""), fc.string({ minLength: 1 })),
    });

    fc.assert(
      fc.property(handoffGen, fc.array(turnGen, { minLength: 1, maxLength: 8 }), (handoff, seq) => {
        // --- TURN_STATE 인계 1회 ---
        let state = { ...createInitialState(handoff), sessionStarting: true };
        let sawActive = false;
        for (const ts of seq) {
          const prev = state;
          state = reduce(prev, {
            type: "TURN_STATE",
            roundNumber: ts.roundNumber,
            roomState: ts.roomState,
          });
          const active = detectSessionActive(ts);
          if (sawActive) {
            // 이미 인계됨 → 추가 이벤트는 무효(동일 참조).
            expect(state).toBe(prev);
            expect(state.handoffDone).toBe(true);
          } else if (active) {
            // 첫 활성 이벤트 → 정확히 1회 인계.
            expect(state.handoffDone).toBe(true);
            expect(state.sessionStarting).toBe(false);
            expect(state).not.toBe(prev);
            sawActive = true;
          } else {
            // 비활성 동안에는 인계되지 않음(동일 참조).
            expect(state).toBe(prev);
            expect(state.handoffDone).toBe(false);
          }
        }
        // 시퀀스에 활성 이벤트가 하나라도 있었으면 인계되어 있어야 한다.
        const anyActive = seq.some((ts) => detectSessionActive(ts));
        expect(state.handoffDone).toBe(anyActive);

        // --- buildGameHandoff: roomId·hostPlayerId(+viewer playerId)만 포함 ---
        const payload = buildGameHandoff(handoff);
        expect(payload.roomId).toBe(handoff.roomId);
        expect(payload.hostPlayerId).toBe(handoff.hostPlayerId);
        expect("token" in payload).toBe(false);
        // playerId = effectiveViewerId(playerId 우선, 없으면 hostPlayerId, 트림). 비어있지 않을 때만 포함.
        const expectedViewer = effectiveViewerId(handoff);
        if (expectedViewer.length > 0) {
          expect(payload.playerId).toBe(expectedViewer);
        } else {
          expect("playerId" in payload).toBe(false);
        }
        expect("ticket" in payload).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
