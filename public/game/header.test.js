// @ts-nocheck
/**
 * Property-based tests for Game_Play_App header view model
 * (ready count + ready-check countdown).
 * Feature: game-play
 *
 * Covers:
 * - Property 6: 준비 수는 readiness에서 정확히 도출된다
 * - Property 7: 준비 체크 카운트다운 잔여 시간
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeReadyCount, computeCountdownMs } from "./logic.js";

const readinessEntryGen = fc.record({
  playerId: fc.string(),
  status: fc.constantFrom("ready", "not_ready"),
  actionKind: fc.oneof(fc.constant(null), fc.string()),
  actionText: fc.oneof(fc.constant(null), fc.string()),
});

describe("game-play property tests — header", () => {
  it("Property 6: 준비 수는 readiness에서 정확히 도출된다", () => {
    // Feature: game-play, Property 6: 준비 수는 readiness에서 정확히 도출된다
    const readinessGen = fc.array(readinessEntryGen, { minLength: 0, maxLength: 30 });
    fc.assert(
      fc.property(readinessGen, (readiness) => {
        const { ready, total } = computeReadyCount(readiness);
        const expectedReady = readiness.filter((r) => r.status === "ready").length;

        expect(ready).toBe(expectedReady);
        expect(total).toBe(readiness.length);
        // 항상 0 <= ready <= total.
        expect(ready).toBeGreaterThanOrEqual(0);
        expect(ready).toBeLessThanOrEqual(total);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 7: 준비 체크 카운트다운 잔여 시간", () => {
    // Feature: game-play, Property 7: 준비 체크 카운트다운 잔여 시간
    const nowGen = fc.integer({ min: 0, max: 4_000_000_000_000 });
    // null, 무효 문자열, 과거·현재·미래 ISO 시각.
    const deadlineGen = fc.oneof(
      fc.constant(null),
      fc.constant("not-a-date"),
      fc.constant(""),
      fc.integer({ min: 0, max: 4_000_000_000_000 }).map((ms) => new Date(ms).toISOString()),
    );

    fc.assert(
      fc.property(deadlineGen, nowGen, (deadlineIso, now) => {
        const result = computeCountdownMs(deadlineIso, now);

        const parsed = deadlineIso == null ? NaN : Date.parse(deadlineIso);
        if (deadlineIso == null || Number.isNaN(parsed)) {
          expect(result).toBeNull();
        } else {
          const expected = Math.max(0, parsed - now);
          expect(result).toBe(expected);
          // 항상 0 이상이며, 마감이 now 이하이면 정확히 0.
          expect(result).toBeGreaterThanOrEqual(0);
          if (parsed <= now) {
            expect(result).toBe(0);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
