// @ts-nocheck
/**
 * Property-based tests for Room_Lobby_App reducer transitions.
 * Feature: room-lobby
 *
 * Covers:
 * - Property 6: 방 정보 검증과 보존
 * - Property 12: 세션 시작 명령은 정확히 한 번 전송된다
 * - Property 14: 세션 시작 실패·타임아웃은 재시도 가능 상태로 되돌린다
 * - Property 17: 복사 성공 확인 메시지는 최소 3초 표시된다
 * - Property 18: 복구 가능 오류는 입력을 보존하고 재시도를 허용한다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  reduce,
  validateRoomInfo,
  createInitialState,
  AreaPhase,
  ErrorKind,
  ConnectionStatus,
  COPY_CONFIRM_MS,
  SESSION_START_FAILED_MESSAGE,
  SESSION_START_TIMEOUT_MESSAGE,
} from "./logic.js";

const validHandoff = { roomId: "r1", hostPlayerId: "h1", token: "t1" };

describe("room-lobby property tests — reducer", () => {
  it("Property 6: 방 정보 검증과 보존", () => {
    // Feature: room-lobby, Property 6: 방 정보 검증과 보존
    const validBody = fc.record({
      maxPlayers: fc.integer({ min: 1, max: 50 }),
      scenarioId: fc.string({ minLength: 1 }),
    });
    // 무효: 0/음수 정원, 비정수 정원, 정원 누락, 빈/누락/비문자열 scenarioId, 비객체.
    const invalidBody = fc.oneof(
      fc.record({ maxPlayers: fc.integer({ min: -20, max: 0 }), scenarioId: fc.string({ minLength: 1 }) }),
      fc.record({
        maxPlayers: fc.double({ min: 1.1, max: 50, noNaN: true, noDefaultInfinity: true }).filter((n) => !Number.isInteger(n)),
        scenarioId: fc.string({ minLength: 1 }),
      }),
      fc.record({ scenarioId: fc.string({ minLength: 1 }) }), // maxPlayers 누락
      fc.record({ maxPlayers: fc.integer({ min: 1, max: 50 }), scenarioId: fc.constant("") }),
      fc.record({ maxPlayers: fc.integer({ min: 1, max: 50 }) }), // scenarioId 누락
      fc.record({ maxPlayers: fc.integer({ min: 1, max: 50 }), scenarioId: fc.integer() }), // 비문자열
      fc.constant(null),
    );

    fc.assert(
      fc.property(fc.oneof(validBody.map((b) => ({ body: b, valid: true })), invalidBody.map((b) => ({ body: b, valid: false }))), ({ body, valid }) => {
        const result = validateRoomInfo(body);
        expect(result.ok).toBe(valid);

        if (valid) {
          expect(result.maxPlayers).toBe(body.maxPlayers);
          expect(result.scenarioId).toBe(body.scenarioId);
          // ROOM_SUCCEEDED reduce 후 값 보존.
          const next = reduce(createInitialState(validHandoff), {
            type: "ROOM_SUCCEEDED",
            maxPlayers: result.maxPlayers,
            scenarioId: result.scenarioId,
          });
          expect(next.room.phase).toBe(AreaPhase.LOADED);
          expect(next.room.data.maxPlayers).toBe(body.maxPlayers);
          expect(next.room.data.scenarioId).toBe(body.scenarioId);
        } else {
          // 무효 → ROOM_INVALID 처리.
          const next = reduce(createInitialState(validHandoff), { type: "ROOM_INVALID" });
          expect(next.room.phase).toBe(AreaPhase.ERROR);
          expect(next.room.errorKind).toBe(ErrorKind.INVALID);
          expect(next.room.data).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });

  it("Property 12: 세션 시작 명령은 정확히 한 번 전송된다", () => {
    // Feature: room-lobby, Property 12: 세션 시작 명령은 정확히 한 번 전송된다
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 4 }),
        (scenarioId, rosterSize, n) => {
          // computeStartEnabled가 true가 되도록 상태를 구성한다.
          const roster = Array.from({ length: rosterSize }, (_, i) => ({
            id: "p" + i,
            displayName: "player" + i,
            isHost: i === 0,
          }));
          const enabled = {
            ...createInitialState(validHandoff),
            connection: ConnectionStatus.OPEN,
            selectedScenario: { scenarioId, title: null, summary: null },
            roster,
          };

          // 첫 START_SESSION은 false→true로 전이한다.
          const after1 = reduce(enabled, { type: "START_SESSION" });
          expect(after1).not.toBe(enabled);
          expect(after1.startCommandSent).toBe(true);
          expect(after1.sessionStarting).toBe(true);

          // 이후 추가 START_SESSION은 모두 무효(동일 참조).
          let cur = after1;
          for (let i = 1; i < n; i++) {
            const nxt = reduce(cur, { type: "START_SESSION" });
            expect(nxt).toBe(cur);
            cur = nxt;
          }
          expect(cur.startCommandSent).toBe(true);
          expect(cur.sessionStarting).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 14: 세션 시작 실패·타임아웃은 재시도 가능 상태로 되돌린다", () => {
    // Feature: room-lobby, Property 14: 세션 시작 실패·타임아웃은 재시도 가능 상태로 되돌린다
    const failureGen = fc.constantFrom(
      { type: "START_SESSION_FAILED", message: SESSION_START_FAILED_MESSAGE },
      { type: "START_SESSION_TIMEOUT", message: SESSION_START_TIMEOUT_MESSAGE },
    );
    fc.assert(
      fc.property(failureGen, (failure) => {
        const starting = {
          ...createInitialState(validHandoff),
          startCommandSent: true,
          sessionStarting: true,
        };
        const next = reduce(starting, { type: failure.type });
        expect(next.sessionStarting).toBe(false);
        expect(next.startCommandSent).toBe(false);
        expect(next.startError).toBe(failure.message);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 17: 복사 성공 확인 메시지는 최소 3초 표시된다", () => {
    // Feature: room-lobby, Property 17: 복사 성공 확인 메시지는 최소 3초 표시된다
    fc.assert(
      fc.property(fc.integer(), (now) => {
        const next = reduce(createInitialState(validHandoff), { type: "COPY_SUCCEEDED", now });
        expect(next.copyConfirmedUntil).toBe(now + COPY_CONFIRM_MS);
        expect(next.copyFailed).toBe(false);
        expect(COPY_CONFIRM_MS).toBe(3000);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 18: 복구 가능 오류는 입력을 보존하고 재시도를 허용한다", () => {
    // Feature: room-lobby, Property 18: 복구 가능 오류는 입력을 보존하고 재시도를 허용한다
    const errorKindGen = fc.constantFrom(...Object.values(ErrorKind));
    const failAreaGen = fc.record({
      type: fc.constantFrom("INVITE_FAILED", "ROOM_FAILED", "SCENARIOS_FAILED"),
      kind: errorKindGen,
    });
    const handoffGen = fc.record({
      roomId: fc.string(),
      hostPlayerId: fc.string(),
      token: fc.string(),
    });
    const areaOf = { INVITE_FAILED: "invite", ROOM_FAILED: "room", SCENARIOS_FAILED: "scenarios" };

    fc.assert(
      fc.property(handoffGen, fc.array(failAreaGen, { minLength: 1, maxLength: 8 }), (handoff, seq) => {
        let state = createInitialState(handoff);
        for (const f of seq) {
          state = reduce(state, { type: f.type, kind: f.kind });
        }
        // 인계 식별자·토큰은 어떤 오류로도 변경되지 않는다.
        expect(state.handoff.roomId).toBe(handoff.roomId);
        expect(state.handoff.hostPlayerId).toBe(handoff.hostPlayerId);
        expect(state.handoff.token).toBe(handoff.token);

        // 실패가 발생한 영역은 재요청 가능한 error 단계가 된다.
        const failedAreas = new Set(seq.map((f) => areaOf[f.type]));
        for (const area of failedAreas) {
          expect(state[area].phase).toBe(AreaPhase.ERROR);
        }
      }),
      { numRuns: 100 },
    );
  });
});
