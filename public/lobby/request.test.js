// @ts-nocheck
/**
 * Property-based tests for Room_Lobby_App REST request building.
 * Feature: room-lobby
 *
 * Covers:
 * - Property 2: 접근 토큰과 요청 헤더는 동치다
 * - Property 3: REST 요청 명세는 올바른 URL과 메서드를 만든다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  buildInviteRequest,
  buildRoomResolveRequest,
  buildScenariosRequest,
} from "./logic.js";

// 빈 문자열(토큰 없음) + 임의의 비어있지 않은 문자열(특수문자 포함, 토큰 있음).
const tokenGen = fc.oneof(fc.constant(""), fc.string({ minLength: 1 }));
const roomIdGen = fc.string();
const inviteTokenGen = fc.string();

describe("room-lobby property tests — request building", () => {
  it("Property 2: 접근 토큰과 요청 헤더는 동치다", () => {
    // Feature: room-lobby, Property 2: 접근 토큰과 요청 헤더는 동치다
    fc.assert(
      fc.property(roomIdGen, inviteTokenGen, tokenGen, (roomId, inviteToken, tok) => {
        const requests = [
          buildInviteRequest(roomId, tok),
          buildRoomResolveRequest(inviteToken, tok),
          buildScenariosRequest(tok),
        ];
        for (const req of requests) {
          if (tok.length > 0) {
            // 토큰이 비어있지 않으면 x-playtest-token에 값이 한 글자도 변형 없이 들어간다.
            expect("x-playtest-token" in req.headers).toBe(true);
            expect(req.headers["x-playtest-token"]).toBe(tok);
          } else {
            // 토큰이 비어있으면 헤더 자체가 존재하지 않는다.
            expect("x-playtest-token" in req.headers).toBe(false);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("Property 3: REST 요청 명세는 올바른 URL과 메서드를 만든다", () => {
    // Feature: room-lobby, Property 3: REST 요청 명세는 올바른 URL과 메서드를 만든다
    fc.assert(
      fc.property(roomIdGen, inviteTokenGen, tokenGen, (roomId, inviteToken, tok) => {
        const invite = buildInviteRequest(roomId, tok);
        expect(invite.method).toBe("GET");
        expect(invite.url).toBe("/rooms/" + encodeURIComponent(roomId) + "/invite");

        const resolve = buildRoomResolveRequest(inviteToken, tok);
        expect(resolve.method).toBe("GET");
        expect(resolve.url).toBe("/rooms/" + encodeURIComponent(inviteToken));

        const scenarios = buildScenariosRequest(tok);
        expect(scenarios.method).toBe("GET");
        expect(scenarios.url).toBe("/scenarios");
      }),
      { numRuns: 100 },
    );
  });
});
