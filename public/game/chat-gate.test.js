// @ts-nocheck
/**
 * Unit tests for the P-1 chat gate (table talk during resolving/rolling).
 * Feature: game-play (P-1 — 해석·굴림 중 테이블 잡담 허용)
 *
 * canSendChat / isChatOnlyPhase are pure gates the client uses to keep the
 * message input open (chat only) while the round resolves, without unlocking
 * the CONFIRM/PASS/REVISE action controls.
 */
import { describe, it, expect } from "vitest";
import { Phase, ConnectionStatus, canSendChat, isChatOnlyPhase } from "./logic.js";

const base = {
  handoffValid: true,
  turnReceived: true,
  ended: false,
  connection: ConnectionStatus.OPEN,
  phase: Phase.RESOLVING,
};

describe("canSendChat (P-1)", () => {
  it("allows chat when connected, handoff valid, turn received, not ended", () => {
    expect(canSendChat(base)).toBe(true);
    // Independent of phase — chat is allowed while resolving/rolling too.
    expect(canSendChat({ ...base, phase: Phase.ROLLING })).toBe(true);
    expect(canSendChat({ ...base, phase: Phase.FREE_CHAT })).toBe(true);
  });

  it("blocks chat when the session has ended", () => {
    expect(canSendChat({ ...base, ended: true })).toBe(false);
  });

  it("blocks chat before the first turn_state arrives", () => {
    expect(canSendChat({ ...base, turnReceived: false })).toBe(false);
  });

  it("blocks chat when disconnected or handoff invalid", () => {
    expect(canSendChat({ ...base, connection: ConnectionStatus.DISCONNECTED })).toBe(false);
    expect(canSendChat({ ...base, handoffValid: false })).toBe(false);
  });

  it("returns false for missing state", () => {
    expect(canSendChat(undefined)).toBe(false);
    expect(canSendChat(null)).toBe(false);
  });
});

describe("isChatOnlyPhase (P-1)", () => {
  it("is true only during resolving/rolling", () => {
    expect(isChatOnlyPhase({ phase: Phase.RESOLVING })).toBe(true);
    expect(isChatOnlyPhase({ phase: Phase.ROLLING })).toBe(true);
    expect(isChatOnlyPhase({ phase: Phase.FREE_CHAT })).toBe(false);
    expect(isChatOnlyPhase({ phase: Phase.READY_CHECK })).toBe(false);
    expect(isChatOnlyPhase({ phase: Phase.ENDED })).toBe(false);
    expect(isChatOnlyPhase(undefined)).toBe(false);
  });
});
