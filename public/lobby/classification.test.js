// @ts-nocheck
/**
 * Property-based tests for Room_Lobby_App outcome classification.
 * Feature: room-lobby
 *
 * Covers:
 * - Property 4: 요청 결과는 오류 종류로 정확히 환원된다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { classifyOutcome, ErrorKind } from "./logic.js";

// 결과 생성기: 2xx 성공 / 404 / 임의 4xx(404 제외) / 임의 5xx / 기타 비-2xx / network / timeout.
const outcomeGen = fc.oneof(
  // 2xx 성공 (200/201 포함, ok=true).
  fc.integer({ min: 200, max: 299 }).map((status) => ({
    outcome: { kind: "response", response: { ok: true, status } },
    expected: "success",
  })),
  // HTTP 404 → notfound.
  fc.constant({
    outcome: { kind: "response", response: { ok: false, status: 404 } },
    expected: ErrorKind.NOTFOUND,
  }),
  // 임의 4xx(404 제외) → unknown → server(보수적).
  fc
    .integer({ min: 400, max: 499 })
    .filter((s) => s !== 404)
    .map((status) => ({
      outcome: { kind: "response", response: { ok: false, status } },
      expected: ErrorKind.SERVER,
    })),
  // 임의 5xx → server.
  fc.integer({ min: 500, max: 599 }).map((status) => ({
    outcome: { kind: "response", response: { ok: false, status } },
    expected: ErrorKind.SERVER,
  })),
  // 기타 비-2xx(1xx/3xx) → unknown → server(보수적).
  fc
    .oneof(fc.integer({ min: 100, max: 199 }), fc.integer({ min: 300, max: 399 }))
    .map((status) => ({
      outcome: { kind: "response", response: { ok: false, status } },
      expected: ErrorKind.SERVER,
    })),
  // 네트워크 실패 → network.
  fc.constant({ outcome: { kind: "network" }, expected: ErrorKind.NETWORK }),
  // 클라이언트 타임아웃 → timeout.
  fc.constant({ outcome: { kind: "timeout" }, expected: ErrorKind.TIMEOUT }),
);

describe("room-lobby property tests — outcome classification", () => {
  it("Property 4: 요청 결과는 오류 종류로 정확히 환원된다", () => {
    // Feature: room-lobby, Property 4: 요청 결과는 오류 종류로 정확히 환원된다
    fc.assert(
      fc.property(outcomeGen, ({ outcome, expected }) => {
        expect(classifyOutcome(outcome)).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });
});
