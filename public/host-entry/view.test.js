// @ts-nocheck
/**
 * Property-based tests for Host_Entry_App view model & invite panel render.
 * Feature: frontend-applications
 *
 * Covers:
 * - Property 8: Invite_Panel 렌더는 필수 방 정보를 모두 포함한다
 * - Property 9: 가시성은 단계의 함수다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  createInitialState,
  computeVisibility,
  renderInvitePanel,
  Phase,
} from "./logic.js";

// logic.js의 esc() 패턴을 그대로 복제(같은 이스케이프로 기대값을 만든다).
function esc(value) {
  return String(value).replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]),
  );
}

// 특수문자(& < >)를 포함할 수 있는 inviteLink + 임의 정수 maxPlayers.
const successPayload = fc.record({
  roomId: fc.string(),
  inviteToken: fc.string(),
  inviteLink: fc.string(),
  hostPlayerId: fc.string(),
  state: fc.string(),
  maxPlayers: fc.integer(),
});

const anyPhase = fc.constantFrom(Phase.IDLE, Phase.SUBMITTING, Phase.SUCCESS, Phase.ERROR);

describe("frontend-applications property tests — view model & render", () => {
  it("Property 8: Invite_Panel 렌더는 필수 방 정보를 모두 포함한다", () => {
    // Feature: frontend-applications, Property 8: Invite_Panel 렌더는 필수 방 정보를 모두 포함한다
    fc.assert(
      fc.property(successPayload, (success) => {
        const markup = renderInvitePanel(success);

        // inviteLink 전체 문자열이 (이스케이프된 형태로) 포함된다.
        expect(markup).toContain(esc(success.inviteLink));
        // maxPlayers 값이 포함된다.
        expect(markup).toContain(String(success.maxPlayers));
      }),
      { numRuns: 100 },
    );
  });

  it("Property 9: 가시성은 단계의 함수다", () => {
    // Feature: frontend-applications, Property 9: 가시성은 단계의 함수다
    fc.assert(
      fc.property(anyPhase, (phase) => {
        const state = { ...createInitialState(""), phase };
        const vis = computeVisibility(state);

        // 진행 인디케이터는 submitting일 때만.
        expect(vis.indicator).toBe(phase === Phase.SUBMITTING);
        // Invite_Panel은 success일 때만.
        expect(vis.panel).toBe(phase === Phase.SUCCESS);
        // Submit_Action은 submitting/success일 때 비활성, 그 외 활성.
        expect(vis.submitDisabled).toBe(phase === Phase.SUBMITTING || phase === Phase.SUCCESS);
      }),
      { numRuns: 100 },
    );
  });
});
