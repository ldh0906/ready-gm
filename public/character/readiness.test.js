// @ts-nocheck
/**
 * Unit tests for Character_Sheet_App readiness + host-start pure helpers.
 * Feature: character-sheet (multiplayer readiness layer — ADDITIVE)
 *
 * Covers the pure helpers added alongside the existing reduce/computeVisibility
 * state machine:
 *   - buildReadinessRequest (url encoding, method, auth header presence/absence)
 *   - buildStartRequest (url encoding, method, body, headers)
 *   - parseReadiness (safe defaults + coercion)
 *   - isHostViewer (host vs non-host vs missing)
 *   - hostStartEnabled (allConfirmed/started combinations)
 *   - formatReadiness (Korean string + null safety)
 */
import { describe, it, expect } from "vitest";
import {
  buildReadinessRequest,
  buildStartRequest,
  parseReadiness,
  isHostViewer,
  hostStartEnabled,
  formatReadiness,
} from "./logic.js";

describe("buildReadinessRequest", () => {
  it("GET /rooms/{enc(roomId)}/readiness 명세를 만든다", () => {
    const req = buildReadinessRequest({ roomId: "r1", playerId: "p1", token: "" });
    expect(req.method).toBe("GET");
    expect(req.url).toBe("/rooms/r1/readiness");
  });

  it("roomId를 URL 인코딩한다", () => {
    const req = buildReadinessRequest({ roomId: "a/b c?#&", playerId: "p1", token: "" });
    expect(req.url).toBe("/rooms/" + encodeURIComponent("a/b c?#&") + "/readiness");
  });

  it("토큰이 있으면 x-playtest-token 헤더를 포함한다", () => {
    const req = buildReadinessRequest({ roomId: "r1", playerId: "p1", token: "secret" });
    expect(req.headers["x-playtest-token"]).toBe("secret");
  });

  it("토큰이 없으면 x-playtest-token 헤더가 없다", () => {
    const req = buildReadinessRequest({ roomId: "r1", playerId: "p1", token: "" });
    expect("x-playtest-token" in req.headers).toBe(false);
  });

  it("handoff가 null이어도 안전하게 빈 roomId로 처리한다", () => {
    const req = buildReadinessRequest(null);
    expect(req.url).toBe("/rooms//readiness");
    expect("x-playtest-token" in req.headers).toBe(false);
  });
});

describe("buildStartRequest", () => {
  it("POST /rooms/{enc(roomId)}/players/{enc(playerId)}/start 명세를 만든다", () => {
    const req = buildStartRequest({ roomId: "r1", playerId: "p1", token: "" });
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/rooms/r1/players/p1/start");
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.body).toBe(JSON.stringify({}));
  });

  it("roomId·playerId를 URL 인코딩한다", () => {
    const req = buildStartRequest({ roomId: "방 1", playerId: "p/2", token: "" });
    expect(req.url).toBe(
      "/rooms/" + encodeURIComponent("방 1") + "/players/" + encodeURIComponent("p/2") + "/start",
    );
  });

  it("토큰이 있으면 x-playtest-token 헤더를 포함한다", () => {
    const req = buildStartRequest({ roomId: "r1", playerId: "p1", token: "tok" });
    expect(req.headers["x-playtest-token"]).toBe("tok");
  });

  it("토큰이 없으면 x-playtest-token 헤더가 없다", () => {
    const req = buildStartRequest({ roomId: "r1", playerId: "p1", token: "" });
    expect("x-playtest-token" in req.headers).toBe(false);
  });

  it("handoff가 null이어도 안전하게 처리한다", () => {
    const req = buildStartRequest(null);
    expect(req.url).toBe("/rooms//players//start");
    expect(req.body).toBe(JSON.stringify({}));
  });
});

