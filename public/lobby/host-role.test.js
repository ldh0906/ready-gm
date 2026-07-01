// @ts-nocheck
/**
 * Example/property tests for host-vs-non-host distinction in Room_Lobby_App.
 * Feature: multiplayer-session-flow — 호스트만 세션 시작
 *
 * Covers:
 * - isViewerHost: 로스터 isHost 플래그(서버 권위) / 인계 휴리스틱(hostPlayerId) /
 *   입장 플레이어(playerId만) → false / null-safe.
 * - computeVisibility: isHost 반영 + 비호스트는 startEnabled가 절대 true가 되지 않는다.
 *   동일 시작 조건에서 호스트는 startEnabled === true.
 */
import { describe, it, expect } from "vitest";
import {
  isViewerHost,
  computeVisibility,
  createInitialState,
  ConnectionStatus,
} from "./logic.js";

/** 시작 조건(연결 open + 시나리오 확정 + 로스터 ≥1)을 충족한 상태를 만든다. */
function startReadyState(handoff, roster) {
  return {
    ...createInitialState(handoff),
    handoffValid: true,
    connection: ConnectionStatus.OPEN,
    selectedScenario: { scenarioId: "s1", title: "시나리오", summary: "요약" },
    roster,
  };
}

describe("multiplayer-session-flow — isViewerHost", () => {
  it("로스터의 isHost 플래그로 호스트를 인식한다(서버 권위)", () => {
    const state = {
      handoff: { roomId: "r1", hostPlayerId: "", playerId: "p1", token: "" },
      roster: [
        { id: "p1", displayName: "나", isHost: true },
        { id: "p2", displayName: "친구", isHost: false },
      ],
    };
    expect(isViewerHost(state)).toBe(true);
  });

  it("인계 휴리스틱: hostPlayerId가 있고 playerId가 비면 즉시 호스트(로스터 도착 전)", () => {
    const state = {
      handoff: { roomId: "r1", hostPlayerId: "h1", playerId: "", token: "" },
      roster: [],
    };
    expect(isViewerHost(state)).toBe(true);
  });

  it("입장 플레이어(playerId만, 로스터 isHost:false)는 호스트가 아니다", () => {
    const state = {
      handoff: { roomId: "r1", hostPlayerId: "", playerId: "p9", token: "" },
      roster: [
        { id: "h1", displayName: "방장", isHost: true },
        { id: "p9", displayName: "나", isHost: false },
      ],
    };
    expect(isViewerHost(state)).toBe(false);
  });

  it("입장 플레이어(playerId만, 로스터에 자신이 아직 없음)도 호스트가 아니다", () => {
    const state = {
      handoff: { roomId: "r1", hostPlayerId: "", playerId: "p9", token: "" },
      roster: [{ id: "h1", displayName: "방장", isHost: true }],
    };
    expect(isViewerHost(state)).toBe(false);
  });

  it("로스터 isHost가 viewer가 아닌 다른 사람을 가리키면 호스트가 아니다", () => {
    const state = {
      handoff: { roomId: "r1", hostPlayerId: "", playerId: "p9", token: "" },
      roster: [{ id: "h1", displayName: "방장", isHost: true }],
    };
    expect(isViewerHost(state)).toBe(false);
  });

  it("null-safe: state/handoff/roster 누락 시 false", () => {
    expect(isViewerHost(null)).toBe(false);
    expect(isViewerHost(undefined)).toBe(false);
    expect(isViewerHost({})).toBe(false);
    expect(isViewerHost({ handoff: null, roster: null })).toBe(false);
    expect(isViewerHost({ handoff: { roomId: "r1", hostPlayerId: "", playerId: "", token: "" } })).toBe(false);
  });

  it("로스터 플래그가 휴리스틱보다 우선해 viewer를 호스트로 확정한다", () => {
    // playerId가 viewer 신원이고, 로스터가 그를 호스트로 표기.
    const state = {
      handoff: { roomId: "r1", hostPlayerId: "h1", playerId: "p1", token: "" },
      roster: [{ id: "p1", displayName: "나", isHost: true }],
    };
    expect(isViewerHost(state)).toBe(true);
  });
});

describe("multiplayer-session-flow — computeVisibility host gating", () => {
  it("호스트(로스터 isHost): 시작 조건 충족 시 isHost && startEnabled true", () => {
    const handoff = { roomId: "r1", hostPlayerId: "", playerId: "p1", token: "" };
    const state = startReadyState(handoff, [{ id: "p1", displayName: "나", isHost: true }]);
    const v = computeVisibility(state);
    expect(v.isHost).toBe(true);
    expect(v.startEnabled).toBe(true);
  });

  it("호스트(인계 휴리스틱): 시작 조건 충족 시 startEnabled true", () => {
    const handoff = { roomId: "r1", hostPlayerId: "h1", playerId: "", token: "" };
    const state = startReadyState(handoff, [{ id: "h1", displayName: "방장", isHost: true }]);
    const v = computeVisibility(state);
    expect(v.isHost).toBe(true);
    expect(v.startEnabled).toBe(true);
  });

  it("비호스트: 동일 시작 조건이라도 isHost false이며 startEnabled는 절대 true가 아니다", () => {
    const handoff = { roomId: "r1", hostPlayerId: "", playerId: "p9", token: "" };
    const state = startReadyState(handoff, [
      { id: "h1", displayName: "방장", isHost: true },
      { id: "p9", displayName: "나", isHost: false },
    ]);
    const v = computeVisibility(state);
    expect(v.isHost).toBe(false);
    expect(v.startEnabled).toBe(false);
  });
});
