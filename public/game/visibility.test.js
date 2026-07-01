// @ts-nocheck
/**
 * Property-based tests for Game_Play_App view-model visibility.
 * Feature: game-play
 *
 * Covers:
 * - Property 12: 가시성은 상태의 함수다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  computeVisibility,
  computeReadyCount,
  isInputLocked,
  ConnectionStatus,
  Phase,
} from "./logic.js";

const connectionGen = fc.constantFrom(
  ConnectionStatus.CONNECTING,
  ConnectionStatus.OPEN,
  ConnectionStatus.DISCONNECTED,
);
const phaseGen = fc.oneof(
  fc.constantFrom(Phase.FREE_CHAT, Phase.READY_CHECK, Phase.RESOLVING, Phase.ENDED),
  fc.constant(null),
  fc.string(),
);
const readinessGen = fc.array(
  fc.record({
    playerId: fc.string(),
    status: fc.constantFrom("ready", "not_ready"),
    actionKind: fc.constant(null),
    actionText: fc.constant(null),
  }),
  { maxLength: 8 },
);

// 서사 항목(오프닝/결과)이 도착했는지 여부를 폭넓게 생성(빈 배열 = 오프닝 대기).
const narrationEntriesGen = fc.array(
  fc.record({ kind: fc.constantFrom("opening", "resolution", "closing"), roundNumber: fc.nat(), text: fc.string() }),
  { maxLength: 4 },
);

// 연결 상태·phase·ended·turnReceived·handoffValid 조합을 폭넓게 생성.
const stateGen = fc.record({
  handoffValid: fc.boolean(),
  connection: connectionGen,
  phase: phaseGen,
  ended: fc.boolean(),
  turnReceived: fc.boolean(),
  readiness: readinessGen,
  narrationEntries: narrationEntriesGen,
  deliveryFailedNotice: fc.oneof(fc.constant(null), fc.string()),
});

describe("game-play property tests — visibility", () => {
  it("Property 12: 가시성은 상태의 함수다", () => {
    // Feature: game-play, Property 12: 가시성은 상태의 함수다
    fc.assert(
      fc.property(stateGen, (state) => {
        const vis = computeVisibility(state);

        const connectionActive = state.connection === ConnectionStatus.OPEN;
        const busy = state.phase === Phase.RESOLVING;
        const narrationEntries = Array.isArray(state.narrationEntries) ? state.narrationEntries : [];
        const openingPending =
          state.turnReceived === true && state.ended !== true && narrationEntries.length === 0;
        const inputDisabled =
          !state.handoffValid ||
          state.turnReceived === false ||
          state.ended === true ||
          isInputLocked(state.phase) ||
          !connectionActive ||
          openingPending;

        // (a) 연결 활성은 connection === "open"일 때만.
        expect(vis.connectionActive).toBe(connectionActive);
        // (b) busy는 phase === "resolving"일 때만.
        expect(vis.busy).toBe(busy);
        // (c) 입력 비활성 도출식.
        expect(vis.inputDisabled).toBe(inputDisabled);
        // (d) 종료/미연결/안내/준비 수 전달.
        expect(vis.ended).toBe(state.ended);
        expect(vis.disconnected).toBe(!connectionActive);
        expect(vis.handoffValid).toBe(state.handoffValid);
        expect(vis.deliveryFailedNotice).toBe(state.deliveryFailedNotice);
        expect(vis.ready).toStrictEqual(computeReadyCount(state.readiness));

        // 순수 함수: 동일 상태에 대해 항상 동일한 결과.
        expect(computeVisibility(state)).toStrictEqual(vis);
      }),
      { numRuns: 100 },
    );
  });
});
