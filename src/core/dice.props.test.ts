import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createDiceServiceFromSpec, specRange, type DiceSpec } from "./dice.js";

/**
 * Property-based test for the Dice Service distribution.
 * Feature: trpg-session-engine
 */

describe("Dice Service — distribution property tests", () => {
  it("Property 25: Dice are unbiased and follow the configured distribution", () => {
    // Feature: trpg-session-engine, Property 25: Dice are unbiased and follow the configured distribution

    // (a) Bounds/totality over random specs: every per-die face stays within its
    // configured band and the aggregate stays within the spec's output range.
    const specGen: fc.Arbitrary<DiceSpec> = fc
      .record({
        count: fc.integer({ min: 1, max: 3 }),
        lo: fc.integer({ min: -3, max: 0 }),
        span: fc.integer({ min: 0, max: 4 }),
      })
      .map(({ count, lo, span }) => ({ count, face: { min: lo, max: lo + span } }));

    fc.assert(
      fc.property(specGen, (spec) => {
        const dice = createDiceServiceFromSpec(spec);
        const range = specRange(spec);
        for (let i = 0; i < 200; i++) {
          const rec = dice.rollWithRecord();
          expect(rec.rawValues).toHaveLength(spec.count);
          for (const v of rec.rawValues) {
            expect(Number.isInteger(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(spec.face.min);
            expect(v).toBeLessThanOrEqual(spec.face.max);
          }
          expect(rec.value).toBe(rec.rawValues.reduce((s, v) => s + v, 0));
          expect(rec.value).toBeGreaterThanOrEqual(range.min);
          expect(rec.value).toBeLessThanOrEqual(range.max);
        }
      }),
      { numRuns: 100 },
    );

    // (b) Large-sample uniformity of a single die over its face range.
    {
      const face = { min: -2, max: 2 };
      const faces = face.max - face.min + 1;
      const N = 120000;
      const die = createDiceServiceFromSpec({ count: 1, face });
      const counts = new Map<number, number>();
      for (let i = 0; i < N; i++) {
        const v = die.roll();
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      const expected = N / faces;
      for (let f = face.min; f <= face.max; f++) {
        const c = counts.get(f) ?? 0;
        // Generous ±12% tolerance; with N this large a uniform die stays well inside.
        expect(c).toBeGreaterThan(expected * 0.88);
        expect(c).toBeLessThan(expected * 1.12);
      }
    }

    // (c) Large-sample shape of the default summed dice (2 × d[-2,2] over [-4,4]):
    // symmetric and centre-weighted — the centre is strictly more likely than the
    // extremes.
    {
      const spec: DiceSpec = { count: 2, face: { min: -2, max: 2 } };
      const N = 200000;
      const dice = createDiceServiceFromSpec(spec);
      const counts = new Map<number, number>();
      for (let i = 0; i < N; i++) {
        const v = dice.roll();
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      const centre = counts.get(0) ?? 0;
      const low = counts.get(-4) ?? 0;
      const high = counts.get(4) ?? 0;
      // The centre dominates both extremes (triangular distribution).
      expect(centre).toBeGreaterThan(low * 2);
      expect(centre).toBeGreaterThan(high * 2);
      // Roughly symmetric around 0.
      expect(Math.abs(low - high)).toBeLessThan(N * 0.02);
    }
  });
});
