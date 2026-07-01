// @ts-nocheck
/**
 * Property-based tests for Host_Entry_App enter-room / lobby handoff logic.
 * Feature: frontend-applications
 *
 * Covers:
 * - Property 10: 방 진입 가능 여부는 식별자 존재와 동치다
 * - Property 11: 로비 인계는 정확히 한 번 수행되며 식별자와 토큰을 전달한다
 * - Property 12: 인계 전 식별자는 불변이다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  createInitialState,
  reduce,
  canEnterRoom,
  buildHandoff,
  Phase,
} from "./logic.js";

const token = fc.string();
const tokenGen = fc.oneof(fc.constant(""), fc.string({ minLength: 1 }));

// roomId/hostPlayerId가 누락(undefined)·빈 문자열·비어있지 않은 문자열일 수 있다.
const idGen = fc.oneof(fc.constant(undefined), fc.constant(""), fc.string({ minLength: 1 }));

// 진입 가능한(식별자가 모두 비어있지 않은) 성공 페이로드.
const enterableSuccess = fc.record({
  roomId: fc.string({ minLength: 1 }),
  inviteToken: fc.string(),
  inviteLink: fc.string(),
  hostPlayerId: fc.string({ minLength: 1 }),
  state: fc.string(),
  maxPlayers: fc.integer(),
});

const isNonEmptyString = (v) => typeof v === "string" && v.length > 0;

describe("frontend-applications property tests — enter room & handoff", () => {
  it("Property 10: 방 진입 가능 여부는 식별자 존재와 동치다", () => {
    // Feature: frontend-applications, Property 10: 방 진입 가능 여부는 식별자 존재와 동치다
    expect(canEnterRoom(null)).toBe(false);
    fc.assert(
      fc.property(idGen, idGen, fc.integer(), (roomId, hostPlayerId, maxPlayers) => {
        const success = {
          roomId,
          hostPlayerId,
          inviteToken: "t",
          inviteLink: "l",
          state: "waiting",
          maxPlayers,
        };
        const expected = isNonEmptyString(roomId) && isNonEmptyString(hostPlayerId);
        expect(canEnterRoom(success)).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 11: 로비 인계는 정확히 한 번 수행되며 식별자와 토큰을 전달한다", () => {
    // Feature: frontend-applications, Property 11: 로비 인계는 정확히 한 번 수행되며 식별자와 토큰을 전달한다
    fc.assert(
      fc.property(enterableSuccess, tokenGen, fc.integer({ min: 1, max: 12 }), (success, tok, n) => {
        const initial = {
          ...createInitialState(tok),
          phase: Phase.SUCCESS,
          success,
        };

        // N(≥1)회 ENTER_ROOM을 reduce 하며 false→true 전이 횟수를 센다.
        let s = initial;
        let transitions = 0;
        for (let i = 0; i < n; i++) {
          const before = s.handoffDone;
          s = reduce(s, { type: "ENTER_ROOM" });
          if (!before && s.handoffDone) transitions += 1;
        }

        // 인계는 정확히 한 번만 수행되고 이후로도 true로 유지된다.
        expect(transitions).toBe(1);
        expect(s.handoffDone).toBe(true);

        // 인계 페이로드는 roomId/hostPlayerId를 포함한다.
        const handoff = buildHandoff(success, tok);
        expect(handoff.roomId).toBe(success.roomId);
        expect(handoff.hostPlayerId).toBe(success.hostPlayerId);
        // 토큰이 비어있지 않으면 함께 포함, 비어있으면 키가 없다.
        if (tok.length > 0) {
          expect(handoff.token).toBe(tok);
        } else {
          expect("token" in handoff).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("buildHandoff: 서버 발급 연결 티켓(connectionToken)을 ticket으로 인계한다(auth-hardening)", () => {
    const success = {
      roomId: "r1",
      hostPlayerId: "h1",
      inviteToken: "it",
      inviteLink: "l",
      state: "waiting",
      maxPlayers: 4,
      connectionToken: "host-ticket-xyz",
    };
    // connectionToken이 있으면 토큰 유무와 무관하게 handoff.ticket으로 실린다.
    expect(buildHandoff(success, "tok").ticket).toBe("host-ticket-xyz");
    expect(buildHandoff(success, "").ticket).toBe("host-ticket-xyz");
    // 기존 식별자/토큰 계약은 그대로다.
    expect(buildHandoff(success, "tok").token).toBe("tok");
    // connectionToken이 없거나 빈 문자열이면 ticket 키 자체를 생략한다.
    expect("ticket" in buildHandoff({ ...success, connectionToken: undefined }, "tok")).toBe(false);
    expect("ticket" in buildHandoff({ ...success, connectionToken: "" }, "tok")).toBe(false);
    // 값은 변형 없이 그대로 전달된다.
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (tkt) => {
        expect(buildHandoff({ ...success, connectionToken: tkt }, "t").ticket).toBe(tkt);
      }),
      { numRuns: 50 },
    );
  });

  it("Property 12: 인계 전 식별자는 불변이다", () => {
    // Feature: frontend-applications, Property 12: 인계 전 식별자는 불변이다
    // ENTER_ROOM을 제외한 액션 시퀀스. REQUEST_SUCCEEDED/REQUEST_FAILED는 설계상
    // 성공 패널(Submit 비활성)에서 디스패치되지 않는 새 요청 라이프사이클이며
    // success를 정당하게 교체/제거하므로(요구사항 2.5/2.6) 인계 전 흐름에서 제외한다.
    const actionGen = fc.oneof(
      fc.record({ type: fc.constant("INPUT_CHANGED"), value: fc.string() }),
      fc.constant({ type: "SUBMIT" }),
      fc.record({ type: fc.constant("COPY_SUCCEEDED"), now: fc.integer() }),
      fc.constant({ type: "COPY_FAILED" }),
    );

    fc.assert(
      fc.property(enterableSuccess, token, fc.array(actionGen, { maxLength: 25 }), (success, tok, actions) => {
        const initial = {
          ...createInitialState(tok),
          phase: Phase.SUCCESS,
          success,
        };
        const final = actions.reduce((st, action) => reduce(st, action), initial);

        // 식별자는 변경되지 않는다.
        expect(final.success).not.toBeNull();
        expect(final.success.roomId).toBe(success.roomId);
        expect(final.success.hostPlayerId).toBe(success.hostPlayerId);
      }),
      { numRuns: 100 },
    );
  });
});
