// @ts-nocheck
/**
 * Property-based tests for Character_Sheet_App outcome classification.
 * Feature: character-sheet
 *
 * Covers:
 * - Property 4: 요청 결과는 오류 종류로 정확히 환원된다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { classifyOutcome, ErrorKind } from "./logic.js";

// 결과 생성기: 2xx 성공 / HTTP 401·403 / 임의 5xx / network / timeout.
const outcomeGen = fc.oneof(
  // 2xx 성공(ok=true) → "success".
  fc.integer({ min: 200, max: 299 }).map((status) => ({
    outcome: { kind: "response", response: { ok: true, status } },
    expected: "success",
  })),
  // HTTP 401 / 403 → auth.
  fc.constantFrom(401, 403).map((status) => ({
    outcome: { kind: "response", response: { ok: false, status } },
    expected: ErrorKind.AUTH,
  })),
  // 임의 5xx → server.
  fc.integer({ min: 500, max: 599 }).map((status) => ({
    outcome: { kind: "response", response: { ok: false, status } },
    expected: ErrorKind.SERVER,
  })),
  // 네트워크 실패 → network.
  fc.constant({ outcome: { kind: "network" }, expected: ErrorKind.NETWORK }),
  // 클라이언트 타임아웃 → timeout.
  fc.constant({ outcome: { kind: "timeout" }, expected: ErrorKind.TIMEOUT }),
);

describe("character-sheet property tests — outcome classification", () => {
  it("Property 4: 요청 결과는 오류 종류로 정확히 환원된다", () => {
    // Feature: character-sheet, Property 4: 요청 결과는 오류 종류로 정확히 환원된다
    fc.assert(
      fc.property(outcomeGen, ({ outcome, expected }) => {
        expect(classifyOutcome(outcome)).toBe(expected);
      }),
      { numRuns: 100 },
    );

    // 네 오류 종류(network/timeout/auth/server)가 서로 구별되는 값임을 확인한다.
    const kinds = [
      classifyOutcome({ kind: "network" }),
      classifyOutcome({ kind: "timeout" }),
      classifyOutcome({ kind: "response", response: { ok: false, status: 401 } }),
      classifyOutcome({ kind: "response", response: { ok: false, status: 500 } }),
    ];
    expect(new Set(kinds).size).toBe(4);
    expect(kinds).toEqual([
      ErrorKind.NETWORK,
      ErrorKind.TIMEOUT,
      ErrorKind.AUTH,
      ErrorKind.SERVER,
    ]);
  });
});
