// @ts-nocheck
/**
 * Property-based tests for Room_Lobby_App view-model visibility.
 * Feature: room-lobby
 *
 * Covers:
 * - Property 15: 가시성은 상태의 함수다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  computeVisibility,
  computeStartEnabled,
  isViewerHost,
  AreaPhase,
  ConnectionStatus,
} from "./logic.js";

const phaseGen = fc.constantFrom(
  AreaPhase.IDLE,
  AreaPhase.LOADING,
  AreaPhase.LOADED,
  AreaPhase.ERROR,
);
const areaGen = fc.record({
  phase: phaseGen,
  errorKind: fc.constant(null),
  data: fc.constant(null),
});
const connectionGen = fc.constantFrom(
  ConnectionStatus.CONNECTING,
  ConnectionStatus.OPEN,
  ConnectionStatus.DISCONNECTED,
);
const playerGen = fc.record({ id: fc.string(), displayName: fc.string(), isHost: fc.boolean() });

const stateGen = fc.record({
  handoff: fc.record({
    roomId: fc.string(),
    hostPlayerId: fc.oneof(fc.constant(""), fc.string({ minLength: 1 })),
    playerId: fc.oneof(fc.constant(""), fc.string({ minLength: 1 })),
    token: fc.constant(""),
  }),
  handoffValid: fc.boolean(),
  invite: areaGen,
  room: areaGen,
  scenarios: areaGen,
  connection: connectionGen,
  sessionStarting: fc.boolean(),
  selectedScenario: fc.record({
    scenarioId: fc.oneof(fc.constant(null), fc.constant(""), fc.string({ minLength: 1 })),
    title: fc.oneof(fc.constant(null), fc.constant(""), fc.string({ minLength: 1 })),
    summary: fc.oneof(fc.constant(null), fc.string()),
  }),
  roster: fc.array(playerGen, { maxLength: 4 }),
});

describe("room-lobby property tests — visibility", () => {
  it("Property 15: 가시성은 상태의 함수다", () => {
    // Feature: room-lobby, Property 15: 가시성은 상태의 함수다
    fc.assert(
      fc.property(stateGen, (state) => {
        const vis = computeVisibility(state);
        const controlsDisabled = !state.handoffValid;

        expect(vis.handoffValid).toBe(state.handoffValid);
        expect(vis.controlsDisabled).toBe(controlsDisabled);

        // 영역별 로딩 인디케이터는 phase === "loading"일 때만.
        const inviteLoading = state.invite.phase === AreaPhase.LOADING;
        const roomLoading = state.room.phase === AreaPhase.LOADING;
        const scenariosLoading = state.scenarios.phase === AreaPhase.LOADING;
        expect(vis.inviteLoading).toBe(inviteLoading);
        expect(vis.roomLoading).toBe(roomLoading);
        expect(vis.scenariosLoading).toBe(scenariosLoading);

        // 재트리거 비활성 = controlsDisabled || 해당 영역 로딩.
        expect(vis.inviteRetriggerDisabled).toBe(controlsDisabled || inviteLoading);
        expect(vis.roomRetriggerDisabled).toBe(controlsDisabled || roomLoading);
        expect(vis.scenariosRetriggerDisabled).toBe(controlsDisabled || scenariosLoading);

        // 연결 활성 표시는 connection === "open"일 때만.
        expect(vis.connectionActive).toBe(state.connection === ConnectionStatus.OPEN);
        // 세션 시작 인디케이터는 sessionStarting일 때만.
        expect(vis.sessionStarting).toBe(state.sessionStarting);

        // isHost는 isViewerHost(state)를 반영한다.
        const isHost = isViewerHost(state);
        expect(vis.isHost).toBe(isHost);

        // 시작 활성 = handoffValid && isHost && !sessionStarting && computeStartEnabled.
        const expectedStartEnabled =
          state.handoffValid && isHost && !state.sessionStarting && computeStartEnabled(state);
        expect(vis.startEnabled).toBe(expectedStartEnabled);

        // 복사 비활성 = controlsDisabled || invite.phase !== "loaded".
        expect(vis.copyDisabled).toBe(controlsDisabled || state.invite.phase !== AreaPhase.LOADED);
      }),
      { numRuns: 100 },
    );
  });
});
