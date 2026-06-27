import { describe, it, expect } from "vitest";
import {
  createDiceService,
  createDiceServiceFromSpec,
  createReplaySeedSource,
  createReplayDiceService,
  createReplayDiceServiceFromSpec,
  createFixedSeedDiceService,
  createFixedSeedDiceServiceFromSpec,
  fixedSeedSource,
  DiceRollError,
  SeedExhaustedError,
  rollFromSeed,
  rollSpecFromSeed,
  specRange,
  type DiceSpec,
} from "./dice.js";
import { DEFAULT_DICE_RANGE, DEFAULT_DICE_SPEC } from "./config.js";
import { InMemoryEventSink } from "../observability/index.js";
import type { DiceRollEvent } from "../observability/index.js";

describe("createDiceService", () => {
  it("rolls within the inclusive configured range", () => {
    const dice = createDiceService(DEFAULT_DICE_RANGE);
    for (let i = 0; i < 1000; i++) {
      const value = dice.roll();
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(DEFAULT_DICE_RANGE.min);
      expect(value).toBeLessThanOrEqual(DEFAULT_DICE_RANGE.max);
    }
  });

  it("can produce both the min and max bounds (inclusive)", () => {
    // Deterministic sources pinned to each end prove the band is inclusive.
    const atMin = createDiceService({ min: -4, max: 4 }, () => -4);
    const atMax = createDiceService({ min: -4, max: 4 }, (_min, maxExclusive) => maxExclusive - 1);
    expect(atMin.roll()).toBe(-4);
    expect(atMax.roll()).toBe(4);
  });

  it("passes a half-open interval to the source so max stays inclusive", () => {
    const calls: Array<[number, number]> = [];
    const dice = createDiceService({ min: -4, max: 4 }, (min, maxExclusive) => {
      calls.push([min, maxExclusive]);
      return min;
    });
    dice.roll();
    expect(calls).toEqual([[-4, 5]]);
  });

  it("supports a single-value (min === max) range", () => {
    const dice = createDiceService({ min: 3, max: 3 });
    expect(dice.roll()).toBe(3);
  });

  it("exposes a frozen copy of the range that ignores later mutation", () => {
    const range = { min: -4, max: 4 };
    const dice = createDiceService(range);
    range.min = 100;
    expect(dice.range.min).toBe(-4);
  });

  it("rejects invalid ranges", () => {
    expect(() => createDiceService({ min: 5, max: 1 })).toThrow(RangeError);
    expect(() => createDiceService({ min: 0.5, max: 4 })).toThrow(RangeError);
  });

  describe("failure path (Requirement 17.3)", () => {
    it("roll() throws a DiceRollError when the source fails", () => {
      const dice = createDiceService(DEFAULT_DICE_RANGE, () => {
        throw new Error("entropy pool exhausted");
      });
      expect(() => dice.roll()).toThrow(DiceRollError);
    });

    it("tryRoll() reports failure instead of throwing", () => {
      const dice = createDiceService(DEFAULT_DICE_RANGE, () => {
        throw new Error("entropy pool exhausted");
      });
      const result = dice.tryRoll();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(DiceRollError);
        expect(result.error.cause).toBeInstanceOf(Error);
      }
    });

    it("tryRoll() returns the value on success", () => {
      const dice = createDiceService({ min: -4, max: 4 }, () => 2);
      expect(dice.tryRoll()).toEqual({ ok: true, value: 2 });
    });

    it("treats an out-of-range source value as a failure", () => {
      const dice = createDiceService({ min: -4, max: 4 }, () => 99);
      expect(() => dice.roll()).toThrow(DiceRollError);
      expect(dice.tryRoll().ok).toBe(false);
    });
  });
});

