// @ts-nocheck
/**
 * Unit tests for the P-2 waiting-progress indicator (pure, ticker-independent).
 * Feature: game-play (P-2 — 대기 시간 단계별 진행 표시)
 *
 * waitingIndicator(phase, rollingChecks) derives WHAT the GM is doing from state
 * so the story panel can show a specific message + elapsed time instead of a
 * generic "GM이 서술을 쓰는 중". No new server events are involved.
 */
import { describe, it, expect } from "vitest";
import { Phase, waitingIndicator } from "./logic.js";

describe("waitingIndicator (P-2)", () => {
  it("resolving with no declared checks → GM is reading and choosing checks", () => {
    const ind = waitingIndicator(Phase.RESOLVING, []);
    expect(ind).toEqual({ key: "declaring", text: "GM이 상황을 읽고 판정을 고르는 중" });
  });

  it("resolving with all checks rolled → GM is writing the result", () => {
    const checks = [
      { checkId: "a", status: "rolled" },
      { checkId: "b", status: "rolled" },
    ];
    const ind = waitingIndicator(Phase.RESOLVING, checks);
    expect(ind).toEqual({ key: "narrating", text: "GM이 결과 서술을 쓰는 중" });
  });

  it("rolling with all checks rolled → GM is writing the result", () => {
    const ind = waitingIndicator(Phase.ROLLING, [{ checkId: "a", status: "rolled" }]);
    expect(ind).toEqual({ key: "narrating", text: "GM이 결과 서술을 쓰는 중" });
  });

  it("rolling with a pending check → hidden (the checks tray UI is the star)", () => {
    const checks = [
      { checkId: "a", status: "pending" },
      { checkId: "b", status: "rolled" },
    ];
    expect(waitingIndicator(Phase.ROLLING, checks)).toBeNull();
  });

  it("rolling with no checks yet → hidden (transient)", () => {
    expect(waitingIndicator(Phase.ROLLING, [])).toBeNull();
  });

  it("free_chat / ready_check / ended → no waiting indicator", () => {
    expect(waitingIndicator(Phase.FREE_CHAT, [])).toBeNull();
    expect(waitingIndicator(Phase.READY_CHECK, [])).toBeNull();
    expect(waitingIndicator(Phase.ENDED, [])).toBeNull();
  });

  it("tolerates a non-array rollingChecks", () => {
    expect(waitingIndicator(Phase.RESOLVING, undefined)).toEqual({
      key: "declaring",
      text: "GM이 상황을 읽고 판정을 고르는 중",
    });
  });
});
