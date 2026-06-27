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
