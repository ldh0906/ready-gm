/**
 * Hot-path GM Decision schema + parser (ai-architecture.md "Hot Path Decision
 * Schema"). This is the structured decision the hot-path model emits BEFORE any
 * free narration: the player-utterance intent, the chosen GM Move, whether a
 * roll is needed and which checks, proposed clock deltas, off-front / climactic
 * flags, and safety flags.
 *
 * It is a strict superset of the coordinator's current check-selection (`checks`
 * + `stateChanges`), so it can eventually REPLACE that step. The engine remains
 * the authority: this parser only validates and structures the model's
 * *proposal*. Dice, clock application, and state mutation stay server-side.
 *
 * SCOPE: the schema + parser. It is wired into
 * {@link import("./ai-gm-coordinator.js").AiGmCoordinator.resolveRound} (it
 * replaced the old check-selection parse, and `clockDeltas` are applied
 * server-side). Remaining integration: the round loop must SUPPLY active clocks
 * and PERSIST the returned clocks — see {@link import("./blackboard-scope.js")}.
 */
import type { DifficultyGrade } from "../core/types.js";
import { isGmMove, type GmMove } from "../core/gm-moves.js";
import type { StateChange } from "../observability/events.js";

/** Player-utterance intent categories (ai-architecture.md "Intent Routing"). */
export const INTENTS = [
  "table_talk",
  "ask_world",
  "inspect",
  "propose_action",
  "confirm_action",
  "ask_rules",
  "safety_request",
  "revise",
  "pass",
] as const;

/** A single classified player intent. */
export type Intent = (typeof INTENTS)[number];

/** Valid difficulty grades (runtime list for validation). */
const DIFFICULTY_GRADES: readonly DifficultyGrade[] = [
  "Trivial",
  "Easy",
  "Average",
  "Hard",
  "Formidable",
];

/** A difficulty check the GM proposes — never carries a roll (server rolls). */
export interface DecisionCheck {
  characterName: string;
  /**
   * The relevant attribute key for the check. NOT restricted to the EZFudge set:
   * it is any attribute the acting character actually has (EZFudge scenarios use
   * Might/Agility/Wits/Spirit; custom-stat scenarios use their own keys, e.g.
   * Sneaky/Fast/Tenacious). The coordinator validates it against the character's
   * real attribute map and drops checks that reference an attribute the
   * character does not have.
   */
  attribute: string;
  difficulty: DifficultyGrade;
  /**
   * Optional per-check advantage the model may propose (mirrors D&D 5e
   * adv/disadv). The engine rolls twice and keeps the higher/lower total; the
   * AI never produces the value. Defaults to `"none"` when absent or invalid.
   */
  advantage?: "none" | "advantage" | "disadvantage";
  /**
   * Who the check belongs to (TRPG convention for open vs. hidden rolls):
   *  - `"player"`: the player ACTIVELY attempted something, so the check is
   *    public — the player rolls and the outcome is shown.
   *  - `"gm"`: a HIDDEN GM roll (a trap's trigger, a passive perception against
   *    an ambush, a fate/event roll). The engine still rolls it server-side and
   *    folds the outcome into the narration, but it is never surfaced to the
   *    client as a roll.
   * Defaults to `"player"` when absent or invalid (fail-open).
   */
  visibility?: "player" | "gm";
}

/**
 * A proposed change to a {@link import("../core/progress-clock.js").ProgressClock}.
 * `condition` lets the model gate the delta on the (server-computed) outcome,
 * e.g. only advance on a partial/failure.
 */
export interface ClockDelta {
  clockId: string;
  delta: number;
  condition?: string;
  reason?: string;
}

/**
 * The structured hot-path decision. List/flag fields are always present
 * (defaulting to empty / false) so consumers never branch on `undefined`;
 * `intent` and `gmMove` are optional because not every turn classifies cleanly.
 */
export interface GmDecision {
  intent?: Intent;
  gmMove?: GmMove;
  needsRoll: boolean;
  checks: DecisionCheck[];
  clockDeltas: ClockDelta[];
  stateChanges: StateChange[];
  /** Clue ids the GM revealed to the players this round (applied to Scene State). */
  revealedClues: string[];
  offFront: boolean;
  climactic: boolean;
  safetyFlags: string[];
}

/** Result of {@link parseGmDecision}: a validated decision or a reason string. */
export type GmDecisionParse =
  | { ok: true; value: GmDecision }
  | { ok: false; message: string };

/** Parse a JSON string into a plain object, or fail. */
function parseObject(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, message: "decision is not valid JSON" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, message: "decision JSON must be an object" };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