describe("parseReadiness", () => {
  it("정상 본문을 그대로 정규화한다", () => {
    const r = parseReadiness({
      total: 3,
      confirmed: 2,
      allConfirmed: false,
      started: false,
      hostPlayerId: "host-1",
    });
    expect(r).toEqual({
      total: 3,
      confirmed: 2,
      allConfirmed: false,
      started: false,
      hostPlayerId: "host-1",
      returnToLobby: false,
    });
  });

  it("누락 필드를 안전 기본값으로 채운다", () => {
    expect(parseReadiness({})).toEqual({
      total: 0,
      confirmed: 0,
      allConfirmed: false,
      started: false,
      hostPlayerId: "",
      returnToLobby: false,
    });
  });

  it("객체가 아니면 모두 기본값", () => {
    for (const bad of [null, undefined, 42, "x", []]) {
      const r = parseReadiness(bad);
      expect(r.total).toBe(0);
      expect(r.confirmed).toBe(0);
      expect(r.allConfirmed).toBe(false);
      expect(r.started).toBe(false);
      expect(r.hostPlayerId).toBe("");
    }
  });

  it("숫자를 0 이상의 정수로 강제한다(음수→0, 소수→내림, 문자열 숫자 허용)", () => {
    expect(parseReadiness({ total: -5, confirmed: 2.9 })).toMatchObject({ total: 0, confirmed: 2 });
    expect(parseReadiness({ total: "4", confirmed: "1" })).toMatchObject({ total: 4, confirmed: 1 });
    expect(parseReadiness({ total: NaN, confirmed: Infinity })).toMatchObject({
      total: 0,
      confirmed: 0,
    });
  });

  it("불리언은 엄격히 true일 때만 true", () => {
    expect(parseReadiness({ allConfirmed: "true", started: 1 })).toMatchObject({
      allConfirmed: false,
      started: false,
    });
    expect(parseReadiness({ allConfirmed: true, started: true })).toMatchObject({
      allConfirmed: true,
      started: true,
    });
  });

  it("hostPlayerId는 비어있지 않은 문자열만 보존, 그 외는 빈 문자열", () => {
    expect(parseReadiness({ hostPlayerId: "" }).hostPlayerId).toBe("");
    expect(parseReadiness({ hostPlayerId: 123 }).hostPlayerId).toBe("");
    expect(parseReadiness({ hostPlayerId: "p9" }).hostPlayerId).toBe("p9");
  });
});

describe("isHostViewer", () => {
  const readiness = parseReadiness({ hostPlayerId: "p1", total: 2, confirmed: 1 });

  it("playerId가 hostPlayerId와 일치하면 true", () => {
    expect(isHostViewer({ roomId: "r", playerId: "p1", token: "" }, readiness)).toBe(true);
  });

  it("playerId가 다르면 false", () => {
    expect(isHostViewer({ roomId: "r", playerId: "p2", token: "" }, readiness)).toBe(false);
  });

  it("playerId가 비어있으면 false", () => {
    expect(isHostViewer({ roomId: "r", playerId: "", token: "" }, readiness)).toBe(false);
  });

  it("readiness가 없으면 false", () => {
    expect(isHostViewer({ roomId: "r", playerId: "p1", token: "" }, null)).toBe(false);
  });

  it("handoff가 없으면 false", () => {
    expect(isHostViewer(null, readiness)).toBe(false);
  });

  it("hostPlayerId가 빈 문자열이면(둘 다 빈 값) false", () => {
    const noHost = parseReadiness({ hostPlayerId: "" });
    expect(isHostViewer({ roomId: "r", playerId: "", token: "" }, noHost)).toBe(false);
  });
});

describe("hostStartEnabled", () => {
  it("전원 확정 && 미시작이면 true", () => {
    expect(hostStartEnabled(parseReadiness({ allConfirmed: true, started: false }))).toBe(true);
  });

  it("전원 미확정이면 false", () => {
    expect(hostStartEnabled(parseReadiness({ allConfirmed: false, started: false }))).toBe(false);
  });

  it("이미 시작됐으면 false", () => {
    expect(hostStartEnabled(parseReadiness({ allConfirmed: true, started: true }))).toBe(false);
  });

  it("readiness가 없으면 false", () => {
    expect(hostStartEnabled(null)).toBe(false);
    expect(hostStartEnabled(undefined)).toBe(false);
  });
});

describe("formatReadiness", () => {
  it("준비 confirmed / total 형태", () => {
    expect(formatReadiness(parseReadiness({ confirmed: 2, total: 3 }))).toBe("준비 2 / 3");
  });

  it("readiness가 null이면 준비 0 / 0", () => {
    expect(formatReadiness(null)).toBe("준비 0 / 0");
    expect(formatReadiness(undefined)).toBe("준비 0 / 0");
  });
});