describe("seeded PRNG reproducibility (Requirement 18.3)", () => {
  it("rollFromSeed is deterministic: same seed + range yields the same value", () => {
    for (const seed of [0, 1, 42, 123456, 0xdeadbeef]) {
      const a = rollFromSeed(seed, DEFAULT_DICE_RANGE);
      const b = rollFromSeed(seed, DEFAULT_DICE_RANGE);
      expect(a).toBe(b);
    }
  });

  it("rollFromSeed stays within the inclusive range", () => {
    for (let seed = 0; seed < 2000; seed++) {
      const v = rollFromSeed(seed, DEFAULT_DICE_RANGE);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(DEFAULT_DICE_RANGE.min);
      expect(v).toBeLessThanOrEqual(DEFAULT_DICE_RANGE.max);
    }
  });

  it("records the seed used, and replaying it reproduces the value", () => {
    // Pin the seed source so we know exactly which seed was recorded.
    const dice = createDiceService(DEFAULT_DICE_RANGE, undefined, {
      seedSource: () => 987654,
    });
    const record = dice.rollWithRecord();
    expect(record.seed).toBe(987654);
    expect(record.range).toEqual(DEFAULT_DICE_RANGE);
    // Replay deterministically from the recorded seed.
    expect(rollFromSeed(record.seed as number, record.range)).toBe(record.value);
  });

  it("the default (CSPRNG-seeded) service records a numeric seed for replay", () => {
    const dice = createDiceService(DEFAULT_DICE_RANGE);
    const record = dice.rollWithRecord();
    expect(typeof record.seed).toBe("number");
    expect(rollFromSeed(record.seed as number, record.range)).toBe(record.value);
  });

  it("an injected source produces a value but records no recoverable seed", () => {
    const dice = createDiceService({ min: -4, max: 4 }, () => 2);
    const record = dice.rollWithRecord();
    expect(record.value).toBe(2);
    expect(record.seed).toBeNull();
  });
});

