// @ts-nocheck
/**
 * Property-based test for Character_Sheet_App ladder rung label mapping.
 * Feature: character-sheet
 *
 * Covers:
 * - Property 9: Trait_Level → Ladder_Rung_Label 매핑
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { rungLabel, DEFAULT_RUNG_LABELS } from "./logic.js";

// 기본 Attribute_Ladder [-2, +4]. 이 사다리에서는 DEFAULT_RUNG_LABELS 고정 매핑을 쓴다. (요구사항 2.5)
const DEFAULT_LADDER = { min: -2, max: 4 };

// 기본 사다리의 모든 Trait_Level(-2..+4) 생성기.
const defaultLevelGen = fc.integer({ min: -2, max: 4 });

// 비기본 정수 Trait_Ladder 생성기(기본 [-2,4]와 다르도록 보장).
const nonDefaultLadderGen = fc
  .tuple(fc.integer({ min: -10, max: 10 }), fc.integer({ min: 0, max: 12 }))
  .map(([min, span]) => ({ min, max: min + span }))
  .filter((l) => !(l.min === DEFAULT_LADDER.min && l.max === DEFAULT_LADDER.max));

describe("character-sheet property tests — Ladder_Rung_Label 매핑", () => {
  it("Property 9: Trait_Level → Ladder_Rung_Label 매핑", () => {
    // Feature: character-sheet, Property 9: Trait_Level → Ladder_Rung_Label 매핑
    fc.assert(
      fc.property(
        fc.oneof(
          // 기본 사다리: 고정 매핑(-2=끔찍함 … +4=탁월함)을 반환해야 한다. (요구사항 2.5)
          defaultLevelGen.map((level) => ({
            category: "default",
            level,
            trait: { key: "Might", label: "힘", sectionId: "attributes", ladder: { ...DEFAULT_LADDER } },
          })),
          // 비기본 사다리: 스키마가 제공한 등급 레이블을 반환해야 한다. (요구사항 2.5)
          nonDefaultLadderGen.chain((ladder) =>
            fc.integer({ min: ladder.min, max: ladder.max }).map((level) => {
              // 사다리 범위 전체에 대해 고유한 등급 레이블을 제공한다.
              const rungLabels = {};
              for (let l = ladder.min; l <= ladder.max; l += 1) {
                rungLabels[String(l)] = "등급 " + l;
              }
              return {
                category: "custom",
                level,
                trait: { key: "Custom", label: "맞춤", sectionId: "attributes", ladder, rungLabels },
                expected: rungLabels[String(level)],
              };
            }),
          ),
        ),
        (sample) => {
          const label = rungLabel(sample.level, sample.trait);
          if (sample.category === "default") {
            // 기본 사다리에서는 DEFAULT_RUNG_LABELS 고정 매핑을 반환한다.
            expect(label).toBe(DEFAULT_RUNG_LABELS[String(sample.level)]);
          } else {
            // 비기본 사다리에서는 스키마 제공 레이블을 반환한다.
            expect(label).toBe(sample.expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
