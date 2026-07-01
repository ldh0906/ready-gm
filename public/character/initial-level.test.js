// @ts-nocheck
/**
 * Property-based tests for Character_Sheet_App 초기 Trait_Level.
 * Feature: character-sheet
 *
 * Covers:
 * - Property 8: 초기 Trait_Level
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { initialLevel } from "./logic.js";

describe("character-sheet property tests — 초기 Trait_Level", () => {
  it("Property 8: 초기 Trait_Level", () => {
    // Feature: character-sheet, Property 8: 초기 Trait_Level
    // 0을 포함/불포함하는 임의 정수 구간 [min,max](min ≤ max)에 대해, initialLevel은
    // 0이 사다리 안이면 0을, 아니면 사다리의 최소 정수(min)를 반환한다. (요구사항 2.3)

    // 임의 정수 구간 [min, max] (min ≤ max) 생성기.
    // 두 정수를 뽑아 정렬해 항상 min ≤ max를 보장하고, 0을 포함하는 구간과
    // 0을 포함하지 않는 구간(양수만/음수만) 모두를 자연스럽게 포함한다.
    const ladderArb = fc
      .tuple(
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
      )
      .map(([a, b]) => (a <= b ? { min: a, max: b } : { min: b, max: a }));

    fc.assert(
      fc.property(ladderArb, (ladder) => {
        const result = initialLevel(ladder);
        const zeroInLadder = ladder.min <= 0 && 0 <= ladder.max;
        if (zeroInLadder) {
          expect(result).toBe(0);
        } else {
          expect(result).toBe(ladder.min);
        }
      }),
      { numRuns: 100 },
    );
  });
});
