/**
 * Dice Service — the server-side source of randomness for difficulty checks.
 *
 * The AI GM chooses *which* check applies and at what difficulty, but it never
 * produces the random number. That responsibility lives here so outcomes are
 * fair and reproducible only by the server (Requirement 11.2).
 *
 * Reproducibility for QA replay (Requirement 18.3): rather than drawing
 * directly from Node's CSPRNG (which leaves no recoverable seed), each default
 * roll first draws a 32-bit **seed** from the CSPRNG — keeping the roll
 * unpredictable and server-only — then derives the value deterministically from
 * `(seed, range)` via a small seeded PRNG ({@link rollFromSeed}). Recording the
 * seed lets a roll be replayed exactly. The PRNG uses rejection sampling so each
 * die is drawn uniformly over its inclusive face range with no modulo bias.
 *
 * A roll is described by a {@link DiceSpec}: sum `count` independent dice, each
 * drawn uniformly over the same `face` range. A single die (`count: 1`) is a
 * flat uniform roll; summing two or more dice yields a symmetric, bell-shaped
 * distribution over the aggregate range that concentrates mass near the centre
 * and makes extreme results (criticals / fumbles) rarer — closer to the EZFudge
 * "dice pool" feel than a flat band, while every individual die stays unbiased
 * (Requirement 11.6). All `count` sub-draws for one roll come from the same
 * recorded seed, so a summed roll replays exactly like a single one.
 *
 * A non-throwing failure path (`tryRoll`) is exposed so resolution logic can
 * withhold the affected narration until a result is produced, rather than
 * fabricating a value, when the RNG is unavailable (Requirement 17.3).
 *
 * When an {@link EventSink} and correlation are supplied, each successful roll
 * emits a `dice_roll` QA event best-effort — emission never affects the value
 * returned to the engine and never throws into game flow.
 *
 * Requirements: 11.2, 11.6, 18.3 (and supports 17.3).
 */
import { randomInt } from "node:crypto";
import type { EventSink } from "../observability/event-sink.js";
import { makeDiceRollEvent, type EnvelopeGenerators } from "../observability/events.js";

/**
 * A source of unbiased uniform integers over a half-open interval
 * `[minInclusive, maxExclusive)`. Injectable so the failure path and exact
 * bounds can be exercised in tests; when provided it bypasses the seeded PRNG
 * (and therefore yields no recoverable seed).
 */
export type UniformIntSource = (minInclusive: number, maxExclusive: number) => number;

/**
 * Produces a fresh 32-bit unsigned integer seed per roll. Defaults to the
 * CSPRNG so seeds — and therefore rolls — stay unpredictable.
 */
export type SeedSource = () => number;

/** Default CSPRNG-backed seed source: a uniform 32-bit unsigned integer. */
const defaultSeedSource: SeedSource = () => randomInt(0, 2 ** 32);

/**
 * Error raised when a replay seed source has exhausted its recorded seed
 * sequence. This is surfaced as a *deterministic miss* — the replay source
 * never silently falls back to the CSPRNG, so a session that consumes more
 * rolls than were recorded fails loudly rather than diverging from the
 * recording (Requirement 18.3). The dice service turns this into a
 * {@link DiceRollError} via its existing failure path so callers can withhold
 * (Requirement 17.3-style withholding).
 */
export class SeedExhaustedError extends Error {
  override readonly name = "SeedExhaustedError";
  constructor(
    /** How many seeds had been recorded for replay. */
    readonly recordedCount: number,
    /** The 0-based index of the seed that was requested past the end. */
    readonly requestedIndex: number,
  ) {
    super(
      `Replay seed source exhausted: requested seed #${requestedIndex} but only ` +
        `${recordedCount} seed(s) were recorded`,
    );
  }
}

/**
 * Error raised when the underlying random source fails to produce a result.
 * Resolution logic uses this to withhold narration (Requirement 17.3).
 */