/** Validate the `checks` array (each: known character name, attribute, difficulty). */
function parseChecks(value: unknown): { ok: true; value: DecisionCheck[] } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, message: "'checks' must be an array" };
  const checks: DecisionCheck[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, message: "each check must be an object" };
    }
    const e = entry as Record<string, unknown>;
    if (typeof e["characterName"] !== "string") {
      return { ok: false, message: "check 'characterName' must be a string" };
    }
    if (typeof e["attribute"] !== "string" || e["attribute"].trim().length === 0) {
      return { ok: false, message: "check 'attribute' must be a non-empty string" };
    }
    if (typeof e["difficulty"] !== "string" || !DIFFICULTY_GRADES.includes(e["difficulty"] as DifficultyGrade)) {
      return { ok: false, message: `check 'difficulty' must be one of ${DIFFICULTY_GRADES.join(", ")}` };
    }
    // Optional advantage: fail-open like other optional fields — an absent or
    // invalid value defaults to "none" rather than failing the whole decision.
    const advantage =
      e["advantage"] === "advantage" || e["advantage"] === "disadvantage" || e["advantage"] === "none"
        ? (e["advantage"] as "none" | "advantage" | "disadvantage")
        : "none";
    // Optional visibility: fail-open to "player" (public, player-rolled) for an
    // absent or invalid value, so a malformed field never hides a check.
    const visibility = e["visibility"] === "gm" ? "gm" : "player";
    checks.push({
      characterName: e["characterName"],
      attribute: e["attribute"],
      difficulty: e["difficulty"] as DifficultyGrade,
      advantage,
      visibility,
    });
  }
  return { ok: true, value: checks };
}

/** Validate the optional `clockDeltas` array (each: clockId + finite delta). */
function parseClockDeltas(value: unknown): { ok: true; value: ClockDelta[] } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, message: "'clockDeltas' must be an array" };
  const deltas: ClockDelta[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, message: "each clockDelta must be an object" };
    }
    const e = entry as Record<string, unknown>;
    if (typeof e["clockId"] !== "string") {
      return { ok: false, message: "clockDelta 'clockId' must be a string" };
    }
    if (typeof e["delta"] !== "number" || !Number.isFinite(e["delta"])) {
      return { ok: false, message: "clockDelta 'delta' must be a finite number" };
    }
    const delta: ClockDelta = { clockId: e["clockId"], delta: Math.trunc(e["delta"]) };
    if (typeof e["condition"] === "string") delta.condition = e["condition"];
    if (typeof e["reason"] === "string") delta.reason = e["reason"];
    deltas.push(delta);
  }
  return { ok: true, value: deltas };
}

/** Coerce an unknown value into a {@link StateChange} array (best-effort). */
function readStateChanges(value: unknown): StateChange[] {
  if (!Array.isArray(value)) return [];
  const changes: StateChange[] = [];
  for (const entry of value) {
    if (typeof entry === "object" && entry !== null && "target" in entry) {
      const e = entry as Record<string, unknown>;
      if (typeof e["target"] === "string") {
        changes.push({ target: e["target"], from: e["from"], to: e["to"] });
      }
    }
  }
  return changes;
}

/** Read a string array, dropping non-string entries; `undefined` -> `[]`. */
function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * Parse + validate a hot-path {@link GmDecision} from raw model output. Unknown
 * `intent`/`gmMove` values are dropped (left `undefined`) rather than failing
 * the whole decision; malformed `checks`/`clockDeltas` arrays DO fail, since the
 * engine would otherwise act on a structurally broken proposal.
 */
export function parseGmDecision(raw: string): GmDecisionParse {
  const parsed = parseObject(raw);
  if (!parsed.ok) return parsed;
  const obj = parsed.value;

  const checks = parseChecks(obj["checks"]);
  if (!checks.ok) return checks;
  const clockDeltas = parseClockDeltas(obj["clockDeltas"]);
  if (!clockDeltas.ok) return clockDeltas;

  const intent = obj["intent"];
  const gmMove = obj["gmMove"];
  const needsRoll = obj["needsRoll"] === true || checks.value.length > 0;

  const decision: GmDecision = {
    needsRoll,
    checks: checks.value,
    clockDeltas: clockDeltas.value,
    stateChanges: readStateChanges(obj["stateChanges"]),
    revealedClues: readStringArray(obj["revealedClues"]),
    offFront: obj["offFront"] === true,
    climactic: obj["climactic"] === true,
    safetyFlags: readStringArray(obj["safetyFlags"]),
  };
  if (typeof intent === "string" && (INTENTS as readonly string[]).includes(intent)) {
    decision.intent = intent as Intent;
  }
  if (isGmMove(gmMove)) {
    decision.gmMove = gmMove;
  }
  return { ok: true, value: decision };
}