describe("seeded PRNG uniformity (Requirement 11.6)", () => {
  it("covers every in-range value with a roughly uniform spread over many seeds", () => {
    const range = { min: -4, max: 4 };
    const span = range.max - range.min + 1;
    const counts = new Map<number, number>();
    const draws = 90000;
    for (let seed = 0; seed < draws; seed++) {
      const v = rollFromSeed(seed, range);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    // Every outcome must appear.
    for (let v = range.min; v <= range.max; v++) {
      expect(counts.get(v) ?? 0).toBeGreaterThan(0);
    }
    // Each bucket should be within ~15% of the expected uniform frequency.
    const expected = draws / span;
    for (let v = range.min; v <= range.max; v++) {
      const c = counts.get(v) ?? 0;
      expect(Math.abs(c - expected) / expected).toBeLessThan(0.15);
    }
  });
});

describe("dice_roll event emission (Requirement 18.3)", () => {
  it("emits a best-effort dice_roll event carrying the recorded seed when a sink is provided", async () => {
    const sink = new InMemoryEventSink();
    const dice = createDiceService(DEFAULT_DICE_RANGE, undefined, {
      sink,
      correlation: { sessionId: "room-7", roundNo: 4, roller: "resolver" },
      seedSource: () => 555,
    });

    const record = dice.roll();
    await sink.flush();

    const events = sink.queryByRound("room-7", 4);
    expect(events).toHaveLength(1);
    const e = events[0] as DiceRollEvent;
    expect(e.eventType).toBe("dice_roll");
    expect(e.sessionId).toBe("room-7");
    expect(e.roundNo).toBe(4);
    expect(e.roller).toBe("resolver");
    expect(e.seed).toBe(555);
    expect(e.result).toBe(record);
    expect(e.rawValues).toEqual([record]);
    expect(e.range).toEqual({ min: DEFAULT_DICE_RANGE.min, max: DEFAULT_DICE_RANGE.max });
    expect(e.expression).toBe(`uniform[${DEFAULT_DICE_RANGE.min},${DEFAULT_DICE_RANGE.max}]`);
  });

  it("does not emit when the roll fails, and still surfaces the failure", async () => {
    const sink = new InMemoryEventSink();
    const dice = createDiceService(DEFAULT_DICE_RANGE, () => {
      throw new Error("entropy pool exhausted");
    }, {
      sink,
      correlation: { sessionId: "room-8", roundNo: 1 },
    });
    expect(() => dice.roll()).toThrow(DiceRollError);
    await sink.flush();
    expect(sink.queryBySession("room-8")).toHaveLength(0);
  });

  it("a throwing sink never affects the returned roll value", () => {
    const throwingSink = {
      emit() {
        throw new Error("sink down");
      },
    };
    const dice = createDiceService(DEFAULT_DICE_RANGE, undefined, {
      sink: throwingSink,
      correlation: { sessionId: "room-9", roundNo: 1 },
      seedSource: () => 123,
    });
    const value = dice.roll();
    expect(value).toBe(rollFromSeed(123, DEFAULT_DICE_RANGE));
  });
});

describe("deterministic seed-injection / replay mode (Requirements 11.2, 11.6, 18.3)", () => {
  describe("createReplaySeedSource", () => {
    it("yields the recorded seeds in order", () => {
      const next = createReplaySeedSource([10, 20, 30]);
      expect(next()).toBe(10);
      expect(next()).toBe(20);
      expect(next()).toBe(30);
    });

    it("surfaces a deterministic SeedExhaustedError when seeds run out (no CSPRNG fallback)", () => {
      const next = createReplaySeedSource([7]);
      expect(next()).toBe(7);
      try {
        next();
        throw new Error("expected SeedExhaustedError");
      } catch (err) {
        expect(err).toBeInstanceOf(SeedExhaustedError);
        const e = err as SeedExhaustedError;
        expect(e.recordedCount).toBe(1);
        expect(e.requestedIndex).toBe(1);
      }
    });

    it("throws immediately for an empty recorded sequence", () => {
      const next = createReplaySeedSource([]);
      expect(() => next()).toThrow(SeedExhaustedError);
    });

    it("copies the seed array so later mutation cannot change replay output", () => {
      const seeds = [1, 2, 3];
      const next = createReplaySeedSource(seeds);
      seeds[0] = 999;
      seeds.length = 0;
      expect(next()).toBe(1);
      expect(next()).toBe(2);
      expect(next()).toBe(3);
    });
  });

  describe("createReplayDiceService", () => {
    it("reproduces the exact value sequence from a recorded seed sequence", () => {
      const range = DEFAULT_DICE_RANGE;
      // Record a sequence of seeds (as a prior CSPRNG-seeded session would have).
      const seeds = [987654, 1, 0xdeadbeef, 42, 123456];
      const expected = seeds.map((s) => rollFromSeed(s, range));

      const dice = createReplayDiceService(range, seeds);
      const replayed = seeds.map(() => dice.roll());
      expect(replayed).toEqual(expected);
    });

    it("records each replayed seed so the record matches the recording", () => {
      const seeds = [555, 777];
      const dice = createReplayDiceService(DEFAULT_DICE_RANGE, seeds);
      const first = dice.rollWithRecord();
      const second = dice.rollWithRecord();
      expect(first.seed).toBe(555);
      expect(second.seed).toBe(777);
      expect(first.value).toBe(rollFromSeed(555, DEFAULT_DICE_RANGE));
      expect(second.value).toBe(rollFromSeed(777, DEFAULT_DICE_RANGE));
    });

    it("two replay services over the same recording produce identical sequences", () => {
      const seeds = [11, 22, 33, 44];
      const a = createReplayDiceService(DEFAULT_DICE_RANGE, seeds);
      const b = createReplayDiceService(DEFAULT_DICE_RANGE, seeds);
      const seqA = seeds.map(() => a.roll());
      const seqB = seeds.map(() => b.roll());
      expect(seqA).toEqual(seqB);
    });

    it("turns exhaustion into a DiceRollError on roll() (deterministic miss, no fallback)", () => {
      const dice = createReplayDiceService(DEFAULT_DICE_RANGE, [123]);
      expect(dice.roll()).toBe(rollFromSeed(123, DEFAULT_DICE_RANGE));
      try {
        dice.roll();
        throw new Error("expected DiceRollError");
      } catch (err) {
        expect(err).toBeInstanceOf(DiceRollError);
        expect((err as DiceRollError).cause).toBeInstanceOf(SeedExhaustedError);
      }
    });

    it("tryRoll() reports failure on exhaustion instead of silently rolling fresh entropy", () => {
      const dice = createReplayDiceService(DEFAULT_DICE_RANGE, [321]);
      const ok = dice.tryRoll();
      expect(ok).toEqual({ ok: true, value: rollFromSeed(321, DEFAULT_DICE_RANGE) });

      const exhausted = dice.tryRoll();
      expect(exhausted.ok).toBe(false);
      if (!exhausted.ok) {
        expect(exhausted.error).toBeInstanceOf(DiceRollError);
        expect(exhausted.error.cause).toBeInstanceOf(SeedExhaustedError);
      }
    });

    it("stays within the inclusive range for every replayed value", () => {
      const range = { min: -4, max: 4 };
      const seeds = Array.from({ length: 500 }, (_unused, i) => i * 2654435761);
      const dice = createReplayDiceService(range, seeds);
      for (const seed of seeds) {
        const v = dice.roll();
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(range.min);
        expect(v).toBeLessThanOrEqual(range.max);
        // And it matches the deterministic derivation for that seed.
        expect(v).toBe(rollFromSeed(seed, range));
      }
    });
  });

  describe("fixed-seed convenience", () => {
    it("fixedSeedSource always yields the same seed", () => {
      const next = fixedSeedSource(98765);
      expect(next()).toBe(98765);
      expect(next()).toBe(98765);
      expect(next()).toBe(98765);
    });

    it("createFixedSeedDiceService yields a constant value across many rolls", () => {
      const seed = 424242;
      const dice = createFixedSeedDiceService(DEFAULT_DICE_RANGE, seed);
      const expected = rollFromSeed(seed, DEFAULT_DICE_RANGE);
      for (let i = 0; i < 50; i++) {
        expect(dice.roll()).toBe(expected);
      }
    });

    it("createFixedSeedDiceService records the fixed seed on every roll", () => {
      const dice = createFixedSeedDiceService({ min: 1, max: 6 }, 999);
      const r1 = dice.rollWithRecord();
      const r2 = dice.rollWithRecord();
      expect(r1.seed).toBe(999);
      expect(r2.seed).toBe(999);
      expect(r1.value).toBe(r2.value);
    });
  });
});

describe("summed-dice (bell) distribution (Requirement 11.6)", () => {
  const BELL: DiceSpec = { count: 2, face: { min: -2, max: 2 } };

  it("specRange reports the aggregate output band", () => {
    expect(specRange(BELL)).toEqual({ min: -4, max: 4 });
    expect(specRange({ count: 1, face: { min: -4, max: 4 } })).toEqual({ min: -4, max: 4 });
    expect(specRange({ count: 4, face: { min: -1, max: 1 } })).toEqual({ min: -4, max: 4 });
  });

  it("the default engine dice spec is the [-4,+4] bell (two d[-2,2])", () => {
    expect(DEFAULT_DICE_SPEC).toEqual({ count: 2, face: { min: -2, max: 2 } });
    expect(specRange(DEFAULT_DICE_SPEC)).toEqual(DEFAULT_DICE_RANGE);
  });

  it("rollSpecFromSeed records each die and their sum, and is deterministic", () => {
    for (const seed of [0, 1, 42, 123456, 0xdeadbeef]) {
      const a = rollSpecFromSeed(seed, BELL);
      const b = rollSpecFromSeed(seed, BELL);
      expect(a).toEqual(b);
      expect(a.rawValues).toHaveLength(2);
      expect(a.rawValues.reduce((s, v) => s + v, 0)).toBe(a.total);
      for (const v of a.rawValues) {
        expect(v).toBeGreaterThanOrEqual(-2);
        expect(v).toBeLessThanOrEqual(2);
      }
      expect(a.total).toBeGreaterThanOrEqual(-4);
      expect(a.total).toBeLessThanOrEqual(4);
    }
  });

  it("concentrates mass at the centre and makes extremes rarer than uniform", () => {
    const counts = new Map<number, number>();
    const draws = 90000;
    for (let seed = 0; seed < draws; seed++) {
      const { total } = rollSpecFromSeed(seed, BELL);
      counts.set(total, (counts.get(total) ?? 0) + 1);
    }
    const freq = (v: number): number => (counts.get(v) ?? 0) / draws;
    // Every value in [-4,4] occurs.
    for (let v = -4; v <= 4; v++) expect(counts.get(v) ?? 0).toBeGreaterThan(0);
    // Triangular target: 0 -> 20%, ±4 -> 4%. Allow generous variance bounds.
    expect(freq(0)).toBeGreaterThan(0.17);
    expect(freq(0)).toBeLessThan(0.23);
    expect(freq(4)).toBeLessThan(0.06);
    expect(freq(-4)).toBeLessThan(0.06);
    // The centre is strictly more likely than either extreme.
    expect(freq(0)).toBeGreaterThan(freq(4));
    expect(freq(0)).toBeGreaterThan(freq(-4));
    // Symmetry: opposite ends are close in frequency.
    expect(Math.abs(freq(4) - freq(-4))).toBeLessThan(0.02);
  });

  it("createDiceServiceFromSpec rolls within the aggregate range and records per-die raws", () => {
    const dice = createDiceServiceFromSpec(BELL);
    for (let i = 0; i < 1000; i++) {
      const record = dice.rollWithRecord();
      expect(record.rawValues).toHaveLength(2);
      expect(record.value).toBe(record.rawValues[0]! + record.rawValues[1]!);
      expect(record.range).toEqual({ min: -4, max: 4 });
      expect(record.value).toBeGreaterThanOrEqual(-4);
      expect(record.value).toBeLessThanOrEqual(4);
    }
  });

  it("emits a sum() expression and the aggregate range for multi-die rolls", async () => {
    const sink = new InMemoryEventSink();
    const dice = createDiceServiceFromSpec(BELL, undefined, {
      sink,
      correlation: { sessionId: "room-b", roundNo: 1, roller: "resolver" },
      seedSource: () => 4242,
    });
    const record = dice.rollWithRecord();
    await sink.flush();
    const e = sink.queryByRound("room-b", 1)[0] as DiceRollEvent;
    expect(e.expression).toBe("sum(2d[-2,2])");
    expect(e.range).toEqual({ min: -4, max: 4 });
    expect(e.rawValues).toEqual(record.rawValues);
    expect(e.result).toBe(record.value);
    expect(e.seed).toBe(4242);
  });

  it("an injected source drives every die and is summed", () => {
    const dice = createDiceServiceFromSpec(BELL, () => 2); // each die = 2
    const record = dice.rollWithRecord();
    expect(record.rawValues).toEqual([2, 2]);
    expect(record.value).toBe(4);
    expect(record.seed).toBeNull();
  });

  it("treats an out-of-face die value as a failure", () => {
    const dice = createDiceServiceFromSpec(BELL, () => 3); // 3 is outside [-2,2]
    expect(() => dice.roll()).toThrow(DiceRollError);
    expect(dice.tryRoll().ok).toBe(false);
  });

  it("rejects an invalid dice count", () => {
    expect(() => createDiceServiceFromSpec({ count: 0, face: { min: -2, max: 2 } })).toThrow(RangeError);
    expect(() => createDiceServiceFromSpec({ count: 1.5, face: { min: -2, max: 2 } })).toThrow(RangeError);
  });

  it("createDiceService is the count=1 flat-uniform special case", () => {
    const dice = createDiceServiceFromSpec(
      { count: 1, face: { min: -4, max: 4 } },
      undefined,
      { seedSource: () => 987654 },
    );
    expect(dice.rollWithRecord().value).toBe(rollFromSeed(987654, { min: -4, max: 4 }));
  });
});

describe("spec-based replay / fixed-seed (Requirement 18.3)", () => {
  const BELL: DiceSpec = { count: 2, face: { min: -2, max: 2 } };

  it("replays a recorded seed sequence to reproduce the exact summed rolls", () => {
    const seeds = [11, 22, 33, 0xbeef, 7];
    const expected = seeds.map((s) => rollSpecFromSeed(s, BELL).total);
    const dice = createReplayDiceServiceFromSpec(BELL, seeds);
    expect(seeds.map(() => dice.roll())).toEqual(expected);
  });

  it("surfaces a deterministic miss once the recorded seeds run out", () => {
    const dice = createReplayDiceServiceFromSpec(BELL, [42]);
    expect(dice.roll()).toBe(rollSpecFromSeed(42, BELL).total);
    const exhausted = dice.tryRoll();
    expect(exhausted.ok).toBe(false);
    if (!exhausted.ok) {
      expect(exhausted.error).toBeInstanceOf(DiceRollError);
      expect(exhausted.error.cause).toBeInstanceOf(SeedExhaustedError);
    }
  });

  it("createFixedSeedDiceServiceFromSpec yields a constant summed roll", () => {
    const dice = createFixedSeedDiceServiceFromSpec(BELL, 31337);
    const expected = rollSpecFromSeed(31337, BELL).total;
    for (let i = 0; i < 25; i++) expect(dice.roll()).toBe(expected);
  });
});