export class DiceRollError extends Error {
  override readonly name = "DiceRollError";
  constructor(
    message: string,
    /** The originating error, when the failure came from the random source. */
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

/** Non-throwing roll result: either a value or a reported failure. */
export type DiceRollResult =
  | { ok: true; value: number }
  | { ok: false; error: DiceRollError };

/** Inclusive integer range the dice are drawn from. */
export interface DiceRange {
  /** Inclusive lower bound. */
  min: number;
  max: number;
}

/**
 * A dice roll specification: sum `count` independent dice, each drawn uniformly
 * over the inclusive `face` range. The aggregate (output) range of a roll is
 * `[count * face.min, count * face.max]` (see {@link specRange}).
 *
 * - `{ count: 1, face: { min: -4, max: 4 } }` — a flat uniform roll over [-4, 4].
 * - `{ count: 2, face: { min: -2, max: 2 } }` — EZFudge's default bell roll over
 *   the same [-4, 4] band, but with the centre far more likely than the extremes.
 *
 * Expressing the dice this way makes it trivial to swap rule systems (more or
 * fewer dice, wider or narrower faces) without changing the resolver or the
 * replay machinery.
 */
export interface DiceSpec {
  /** Number of independent dice summed for one roll (integer ≥ 1). */
  count: number;
  /** The inclusive face range each die is drawn from. */
  face: DiceRange;
}

/**
 * The aggregate inclusive output range of a {@link DiceSpec}: summing `count`
 * dice each in `[face.min, face.max]` spans `[count*face.min, count*face.max]`.
 */
export function specRange(spec: DiceSpec): DiceRange {
  return { min: spec.count * spec.face.min, max: spec.count * spec.face.max };
}

/**
 * The full record of a single roll, including the recorded `seed` so the roll
 * can be replayed deterministically from `(seed, spec)` for QA (Requirement
 * 18.3). `seed` is `null` when an injected {@link UniformIntSource} produced
 * the value (no recoverable seed).
 */
export interface DiceRollRecord {
  /** The resolved roll: the sum of every die in {@link rawValues}. */
  value: number;
  /** The individual per-die face values that were summed to produce `value`. */
  rawValues: number[];
  seed: number | null;
  /** The aggregate inclusive output range of the roll (see {@link specRange}). */
  range: Readonly<DiceRange>;
}

/** Correlation + identity used to emit a `dice_roll` event for each roll. */
export interface DiceCorrelation {
  /** The room/session id. */
  sessionId: string;
  /** The current round number. */
  roundNo: number;
  /** Who/what requested the roll (server identity). */
  roller?: string;
}

/** Optional wiring for seeding and QA event emission. */
export interface DiceServiceOptions {
  /** Override the per-roll seed source (defaults to the CSPRNG). */
  seedSource?: SeedSource;
  /** Best-effort sink that receives a `dice_roll` event per successful roll. */
  sink?: EventSink;
  /** Correlation/identity for emitted events; required for emission. */
  correlation?: DiceCorrelation;
  /** Injectable envelope generators for deterministic event ids/timestamps. */
  generators?: EnvelopeGenerators;
}

/**
 * A seeded mulberry32 PRNG. Fast, deterministic, and sufficient for fair check
 * resolution; the per-roll seed comes from the CSPRNG so values stay
 * unpredictable in production.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw a single uniform integer in `[range.min, range.max]` (inclusive) from a
 * PRNG `next` function. Uses rejection sampling over the 32-bit output so the
 * result is unbiased (no modulo bias). Shared by {@link rollFromSeed} (one draw)
 * and {@link rollSpecFromSeed} (one draw per die, all from the same sequence).
 */
function uniformFromRng(next: () => number, range: DiceRange): number {
  const span = range.max - range.min + 1;
  // Largest multiple of `span` that fits in the 32-bit space; values at or
  // above it are rejected so every outcome is equally likely.
  const limit = Math.floor(0x100000000 / span) * span;
  let x: number;
  do {
    x = Math.floor(next() * 0x100000000);
  } while (x >= limit);
  return range.min + (x % span);
}

/**
 * Deterministically derive a uniform integer in `[range.min, range.max]`
 * (inclusive) from a `seed`. Unbiased (rejection sampling, no modulo bias).
 * Replaying the same `(seed, range)` always yields the same value (Requirement
 * 18.3). This is the single-die primitive; {@link rollSpecFromSeed} layers
 * multi-die summing on top of it.
 */
export function rollFromSeed(seed: number, range: DiceRange): number {
  return uniformFromRng(mulberry32(seed), range);
}

/**
 * Deterministically derive a summed roll from a `seed` and {@link DiceSpec}:
 * draw `spec.count` uniform faces from a SINGLE seeded PRNG sequence and return
 * both the per-die `rawValues` and their `total`. Because every sub-draw comes
 * from one seed, the whole roll replays exactly from `(seed, spec)` (Requirement
 * 18.3). Summing multiple dice produces a symmetric bell-shaped distribution
 * over the aggregate range while each die stays uniform (Requirement 11.6).
 */
export function rollSpecFromSeed(
  seed: number,
  spec: DiceSpec,
): { rawValues: number[]; total: number } {
  const next = mulberry32(seed);
  const rawValues: number[] = [];
  let total = 0;
  for (let i = 0; i < spec.count; i++) {
    const v = uniformFromRng(next, spec.face);
    rawValues.push(v);
    total += v;
  }
  return { rawValues, total };
}

/**
 * Server-side dice roller. Produces a roll that is the sum of one or more
 * unbiased uniform dice over the configured {@link DiceSpec}; {@link range} is
 * the aggregate output band.
 */
export interface DiceService {
  /**
   * Roll: the summed value over `[range.min, range.max]` (inclusive).
   * @throws {DiceRollError} when the random source fails to produce a result.
   */
  roll(): number;

  /**
   * Roll without throwing. Returns `{ ok: true, value }` on success or
   * `{ ok: false, error }` on failure — the failure path resolution logic uses
   * to withhold narration (Requirement 17.3).
   */
  tryRoll(): DiceRollResult;

  /**
   * Roll and return the full {@link DiceRollRecord} (summed value + per-die raw
   * values + recorded seed + range) for replay/logging (Requirement 18.3).
   * @throws {DiceRollError} when the random source fails to produce a result.
   */
  rollWithRecord(): DiceRollRecord;

  /** The aggregate inclusive range this service rolls over. */
  readonly range: Readonly<DiceRange>;
}

/**
 * Create a {@link DiceService} for a flat uniform roll over the given inclusive
 * `range` — shorthand for {@link createDiceServiceFromSpec} with `count: 1`.
 *
 * @param range The inclusive `[min, max]` band, e.g. `[-4, +4]`.
 * @param source Optional uniform integer source over a half-open interval. When
 *   omitted, a CSPRNG-seeded PRNG is used and the seed is recorded for replay.
 *   When provided (e.g. in tests), it supplies the value directly and the
 *   recorded seed is `null`.
 * @param options Optional seeding override and QA event wiring.
 */
export function createDiceService(
  range: DiceRange,
  source?: UniformIntSource,
  options: DiceServiceOptions = {},
): DiceService {
  return createDiceServiceFromSpec({ count: 1, face: range }, source, options);
}

/**
 * Create a {@link DiceService} from a {@link DiceSpec}: each roll sums `count`
 * unbiased uniform dice over `face`. With `count > 1` the aggregate
 * distribution is symmetric and bell-shaped, making extreme results rarer than
 * a flat band while each die stays uniform (Requirement 11.6).
 *
 * @param spec The dice model (number of dice + their inclusive face range).
 * @param source Optional per-die uniform source over a half-open interval; when
 *   provided it drives every die directly and the recorded seed is `null`.
 * @param options Optional seeding override and QA event wiring.
 */
export function createDiceServiceFromSpec(
  spec: DiceSpec,
  source?: UniformIntSource,
  options: DiceServiceOptions = {},
): DiceService {
  if (!Number.isInteger(spec.count) || spec.count < 1) {
    throw new RangeError(`Dice count must be a positive integer, received ${spec.count}`);
  }
  if (!Number.isInteger(spec.face.min) || !Number.isInteger(spec.face.max)) {
    throw new RangeError(
      `Dice face bounds must be integers, received [${spec.face.min}, ${spec.face.max}]`,
    );
  }
  if (spec.face.min > spec.face.max) {
    throw new RangeError(
      `Dice face min (${spec.face.min}) must not exceed max (${spec.face.max})`,
    );
  }

  // Freeze a private copy so a caller mutating the passed-in object cannot
  // change the dice a live service rolls.
  const face: Readonly<DiceRange> = Object.freeze({ min: spec.face.min, max: spec.face.max });
  const count = spec.count;
  const frozenSpec: Readonly<DiceSpec> = Object.freeze({ count, face });
  const outRange: Readonly<DiceRange> = Object.freeze(specRange(frozenSpec));
  // External sources are half-open: draw from [min, max + 1) to make max inclusive.
  const faceMaxExclusive = face.max + 1;
  const seedSource = options.seedSource ?? defaultSeedSource;
  // A single die reads as a flat uniform band; multiple dice are a summed pool.
  const expression =
    count === 1
      ? `uniform[${face.min},${face.max}]`
      : `sum(${count}d[${face.min},${face.max}])`;

  // Produce the per-die raw values + summed total plus the seed used (null when
  // an external source drives the dice, since that has no recoverable seed).
  const draw = (): { rawValues: number[]; total: number; seed: number | null } => {
    if (source) {
      const rawValues: number[] = [];
      let total = 0;
      for (let i = 0; i < count; i++) {
        const v = source(face.min, faceMaxExclusive);
        rawValues.push(v);
        total += v;
      }
      return { rawValues, total, seed: null };
    }
    const seed = seedSource();
    const { rawValues, total } = rollSpecFromSeed(seed, frozenSpec);
    return { rawValues, total, seed };
  };

  // Best-effort emission of a dice_roll event; never affects the roll result.
  const emit = (record: DiceRollRecord): void => {
    const { sink, correlation } = options;
    if (!sink || !correlation) return;
    try {
      sink.emit(
        makeDiceRollEvent(
          { sessionId: correlation.sessionId, roundNo: correlation.roundNo },
          {
            roller: correlation.roller ?? "dice_service",
            expression,
            range: { min: outRange.min, max: outRange.max },
            rawValues: record.rawValues,
            result: record.value,
            seed: record.seed,
          },
          options.generators,
        ),
      );
    } catch {
      // Best-effort: a logging failure must never affect game flow.
    }
  };

  const rollWithRecord = (): DiceRollRecord => {
    let rawValues: number[];
    let total: number;
    let seed: number | null;
    try {
      const drawn = draw();
      rawValues = drawn.rawValues;
      total = drawn.total;
      seed = drawn.seed;
    } catch (cause) {
      throw cause instanceof DiceRollError
        ? cause
        : new DiceRollError("Dice service failed to produce a result", cause);
    }
    // Guard against a misbehaving custom source: any out-of-range or
    // non-integer die is treated as a failure rather than corrupting a check.
    if (!rawValues.every((v) => Number.isInteger(v) && v >= face.min && v <= face.max)) {
      throw new DiceRollError(
        `Dice source returned out-of-range value [${rawValues.join(", ")}] for face [${face.min}, ${face.max}]`,
      );
    }
    const record: DiceRollRecord = { value: total, rawValues, seed, range: outRange };
    emit(record);
    return record;
  };

  return {
    range: outRange,
    rollWithRecord,
    roll(): number {
      return rollWithRecord().value;
    },
    tryRoll(): DiceRollResult {
      try {
        return { ok: true, value: rollWithRecord().value };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof DiceRollError
              ? error
              : new DiceRollError("Dice service failed to produce a result", error),
        };
      }
    },
  };
}

/**
 * Build a {@link SeedSource} that replays an ordered list of recorded `seeds`
 * (e.g. the `seed` values captured on prior `dice_roll` events), returning them
 * one per call in order. This makes a session's checks reproduce *exactly*: the
 * same recorded seeds run through {@link rollFromSeed} yield the same value
 * sequence (Requirement 18.3).
 *
 * When the recorded seeds are exhausted, the source surfaces a **deterministic
 * miss** by throwing {@link SeedExhaustedError} rather than silently falling
 * back to the CSPRNG — a replay that ran out of recorded entropy must fail
 * loudly instead of diverging from the recording. The dice service's existing
 * failure path turns this into a {@link DiceRollError} (so `tryRoll` reports
 * failure and callers can withhold).
 *
 * The `seeds` array is copied defensively so later mutation of the caller's
 * array cannot change what a live replay source yields.
 */
export function createReplaySeedSource(seeds: readonly number[]): SeedSource {
  const recorded = seeds.slice();
  let index = 0;
  return function nextSeed(): number {
    if (index >= recorded.length) {
      throw new SeedExhaustedError(recorded.length, index);
    }
    return recorded[index++] as number;
  };
}

/**
 * Build a {@link SeedSource} that always yields the same `seed`. A convenience
 * for tests that want a constant, fully deterministic roll without managing a
 * recorded sequence.
 */
export function fixedSeedSource(seed: number): SeedSource {
  return () => seed;
}

/**
 * Construct a {@link DiceService} wired to a replay {@link SeedSource} built
 * from a recorded `seeds` sequence. Replaying the recorded seeds reproduces the
 * exact value sequence (via {@link rollFromSeed}); once the seeds are exhausted,
 * rolls fail deterministically through the service's normal failure path (no
 * CSPRNG fallback). Intended for QA replay of a recorded session (Requirement
 * 18.3); production keeps the CSPRNG default unchanged.
 *
 * Any `seedSource` supplied via `options` is ignored — the replay source is
 * authoritative for a replay service.
 */
export function createReplayDiceService(
  range: DiceRange,
  seeds: readonly number[],
  options: Omit<DiceServiceOptions, "seedSource"> = {},
): DiceService {
  return createDiceService(range, undefined, {
    ...options,
    seedSource: createReplaySeedSource(seeds),
  });
}

/**
 * Construct a {@link DiceService} that always uses the same `seed`, yielding a
 * constant value over the configured range. A convenience for tests needing a
 * pinned, reproducible roll. Production keeps the CSPRNG default unchanged.
 *
 * Any `seedSource` supplied via `options` is ignored — the fixed seed is
 * authoritative.
 */
export function createFixedSeedDiceService(
  range: DiceRange,
  seed: number,
  options: Omit<DiceServiceOptions, "seedSource"> = {},
): DiceService {
  return createDiceService(range, undefined, {
    ...options,
    seedSource: fixedSeedSource(seed),
  });
}

/**
 * Spec-aware variant of {@link createReplayDiceService}: replay a recorded seed
 * sequence through a multi-die {@link DiceSpec} so a summed-dice session
 * reproduces its exact roll sequence (Requirement 18.3). Each recorded seed
 * drives one whole roll (all `spec.count` sub-draws), exhaustion surfaces a
 * deterministic miss, and any `seedSource` in `options` is ignored.
 */
export function createReplayDiceServiceFromSpec(
  spec: DiceSpec,
  seeds: readonly number[],
  options: Omit<DiceServiceOptions, "seedSource"> = {},
): DiceService {
  return createDiceServiceFromSpec(spec, undefined, {
    ...options,
    seedSource: createReplaySeedSource(seeds),
  });
}

/**
 * Spec-aware variant of {@link createFixedSeedDiceService}: a constant summed
 * roll from a single pinned `seed` over a multi-die {@link DiceSpec}. Any
 * `seedSource` in `options` is ignored — the fixed seed is authoritative.
 */
export function createFixedSeedDiceServiceFromSpec(
  spec: DiceSpec,
  seed: number,
  options: Omit<DiceServiceOptions, "seedSource"> = {},
): DiceService {
  return createDiceServiceFromSpec(spec, undefined, {
    ...options,
    seedSource: fixedSeedSource(seed),
  });
}
