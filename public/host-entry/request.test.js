// @ts-nocheck
/**
 * Property-based tests for Host_Entry_App request building.
 * Feature: frontend-applications
 *
 * Covers:
 * - Property 3: 접근 토큰과 요청 헤더는 동치다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildCreateRoomRequest } from "./logic.js";

// 빈 문자열(토큰 없음) + 임의의 비공백/비어있지 않은 문자열(토큰 있음).
const tokenGen = fc.oneof(fc.constant(""), fc.string({ minLength: 1 }));
const trimmedName = fc.string({ minLength: 1 });

describe("frontend-applications property tests — request building", () => {
  it("Property 3: 접근 토큰과 요청 헤더는 동치다", () => {
    // Feature: frontend-applications, Property 3: 접근 토큰과 요청 헤더는 동치다
    fc.assert(
      fc.property(trimmedName, tokenGen, (name, tok) => {
        const req = buildCreateRoomRequest(name, tok);

        // content-type 헤더는 항상 존재한다.
        expect(req.headers["content-type"]).toBe("application/json");

        if (tok.length > 0) {
          // 토큰이 비어있지 않으면 x-playtest-token 헤더에 그 값을 그대로 포함한다.
          expect("x-playtest-token" in req.headers).toBe(true);
          expect(req.headers["x-playtest-token"]).toBe(tok);
        } else {
          // 토큰이 비어있으면 헤더 자체가 존재하지 않는다.
          expect("x-playtest-token" in req.headers).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});
