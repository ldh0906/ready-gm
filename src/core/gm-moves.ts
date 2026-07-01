/**
 * GM Moves — the constrained menu of actions the hot-path GM may take
 * (ai-architecture.md "GM Moves"). The model selects at least one move per
 * response; constraining the choice to a known menu makes GM behaviour
 * auditable and bounds the model's improvisation.
 *
 * Pure constants + a type guard, no runtime dependencies.
 */

/**
 * The recommended GM Move menu. Each emitted decision should name one of these
 * so the move can be logged (`gmMove`) and reasoned about.
 */
export const GM_MOVES = [
  "ask_clarifying_question",
  "reveal_clue",
  "reveal_clue_with_cost",
  "show_approaching_threat",
  "advance_clock",
  "offer_hard_choice",
  "separate_characters",
  "use_up_resource",
  "put_someone_in_danger",
  "reveal_unwelcome_truth",
  "turn_success_into_cost",
  "trigger_front_portent",
  "change_scene",
  "offer_opportunity",
] as const;

/** A single GM Move from {@link GM_MOVES}. */
export type GmMove = (typeof GM_MOVES)[number];

/** Type guard: is `value` one of the known {@link GM_MOVES}? */
export function isGmMove(value: unknown): value is GmMove {
  return typeof value === "string" && (GM_MOVES as readonly string[]).includes(value);
}
