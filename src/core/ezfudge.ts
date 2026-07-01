/**
 * EZFudge resolver — the central pure function of the engine.
 *
 * Maps an EZFudge check `(attributeLevel, difficultyGrade, roll)` to an
 * {@link OutcomeGrade}. It is deterministic and side-effect free given its
 * inputs, which makes it the anchor for property-based testing.
 *
 * Sources: design.md "Components and Interfaces" — 6. EZFudge Resolver.
 * Requirements: 11.3, 11.4
 */
import type { AttributeLevel, DifficultyGrade, OutcomeGrade } from "./types.js";

/**
 * Difficulty target offsets subtracted from `(attribute + roll)` to compute the
 * check margin. Harder difficulties have higher targets (design.md EZFudge
 * Resolver mapping).
 */
export const DIFFICULTY_TARGET: Record<DifficultyGrade, number> = {
  Trivial: -2,
  Easy: -1,
  Average: 0,
  Hard: 1,
  Formidable: 2,
};

/**
 * The integer target a check must overcome for the given difficulty.
 * Requirement 11.4.
 */
export function difficultyTarget(difficulty: DifficultyGrade): number {
  return DIFFICULTY_TARGET[difficulty];
}

/**
 * Inclusive bounds of the EZFudge attribute ladder (design.md: Terrible=-2 …
 * Superb=+4). These are the DEFAULT rungs; a deployment can override the band
 * via {@link import("./types.js").EngineConfig.attributeLadder} when a scenario
 * or rule system uses a different ladder. Attribute levels outside the active
 * band are rejected at the boundaries (AI proposals and player edits) so
 * difficulty math cannot be skewed by out-of-ladder values.
 */
export const ATTRIBUTE_LEVEL_MIN = -2;
export const ATTRIBUTE_LEVEL_MAX = 4;

/** An inclusive integer attribute ladder band. */
export interface AttributeLadder {
  min: number;
  max: number;
}

/** The default EZFudge attribute ladder `[-2, +4]`. */
export const DEFAULT_ATTRIBUTE_LADDER: AttributeLadder = {
  min: ATTRIBUTE_LEVEL_MIN,
  max: ATTRIBUTE_LEVEL_MAX,
};

/**
 * Whether `level` is an integer on the given attribute `ladder` (defaults to
 * {@link DEFAULT_ATTRIBUTE_LADDER}). Pass a configured ladder to validate
 * against a non-default rule system.
 */
export function isValidAttributeLevel(
  level: number,
  ladder: AttributeLadder = DEFAULT_ATTRIBUTE_LADDER,
): boolean {
  return Number.isInteger(level) && level >= ladder.min && level <= ladder.max;
}

/**
 * Resolve an EZFudge check to an {@link OutcomeGrade}.
 *
 * `margin = (attribute + roll) - difficultyTarget(difficulty)`, then:
 * - `margin < 0`      → `"Failure"`
 * - `margin === 0`    → `"Partial Success"`
 * - `margin` 1..2     → `"Success"`
 * - `margin >= 3`     → `"Critical Success"`
 *
 * Pure and deterministic for all integer inputs (Requirements 11.3, 11.4).
 *
 * @param attribute  The acting character's attribute level (integer ladder).
 * @param difficulty The difficulty grade chosen for the check.
 * @param roll       The server-side dice roll (a summed-dice integer, e.g. in [-4, +4]).
 */
export function resolveCheck(
  attribute: AttributeLevel,
  difficulty: DifficultyGrade,
  roll: number,
): OutcomeGrade {
  const margin = attribute + roll - difficultyTarget(difficulty);

  if (margin < 0) return "Failure";
  if (margin === 0) return "Partial Success";
  if (margin <= 2) return "Success";
  return "Critical Success";
}

/**
 * Per-check advantage mode, mirroring D&D 5e advantage/disadvantage. The engine
 * (server) rolls the EZFudge dice twice and keeps the higher (advantage) or
 * lower (disadvantage) summed total; `"none"` rolls once. The AI GM may PROPOSE
 * a mode per check, but randomness always stays server-side in the
 * {@link import("./dice.js").DiceService} — the AI never produces the value.
 */
export type RollAdvantage = "none" | "advantage" | "disadvantage";

/**
 * Choose the resolved roll from one or more EZFudge totals per advantage mode.
 * `none` -> `rolls[0]`; `advantage` -> `max(rolls)`; `disadvantage` ->
 * `min(rolls)`. Pure and deterministic; the caller (engine) supplies the
 * server-rolled totals.
 */
export function chooseAdvantageRoll(rolls: readonly number[], advantage: RollAdvantage): number {
  if (!Array.isArray(rolls) || rolls.length === 0) {
    throw new RangeError("chooseAdvantageRoll requires at least one roll");
  }
  if (advantage === "advantage") return rolls.reduce((a, b) => (b > a ? b : a), rolls[0]);
  if (advantage === "disadvantage") return rolls.reduce((a, b) => (b < a ? b : a), rolls[0]);
  return rolls[0];
}
