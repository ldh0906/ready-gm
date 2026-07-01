// @ts-nocheck
/**
 * Property-based tests for Host_Entry_App response classification.
 * Feature: frontend-applications
 *
 * Covers:
 * - Property 7: HTTP 응답 상태는 오류 종류로 정확히 분류된다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { classifyResponse } from "./logic.js";

// 비-2xx 상태 코드: 400, 임의 4xx, 임의 5xx, 기타 비-2xx(1xx/3xx).
const nonOkStatus = fc.oneof(
  fc.constant(400),
  fc.integer({ min: 401, max: 499 }),
  fc.integer({ min: 500, max: 599 }),
  fc.integer({ min: 100, max: 199 }),
  fc.integer({ min: 300, max: 399 }),
);

describe("frontend-applications property tests — response classification", () => {
  it("Property 7: HTTP 응답 상태는 오류 종류로 정확히 분류된다", () => {
    // Feature: frontend-applications, Property 7: HTTP 응답 상태는 오류 종류로 정확히 분류된다
    fc.assert(
      fc.property(nonOkStatus, (status) => {
        const result = classifyResponse({ ok: false, status });

        if (status === 400) {
          // 정확히 400이면 validation.
          expect(result).toBe("validation");
        } else if (status >= 500) {
          // 500 이상이면 server.
          expect(result).toBe("server");
        } else {
          // 그 외 비-2xx는 unknown으로 분류된다(400/5xx가 아님).
          expect(result).toBe("unknown");
        }
      }),
      { numRuns: 100 },
    );
  });
});
