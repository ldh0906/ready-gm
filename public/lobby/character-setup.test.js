// @ts-nocheck
/**
 * Property/example tests for the multiplayer character-setup flow additions
 * to Room_Lobby_App logic.
 * Feature: multiplayer-session-flow — 단계 3 (호스트 시작 → 캐릭터 시트 이동)
 *
 * Covers:
 * - parseHandoff: playerId 추출(roomId/hostPlayerId/token에 더해).
 * - isHandoffValid: roomId + playerId(호스트 아님) 유효 / roomId + hostPlayerId 유효 /
 *   두 신원 모두 비면 무효.
 * - buildCharacterSearch: playerId 우선(없으면 hostPlayerId), token 비면 생략, URL 인코딩.
 * - eventToAction: character_setup → CHARACTER_SETUP.
 * - reduce: CHARACTER_SETUP은 characterSetupDone를 1회만 true로(이후 반복은 무변화).
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  parseHandoff,
  isHandoffValid,
  buildCharacterSearch,
  effectiveViewerId,
  eventToAction,
  reduce,
  createInitialState,
} from "./logic.js";

describe("multiplayer-session-flow — lobby character-setup additions", () => {
  it("parseHandoff: roomId/hostPlayerId/playerId/token을 트림하여 추출한다", () => {
    const ws = fc.stringOf(fc.constantFrom(" ", "\t"), { maxLength: 3 });
    const rawValueGen = fc.tuple(ws, fc.string(), ws).map(([a, b, c]) => a + b + c);

    fc.assert(
      fc.property(rawValueGen, rawValueGen, rawValueGen, rawValueGen, (roomRaw, hostRaw, playerRaw, tokenRaw) => {
        const params = new URLSearchParams();
        params.set("roomId", roomRaw);
        params.set("hostPlayerId", hostRaw);
        params.set("playerId", playerRaw);
        params.set("token", tokenRaw);
        const handoff = parseHandoff("?" + params.toString());
        expect(handoff.roomId).toBe(roomRaw.trim());
        expect(handoff.hostPlayerId).toBe(hostRaw.trim());
        expect(handoff.playerId).toBe(playerRaw.trim());
        expect(handoff.token).toBe(tokenRaw.trim());
      }),
      { numRuns: 100 },
    );
  });

  it("parseHandoff: playerId가 없는 쿼리는 빈 문자열로 둔다(하위호환)", () => {
    const handoff = parseHandoff("?roomId=r1&hostPlayerId=h1&token=t1");
    expect(handoff.playerId).toBe("");
    expect(handoff.roomId).toBe("r1");
    expect(handoff.hostPlayerId).toBe("h1");
    expect(handoff.token).toBe("t1");
  });

  it("isHandoffValid: roomId + playerId(호스트 아님)도 유효하다", () => {
    expect(isHandoffValid({ roomId: "r1", hostPlayerId: "", playerId: "p9", token: "" })).toBe(true);
    expect(effectiveViewerId({ roomId: "r1", hostPlayerId: "", playerId: "p9", token: "" })).toBe("p9");
  });

  it("isHandoffValid: roomId + hostPlayerId(playerId 없음)도 유효하다", () => {
    expect(isHandoffValid({ roomId: "r1", hostPlayerId: "h1", playerId: "", token: "" })).toBe(true);
    expect(effectiveViewerId({ roomId: "r1", hostPlayerId: "h1", playerId: "", token: "" })).toBe("h1");
  });

  it("isHandoffValid: viewer 신원이 모두 비면 무효 / roomId가 비면 무효", () => {
    expect(isHandoffValid({ roomId: "r1", hostPlayerId: "", playerId: "", token: "" })).toBe(false);
    expect(isHandoffValid({ roomId: "", hostPlayerId: "h1", playerId: "p1", token: "" })).toBe(false);
  });

  it("isHandoffValid 속성: roomId 비어있지 않고 (playerId||hostPlayerId) 비어있지 않을 때만 true", () => {
    const idGen = fc.oneof(fc.constant(""), fc.string({ minLength: 1 }).filter((s) => s.trim().length >= 1));
    fc.assert(
      fc.property(idGen, idGen, idGen, fc.oneof(fc.constant(""), fc.string()), (roomId, hostPlayerId, playerId, token) => {
        const handoff = { roomId, hostPlayerId, playerId, token };
        const effective = playerId.trim().length >= 1 ? playerId.trim() : hostPlayerId.trim();
        const expected = roomId.trim().length >= 1 && effective.length >= 1;
        expect(isHandoffValid(handoff)).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("buildCharacterSearch: playerId 우선(없으면 hostPlayerId), token은 URL에서 제외, URL 인코딩", () => {
    // playerId 우선.
    const s1 = buildCharacterSearch({ roomId: "r 1", hostPlayerId: "h1", playerId: "p9", token: "t&k" });
    const p1 = new URLSearchParams(s1.replace(/^\?/, ""));
    expect(p1.get("roomId")).toBe("r 1");
    expect(p1.get("playerId")).toBe("p9");
    expect(p1.has("token")).toBe(false);
    // URL 인코딩이 적용되어 원시 공백/앰퍼샌드가 그대로 나타나지 않는다.
    expect(s1).toContain("roomId=r");
    expect(s1).not.toContain("token=t&k");

    // playerId 없음 → hostPlayerId 사용.
    const s2 = buildCharacterSearch({ roomId: "r1", hostPlayerId: "h1", playerId: "", token: "" });
    const p2 = new URLSearchParams(s2.replace(/^\?/, ""));
    expect(p2.get("playerId")).toBe("h1");
    // token 비면 생략.
    expect(p2.has("token")).toBe(false);
  });

  it("보안: character URL에는 token/ticket bearer 값을 싣지 않는다", () => {
    const search = buildCharacterSearch({
      roomId: "r1",
      hostPlayerId: "h1",
      playerId: "p1",
      token: "secret",
      ticket: "ticket-1",
    });
    const params = new URLSearchParams(search.replace(/^\?/, ""));

    expect(params.get("roomId")).toBe("r1");
    expect(params.get("playerId")).toBe("p1");
    expect(params.has("token")).toBe(false);
    expect(params.has("ticket")).toBe(false);
    expect(search).not.toContain("secret");
    expect(search).not.toContain("ticket-1");
  });

  it("buildCharacterSearch: 연결 티켓(ticket)은 URL에서 제외한다", () => {
    // ticket 없음 → 생략.
    const s0 = buildCharacterSearch({ roomId: "r1", hostPlayerId: "h1", playerId: "p1", token: "t" });
    expect(new URLSearchParams(s0.replace(/^\?/, "")).has("ticket")).toBe(false);
    // ticket 있음 → URL에 포함하지 않음.
    const s1 = buildCharacterSearch({
      roomId: "r1",
      hostPlayerId: "h1",
      playerId: "p1",
      token: "t",
      ticket: "tk&9",
    });
    const p1 = new URLSearchParams(s1.replace(/^\?/, ""));
    expect(p1.has("ticket")).toBe(false);
    expect(s1).not.toContain("tk&9");
  });

  it("buildCharacterSearch 속성: playerId 효과·token/ticket 제외·라운드트립", () => {
    const idGen = fc.string({ minLength: 1 }).filter((s) => s.trim().length >= 1);
    const optGen = fc.oneof(fc.constant(""), fc.string());
    fc.assert(
      fc.property(idGen, optGen, idGen, optGen, optGen, (roomId, hostPlayerId, playerIdOr, token, ticket) => {
        const playerId = playerIdOr; // 비어있지 않음
        const handoff = { roomId, hostPlayerId, playerId, token, ticket };
        const search = buildCharacterSearch(handoff);
        const params = new URLSearchParams(search.replace(/^\?/, ""));
        expect(params.get("roomId")).toBe(roomId.trim());
        expect(params.get("playerId")).toBe(playerId.trim()); // playerId 우선
        expect(params.has("token")).toBe(false);
        expect(params.has("ticket")).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("eventToAction: character_setup → CHARACTER_SETUP", () => {
    expect(eventToAction({ type: "character_setup" })).toEqual({ type: "CHARACTER_SETUP" });
    // 다른 매핑은 영향 없음(샘플 확인).
    expect(eventToAction({ type: "connection-open" })).toEqual({ type: "CONNECTION_OPENED" });
    expect(eventToAction({ type: "chat_message" })).toBeNull();
  });

  it("reduce: CHARACTER_SETUP은 characterSetupDone를 정확히 1회 true로 만든다", () => {
    const handoff = { roomId: "r1", hostPlayerId: "h1", playerId: "", token: "" };
    const init = createInitialState(handoff);
    expect(init.characterSetupDone).toBe(false);

    const after1 = reduce(init, { type: "CHARACTER_SETUP" });
    expect(after1).not.toBe(init);
    expect(after1.characterSetupDone).toBe(true);

    // 반복 수신은 무변화(동일 참조).
    const after2 = reduce(after1, { type: "CHARACTER_SETUP" });
    expect(after2).toBe(after1);
    expect(after2.characterSetupDone).toBe(true);
  });

  it("reduce 속성: 여러 번 CHARACTER_SETUP을 받아도 1회만 전이한다", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), (n) => {
        let state = createInitialState({ roomId: "r1", hostPlayerId: "h1", playerId: "p1", token: "t" });
        let transitions = 0;
        for (let i = 0; i < n; i++) {
          const prev = state;
          state = reduce(prev, { type: "CHARACTER_SETUP" });
          if (state !== prev) transitions += 1;
        }
        expect(transitions).toBe(1);
        expect(state.characterSetupDone).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
