// @ts-nocheck
/**
 * Property-based tests for Game_Play_App handoff parsing/validation
 * and connect-parameter token delivery.
 * Feature: game-play
 *
 * Covers:
 * - Property 1: 인계 파싱과 검증
 * - Property 2: 접근 토큰은 연결 파라미터로 그대로 전달된다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  parseHandoff,
  isHandoffValid,
  effectivePlayerId,
  buildConnectParams,
  reduce,
  createInitialState,
  ConnectionStatus,
} from "./logic.js";

// 앞뒤 임의 공백(공백/탭) + 임의 내부 문자열(빈/공백만 포함).
const ws = fc.stringOf(fc.constantFrom(" ", "\t"), { maxLength: 3 });
const rawValueGen = fc.tuple(ws, fc.string(), ws).map(([a, b, c]) => a + b + c);

// 빈 문자열과 임의의 비공백/특수문자/이모지 포함 문자열.
const tokenGen = fc.oneof(
  fc.constant(""),
  fc.string(),
  fc.fullUnicodeString(),
  fc.constantFrom("a&b", "x=y", "a b c", "🎲", "p+q", "한글토큰", "%20"),
);
const roomIdGen = fc.oneof(
  fc.string({ minLength: 1 }),
  fc.fullUnicodeString({ minLength: 1 }),
  fc.constantFrom("room&1", "r=2", "방 1", "🚪room"),
);

describe("game-play property tests — handoff", () => {
  it("Property 1: 인계 파싱과 검증", () => {
    // Feature: game-play, Property 1: 인계 파싱과 검증
    fc.assert(
      fc.property(rawValueGen, rawValueGen, rawValueGen, (roomIdRaw, hostRaw, tokenRaw) => {
        // 생성된 값으로 URLSearchParams를 통해 쿼리 문자열을 구성한다(라운드트립).
        const params = new URLSearchParams();
        params.set("roomId", roomIdRaw);
        params.set("hostPlayerId", hostRaw);
        params.set("token", tokenRaw);
        const search = "?" + params.toString();

        const handoff = parseHandoff(search);
        // 각 값은 공백 제거(trim)된 결과로 추출된다.
        expect(handoff.roomId).toBe(roomIdRaw.trim());
        expect(handoff.hostPlayerId).toBe(hostRaw.trim());
        expect(handoff.token).toBe(tokenRaw.trim());

        // isHandoffValid는 트림된 roomId·hostPlayerId가 모두 비어있지 않을 때만 true.
        const expectedValid = roomIdRaw.trim().length >= 1 && hostRaw.trim().length >= 1;
        expect(isHandoffValid(handoff)).toBe(expectedValid);

        // 무효 인계는 HANDOFF_PARSED reduce 후에도 handoffValid=false,
        // 연결을 시작하지 않으므로 connection은 disconnected 유지.
        if (!expectedValid) {
          const initial = createInitialState({ roomId: "", hostPlayerId: "", token: "" });
          const next = reduce(initial, { type: "HANDOFF_PARSED", handoff });
          expect(next.handoffValid).toBe(false);
          expect(next.connection).toBe(ConnectionStatus.DISCONNECTED);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("Property 2: 접근 토큰은 반환 필드에는 보존되지만 연결 query에는 싣지 않는다", () => {
    // Feature: game-play, Property 2: 접근 토큰은 URL query에서 제외된다
    fc.assert(
      fc.property(roomIdGen, tokenGen, (roomId, token) => {
        const result = buildConnectParams(roomId, token);
        // 반환의 roomId·token 필드는 원래 값 그대로(token은 비어 있어도 "" 보존).
        expect(result.roomId).toBe(roomId);
        expect(result.token).toBe(token);

        // query는 폼 인코딩이므로 URLSearchParams로 디코드해 라운드트립을 확인한다.
        const decoded = new URLSearchParams(result.query);
        expect(decoded.get("roomId")).toBe(roomId);

        expect(decoded.get("token")).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it("보안: WebSocket connect query에는 PLAYTEST_TOKEN을 싣지 않는다", () => {
    const result = buildConnectParams("room-1", "playtest-secret", "p1", "ticket-1");
    const decoded = new URLSearchParams(result.query);

    expect(decoded.get("roomId")).toBe("room-1");
    expect(decoded.get("playerId")).toBe("p1");
    expect(decoded.has("token")).toBe(false);
    expect(result.query).not.toContain("playtest-secret");
  });

  it("parseHandoff는 playerId·ticket를 트림해 추출한다(관전자 식별자·연결 티켓)", () => {
    // Legacy URL도 파싱은 유지하지만, 새 navigation URL은 token/ticket을 싣지 않는다.
    fc.assert(
      fc.property(rawValueGen, rawValueGen, rawValueGen, rawValueGen, (roomIdRaw, hostRaw, playerRaw, tokenRaw) => {
        const params = new URLSearchParams();
        params.set("roomId", roomIdRaw);
        params.set("hostPlayerId", hostRaw);
        params.set("playerId", playerRaw);
        params.set("token", tokenRaw);
        params.set("ticket", tokenRaw);
        const handoff = parseHandoff("?" + params.toString());
        expect(handoff.playerId).toBe(playerRaw.trim());
        expect(handoff.ticket).toBe(tokenRaw.trim());
      }),
      { numRuns: 100 },
    );
  });

  it("effectivePlayerId: playerId 우선, 없으면 hostPlayerId, 둘 다 없으면 \"\"", () => {
    // 예시 기반: 우선순위와 폴백, null-safe/trim 동작을 명시적으로 고정한다.
    expect(effectivePlayerId({ roomId: "r1", hostPlayerId: "h1", playerId: "p2", token: "t" })).toBe("p2");
    expect(effectivePlayerId({ roomId: "r1", hostPlayerId: "h1", playerId: "", token: "t" })).toBe("h1");
    expect(effectivePlayerId({ roomId: "r1", hostPlayerId: "", playerId: "", token: "" })).toBe("");
    // 공백만 있는 playerId는 비어 있는 것으로 보고 hostPlayerId로 폴백한다(trim).
    expect(effectivePlayerId({ roomId: "r1", hostPlayerId: "h1", playerId: "   ", token: "" })).toBe("h1");
    // 트림: 양쪽 공백은 제거된다.
    expect(effectivePlayerId({ roomId: "r1", hostPlayerId: "h1", playerId: "  p9  ", token: "" })).toBe("p9");
    // null-safe: 누락 필드/널 인계도 깨지지 않고 "" 또는 폴백 값을 반환한다.
    expect(effectivePlayerId(null)).toBe("");
    expect(effectivePlayerId({ roomId: "r1", hostPlayerId: "h1" })).toBe("h1");
    expect(effectivePlayerId({ roomId: "r1" })).toBe("");
  });

  it("effectivePlayerId 속성: playerId가 비어있지 않으면 playerId, 아니면 hostPlayerId 폴백", () => {
    const idGen = fc.oneof(
      fc.constant(""),
      fc.constantFrom("   ", "\t"),
      fc.string({ minLength: 1 }),
      fc.constantFrom("p2", "host-9", "🙂", "  trimmed  "),
    );
    fc.assert(
      fc.property(idGen, idGen, (playerRaw, hostRaw) => {
        const result = effectivePlayerId({ roomId: "r1", hostPlayerId: hostRaw, playerId: playerRaw, token: "" });
        const trimmedPlayer = String(playerRaw).trim();
        const expected = trimmedPlayer.length >= 1 ? trimmedPlayer : String(hostRaw).trim();
        expect(result).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("buildConnectParams: 연결 티켓(ticket)이 비어있지 않으면 query에 인코딩되어 포함된다(auth-hardening)", () => {
    const ticketGen = fc.oneof(
      fc.constant(""),
      fc.string(),
      fc.fullUnicodeString(),
      fc.constantFrom("tk2", "tk&1", "t=2", "티켓 1", "🎟"),
    );
    fc.assert(
      fc.property(roomIdGen, tokenGen, ticketGen, (roomId, token, ticket) => {
        // 4번째 인자 ticket; playerId는 빈 문자열로 둬 ticket 단독 효과를 본다.
        const result = buildConnectParams(roomId, token, "", ticket);
        // 반환 필드는 원래 값 보존(비어 있어도 "" 유지).
        expect(result.ticket).toBe(ticket);

        const decoded = new URLSearchParams(result.query);
        // 기존 roomId/token/playerId 계약은 유지된다.
        expect(decoded.get("roomId")).toBe(roomId);
        expect(decoded.get("token")).toBeNull();
        expect(decoded.get("playerId")).toBeNull(); // playerId 비어있음 → 생략.
        if (String(ticket).length > 0) {
          expect(decoded.get("ticket")).toBe(ticket);
        } else {
          expect(decoded.get("ticket")).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });
});
