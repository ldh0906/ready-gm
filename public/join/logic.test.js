// @ts-nocheck
/**
 * Property / example tests for Join_App pure logic.
 * Feature: multiplayer-session-flow — 단계 1 (초대 입장 화면)
 *
 * Covers (pure functions, no DOM/network):
 * - extractInviteToken: 다양한 /join/<tok> 형태, 끝 슬래시, 질의/프래그먼트, 누락
 * - buildAuthHeaders: 토큰 유무
 * - buildJoinRequest: URL 인코딩, 트림된 이름, 인증 헤더 유무
 * - classifyOutcome: 모든 분기 구분
 * - isBlankName: 공백/비공백
 * - validateJoinResponse: roomId/playerId 유무
 * - buildLobbySearch: 토큰 생략(빈) / 인코딩
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  extractInviteToken,
  buildAuthHeaders,
  buildJoinRequest,
  classifyOutcome,
  isBlankName,
  validateJoinResponse,
  buildLobbySearch,
} from "./logic.js";

// 슬래시·물음표·해시·공백을 포함하지 않는 토큰(세그먼트 안전) 생성기.
const tokenSegment = fc
  .string({ minLength: 1 })
  .filter((s) => s.trim().length > 0 && !/[\/?#]/.test(s));
const accessToken = fc.oneof(fc.constant(""), fc.string({ minLength: 1 }));

describe("multiplayer-session-flow 단계1 — extractInviteToken", () => {
  it("예제: /join/<tok> 기본 형태에서 토큰을 추출한다", () => {
    expect(extractInviteToken("/join/abc123")).toBe("abc123");
  });

  it("예제: 끝 슬래시를 제거한다", () => {
    expect(extractInviteToken("/join/abc123/")).toBe("abc123");
    expect(extractInviteToken("/join/abc123///")).toBe("abc123");
  });

  it("예제: 질의·프래그먼트를 제거한다", () => {
    expect(extractInviteToken("/join/abc123?foo=bar")).toBe("abc123");
    expect(extractInviteToken("/join/abc123#section")).toBe("abc123");
    expect(extractInviteToken("/join/abc123/?x=1#y")).toBe("abc123");
  });

  it("예제: 전체 URL 형태에서도 토큰을 추출한다", () => {
    expect(extractInviteToken("https://ready-gm.example/join/tok-xyz")).toBe("tok-xyz");
    expect(extractInviteToken("https://ready-gm.example/join/tok-xyz?token=secret")).toBe(
      "tok-xyz",
    );
  });

  it("예제: 퍼센트 인코딩된 토큰을 디코드한다", () => {
    expect(extractInviteToken("/join/" + encodeURIComponent("토큰 a/b"))).toBe("토큰 a/b");
  });

  it("예제: 토큰이 없으면 빈 문자열을 반환한다", () => {
    expect(extractInviteToken("/join")).toBe("");
    expect(extractInviteToken("/join/")).toBe("");
    expect(extractInviteToken("/")).toBe("");
    expect(extractInviteToken("")).toBe("");
    expect(extractInviteToken(null)).toBe("");
    expect(extractInviteToken("/lobby/abc")).toBe("");
  });

  it("속성: /join/<tok> 형태는 끝 슬래시·질의·프래그먼트와 무관하게 동일 토큰을 낸다", () => {
    fc.assert(
      fc.property(
        tokenSegment,
        fc.constantFrom("", "/", "//"),
        fc.constantFrom("", "?a=1", "#frag", "?a=1#frag"),
        (tok, trailing, suffix) => {
          const encoded = encodeURIComponent(tok);
          const path = "/join/" + encoded + trailing + suffix;
          expect(extractInviteToken(path)).toBe(tok);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("multiplayer-session-flow 단계1 — buildAuthHeaders", () => {
  it("속성: 토큰이 비어 있지 않으면 헤더에, 비어 있으면 빈 객체", () => {
    fc.assert(
      fc.property(accessToken, (tok) => {
        const headers = buildAuthHeaders(tok);
        if (tok.length > 0) {
          expect(headers).toEqual({ "x-playtest-token": tok });
        } else {
          expect(headers).toEqual({});
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("multiplayer-session-flow 단계1 — buildJoinRequest", () => {
  it("속성: URL은 인코딩된 초대 토큰을 포함하고 메서드는 POST다", () => {
    fc.assert(
      fc.property(tokenSegment, fc.string({ minLength: 1 }), accessToken, (tok, name, at) => {
        const req = buildJoinRequest(tok, name, at);
        expect(req.method).toBe("POST");
        expect(req.url).toBe("/rooms/" + encodeURIComponent(tok) + "/join");
      }),
      { numRuns: 100 },
    );
  });

  it("속성: 바디의 displayName은 트림된 이름과 일치한다", () => {
    fc.assert(
      fc.property(tokenSegment, fc.string(), accessToken, (tok, name, at) => {
        const req = buildJoinRequest(tok, name, at);
        const parsed = JSON.parse(req.body);
        expect(parsed.displayName).toBe(name.trim());
      }),
      { numRuns: 100 },
    );
  });

  it("속성: content-type은 항상, x-playtest-token은 토큰 유무에 따라 존재", () => {
    fc.assert(
      fc.property(tokenSegment, fc.string({ minLength: 1 }), accessToken, (tok, name, at) => {
        const req = buildJoinRequest(tok, name, at);
        expect(req.headers["content-type"]).toBe("application/json");
        if (at.length > 0) {
          expect(req.headers["x-playtest-token"]).toBe(at);
        } else {
          expect("x-playtest-token" in req.headers).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("예제: 특수문자 토큰을 인코딩한다", () => {
    const req = buildJoinRequest("a/b c", "  이름  ", "");
    expect(req.url).toBe("/rooms/a%2Fb%20c/join");
    expect(JSON.parse(req.body).displayName).toBe("이름");
  });
});

describe("multiplayer-session-flow 단계1 — classifyOutcome", () => {
  it("예제: 모든 분기가 구분된다", () => {
    expect(classifyOutcome({ kind: "network" })).toBe("network");
    expect(classifyOutcome({ kind: "timeout" })).toBe("timeout");
    expect(classifyOutcome({ kind: "response", response: { ok: true, status: 200 } })).toBe(
      "success",
    );
    expect(classifyOutcome({ kind: "response", response: { ok: true, status: 201 } })).toBe(
      "success",
    );
    expect(classifyOutcome({ kind: "response", response: { ok: false, status: 404 } })).toBe(
      "notfound",
    );
    expect(classifyOutcome({ kind: "response", response: { ok: false, status: 409 } })).toBe(
      "full",
    );
    expect(classifyOutcome({ kind: "response", response: { ok: false, status: 401 } })).toBe(
      "auth",
    );
    expect(classifyOutcome({ kind: "response", response: { ok: false, status: 403 } })).toBe(
      "auth",
    );
    expect(classifyOutcome({ kind: "response", response: { ok: false, status: 500 } })).toBe(
      "server",
    );
    expect(classifyOutcome({ kind: "response", response: { ok: false, status: 503 } })).toBe(
      "server",
    );
    // 기타 4xx(예: 400)는 보수적으로 server.
    expect(classifyOutcome({ kind: "response", response: { ok: false, status: 400 } })).toBe(
      "server",
    );
    // 알 수 없는 종류도 server.
    expect(classifyOutcome({})).toBe("server");
    expect(classifyOutcome(null)).toBe("server");
  });

  it("속성: 임의 2xx는 항상 success", () => {
    fc.assert(
      fc.property(fc.integer({ min: 200, max: 299 }), (status) => {
        expect(classifyOutcome({ kind: "response", response: { ok: true, status } })).toBe(
          "success",
        );
      }),
      { numRuns: 100 },
    );
  });

  it("속성: 임의 5xx는 항상 server", () => {
    fc.assert(
      fc.property(fc.integer({ min: 500, max: 599 }), (status) => {
        expect(classifyOutcome({ kind: "response", response: { ok: false, status } })).toBe(
          "server",
        );
      }),
      { numRuns: 100 },
    );
  });
});

describe("multiplayer-session-flow 단계1 — isBlankName", () => {
  it("예제: 공백만 있거나 비어 있으면 true", () => {
    expect(isBlankName("")).toBe(true);
    expect(isBlankName("   ")).toBe(true);
    expect(isBlankName("\t\n")).toBe(true);
    expect(isBlankName("\u3000")).toBe(true); // 전각 공백
    expect(isBlankName(null)).toBe(true);
    expect(isBlankName(undefined)).toBe(true);
  });

  it("예제: 트림 후 1자 이상이면 false", () => {
    expect(isBlankName("a")).toBe(false);
    expect(isBlankName("  이름  ")).toBe(false);
  });

  it("속성: 비공백 문자를 포함하면 false, 공백만이면 true", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(isBlankName(s)).toBe(s.trim().length < 1);
      }),
      { numRuns: 100 },
    );
  });
});

describe("multiplayer-session-flow 단계1 — validateJoinResponse", () => {
  it("예제: roomId·playerId가 모두 비어 있지 않은 문자열일 때만 ok:true", () => {
    expect(validateJoinResponse({ roomId: "r1", playerId: "p1" })).toEqual({
      ok: true,
      roomId: "r1",
      playerId: "p1",
      displayName: "",
      connectionToken: "",
    });
    expect(
      validateJoinResponse({ roomId: "r1", playerId: "p1", displayName: "이름" }),
    ).toEqual({ ok: true, roomId: "r1", playerId: "p1", displayName: "이름", connectionToken: "" });
  });

  it("예제: 서버 발급 연결 티켓(connectionToken)을 보존한다(auth-hardening)", () => {
    expect(
      validateJoinResponse({ roomId: "r1", playerId: "p1", connectionToken: "tkt-123" }),
    ).toEqual({
      ok: true,
      roomId: "r1",
      playerId: "p1",
      displayName: "",
      connectionToken: "tkt-123",
    });
    // 비문자열·빈 티켓은 빈 문자열로 정규화한다.
    expect(validateJoinResponse({ roomId: "r1", playerId: "p1", connectionToken: 5 }).connectionToken).toBe("");
    expect(validateJoinResponse({ roomId: "r1", playerId: "p1", connectionToken: "" }).connectionToken).toBe("");
  });

  it("예제: 누락·빈값·비문자열은 ok:false", () => {
    expect(validateJoinResponse({ roomId: "r1" })).toEqual({ ok: false });
    expect(validateJoinResponse({ playerId: "p1" })).toEqual({ ok: false });
    expect(validateJoinResponse({ roomId: "", playerId: "p1" })).toEqual({ ok: false });
    expect(validateJoinResponse({ roomId: "r1", playerId: "" })).toEqual({ ok: false });
    expect(validateJoinResponse({ roomId: 1, playerId: 2 })).toEqual({ ok: false });
    expect(validateJoinResponse(null)).toEqual({ ok: false });
    expect(validateJoinResponse("nope")).toEqual({ ok: false });
    expect(validateJoinResponse(undefined)).toEqual({ ok: false });
  });

  it("속성: 비어 있지 않은 roomId·playerId면 항상 ok:true이고 값 보존", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (roomId, playerId) => {
        const result = validateJoinResponse({ roomId, playerId });
        expect(result.ok).toBe(true);
        expect(result.roomId).toBe(roomId);
        expect(result.playerId).toBe(playerId);
      }),
      { numRuns: 100 },
    );
  });
});

describe("multiplayer-session-flow 단계1 — buildLobbySearch", () => {
  it("예제: 토큰이 비어 있으면 token 파라미터를 생략한다", () => {
    const search = buildLobbySearch({ roomId: "r1", playerId: "p1", token: "" });
    const params = new URLSearchParams(search);
    expect(params.get("roomId")).toBe("r1");
    expect(params.get("playerId")).toBe("p1");
    expect(params.has("token")).toBe(false);
    // hostPlayerId는 설정하지 않는다(입장 플레이어는 호스트가 아님).
    expect(params.has("hostPlayerId")).toBe(false);
  });

  it("예제: 토큰이 있으면 token 파라미터를 포함한다", () => {
    const search = buildLobbySearch({ roomId: "r1", playerId: "p1", token: "secret" });
    const params = new URLSearchParams(search);
    expect(params.get("token")).toBe("secret");
  });

  it("예제: 연결 티켓(ticket)은 비어 있으면 생략, 있으면 포함한다(auth-hardening)", () => {
    const without = new URLSearchParams(
      buildLobbySearch({ roomId: "r1", playerId: "p1", token: "", ticket: "" }),
    );
    expect(without.has("ticket")).toBe(false);
    const with_ = new URLSearchParams(
      buildLobbySearch({ roomId: "r1", playerId: "p1", token: "", ticket: "tkt&1" }),
    );
    expect(with_.get("ticket")).toBe("tkt&1");
    // ticket이 없는(undefined) payload도 안전하게 생략한다.
    const omitted = new URLSearchParams(buildLobbySearch({ roomId: "r1", playerId: "p1", token: "" }));
    expect(omitted.has("ticket")).toBe(false);
  });

  it("예제: 선행 ?를 포함한다", () => {
    expect(buildLobbySearch({ roomId: "r1", playerId: "p1", token: "" }).startsWith("?")).toBe(
      true,
    );
  });

  it("속성: roundtrip — 인코딩된 값이 정확히 복원되고 token·ticket은 유무에 따른다", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        accessToken,
        accessToken,
        (roomId, playerId, token, ticket) => {
          const search = buildLobbySearch({ roomId, playerId, token, ticket });
          const params = new URLSearchParams(search);
          expect(params.get("roomId")).toBe(roomId);
          expect(params.get("playerId")).toBe(playerId);
          if (token.length > 0) {
            expect(params.get("token")).toBe(token);
          } else {
            expect(params.has("token")).toBe(false);
          }
          if (ticket.length > 0) {
            expect(params.get("ticket")).toBe(ticket);
          } else {
            expect(params.has("ticket")).toBe(false);
          }
          // hostPlayerId는 절대 설정하지 않는다.
          expect(params.has("hostPlayerId")).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
