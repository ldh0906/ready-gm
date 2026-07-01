import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { resolveCheck, DIFFICULTY_TARGET, chooseAdvantageRoll } from "./ezfudge.js";
import type { DifficultyGrade, OutcomeGrade } from "./types.js";

/**
 * Property-based test for the EZFudge resolver.
 * Feature: trpg-session-engine
 */

const GRADES: OutcomeGrade[] = ["Failure", "Partial Success", "Success", "Critical Success"];

/** Rank of an outcome grade (higher = better) for monotonicity checks. */
function rank(outcome: OutcomeGrade): number {
  return GRADES.indexOf(outcome);
}

/** Difficulties ordered easiest → hardest by their target offset. */
const DIFFICULTIES_BY_HARDNESS: DifficultyGrade[] = (
  ["Trivial", "Easy", "Average", "Hard", "Formidable"] as DifficultyGrade[]
).sort((a, b) => DIFFICULTY_TARGET[a] - DIFFICULTY_TARGET[b]);

describe("EZFudge resolver — property tests", () => {
  it("Property 23: EZFudge mapping is total and consistent", () => {
    // Feature: trpg-session-engine, Property 23: EZFudge mapping is total and consistent
    const attribute = fc.integer({ min: -10, max: 10 });
    const roll = fc.integer({ min: -8, max: 8 });
    const difficulty = fc.constantFrom<DifficultyGrade>(...DIFFICULTIES_BY_HARDNESS);

    // Totality: every input yields exactly one of the four known grades.
    fc.assert(
      fc.property(attribute, difficulty, roll, (a, d, r) => {
        const outcome = resolveCheck(a, d, r);
        expect(GRADES).toContain(outcome);
      }),
      { numRuns: 100 },
    );

    // Monotonic in roll: raising the roll never lowers the grade.
    fc.assert(
      fc.property(attribute, difficulty, roll, fc.integer({ min: 0, max: 8 }), (a, d, r, bump) => {
        expect(rank(resolveCheck(a, d, r + bump))).toBeGreaterThanOrEqual(rank(resolveCheck(a, d, r)));
      }),
      { numRuns: 100 },
    );

    // Monotonic in attribute: raising the attribute never lowers the grade.
    fc.assert(
      fc.property(attribute, difficulty, roll, fc.integer({ min: 0, max: 8 }), (a, d, r, bump) => {
        expect(rank(resolveCheck(a + bump, d, r))).toBeGreaterThanOrEqual(rank(resolveCheck(a, d, r)));
      }),
      { numRuns: 100 },
    );

    // Anti-monotonic in difficulty: raising difficulty never raises the grade.
    fc.assert(
      fc.property(
        attribute,
        roll,
        fc.integer({ min: 0, max: DIFFICULTIES_BY_HARDNESS.length - 1 }),
        fc.integer({ min: 0, max: DIFFICULTIES_BY_HARDNESS.length - 1 }),
        (a, r, i, j) => {
          const easier = DIFFICULTIES_BY_HARDNESS[Math.min(i, j)];
          const harder = DIFFICULTIES_BY_HARDNESS[Math.max(i, j)];
          expect(rank(resolveCheck(a, harder, r))).toBeLessThanOrEqual(rank(resolveCheck(a, easier, r)));
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("chooseAdvantageRoll — property tests", () => {
  // Feature: ezfudge-advantage
  it("Property: advantage===max, disadvantage===min, none===first", () => {
    const rolls = fc.array(fc.integer({ min: -8, max: 8 }), { minLength: 1, maxLength: 6 });
    fc.assert(
      fc.property(rolls, (xs) => {
        expect(chooseAdvantageRoll(xs, "advantage")).toBe(Math.max(...xs));
        expect(chooseAdvantageRoll(xs, "disadvantage")).toBe(Math.min(...xs));
        expect(chooseAdvantageRoll(xs, "none")).toBe(xs[0]);
      }),
      { numRuns: 100 },
    );
  });

  it("Property: a single-element array returns that element for every mode", () => {
    // Feature: ezfudge-advantage
    fc.assert(
      fc.property(fc.integer({ min: -8, max: 8 }), (n) => {
        expect(chooseAdvantageRoll([n], "none")).toBe(n);
        expect(chooseAdvantageRoll([n], "advantage")).toBe(n);
        expect(chooseAdvantageRoll([n], "disadvantage")).toBe(n);
      }),
      { numRuns: 100 },
    );
  });

  it("throws on an empty rolls array", () => {
    expect(() => chooseAdvantageRoll([], "none")).toThrow(RangeError);
  });
});
