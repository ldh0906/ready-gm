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
import type { CharacterDelta } from "../core/character-state.js";
import type { BlackboardDelta, ThreatState } from "../core/scenario-blackboard.js";
import { validateMemoryWrite, type MemoryWrite } from "../core/memory-record.js";
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

/** The scene-level purpose the GM is aiming for in this round. */
export const SCENE_PURPOSES = [
  "setup",
  "pressure",
  "reveal",
  "choice",
  "climax",
  "aftermath",
] as const;

export type ScenePurpose = (typeof SCENE_PURPOSES)[number];

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

/** Explicit explanation for a confirmed player action that does not need dice. */
export interface NoRollRationale {
  characterName: string;
  rationale: string;
}

/**
 * The structured hot-path decision. List/flag fields are always present
 * (defaulting to empty / false) so consumers never branch on `undefined`;
 * `intent` and `gmMove` are optional because not every turn classifies cleanly.
 */
export interface GmDecision {
  intent?: Intent;
  gmMove?: GmMove;
  scenePurpose?: ScenePurpose;
  spotlightTarget?: string;
  stakes?: string;
  needsRoll: boolean;
  checks: DecisionCheck[];
  noRollRationales: NoRollRationale[];
  clockDeltas: ClockDelta[];
  characterDeltas: CharacterDelta[];
  blackboardDeltas: BlackboardDelta[];
  /** AI-proposed Memory Clerk writes (validated fail-closed by the server). */
  memoryWrites: MemoryWrite[];
  stateChanges: StateChange[];
  procedureNotes: string[];
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

/** Validate explicit no-roll rationales for confirmed actions that skip checks. */
function parseNoRollRationales(value: unknown): { ok: true; value: NoRollRationale[] } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, message: "'noRollRationales' must be an array" };
  const rationales: NoRollRationale[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, message: "each noRollRationale must be an object" };
    }
    const e = entry as Record<string, unknown>;
    if (typeof e["characterName"] !== "string" || e["characterName"].trim().length === 0) {
      return { ok: false, message: "noRollRationale 'characterName' must be a non-empty string" };
    }
    if (typeof e["rationale"] !== "string" || e["rationale"].trim().length === 0) {
      return { ok: false, message: "noRollRationale 'rationale' must be a non-empty string" };
    }
    rationales.push({ characterName: e["characterName"], rationale: e["rationale"] });
  }
  return { ok: true, value: rationales };
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

function hasString(e: Record<string, unknown>, key: string): e is Record<string, unknown> & Record<typeof key, string> {
  return typeof e[key] === "string" && e[key].trim().length > 0;
}

function parseCharacterDelta(entry: unknown): { ok: true; value: CharacterDelta } | { ok: false; message: string } {
  if (typeof entry !== "object" || entry === null) {
    return { ok: false, message: "each characterDelta must be an object" };
  }
  const e = entry as Record<string, unknown>;
  if (!hasString(e, "type")) return { ok: false, message: "characterDelta 'type' must be a string" };
  if (!hasString(e, "characterId")) return { ok: false, message: "characterDelta 'characterId' must be a string" };
  if (!hasString(e, "reason")) return { ok: false, message: "characterDelta 'reason' must be a string" };

  switch (e.type) {
    case "add_condition": {
      if (!hasString(e, "condition")) return { ok: false, message: "add_condition requires 'condition'" };
      const delta: CharacterDelta = {
        type: "add_condition",
        characterId: e.characterId,
        condition: e.condition,
        reason: e.reason,
      };
      if (e.severity !== undefined) {
        if (typeof e.severity !== "number" || !Number.isFinite(e.severity)) {
          return { ok: false, message: "add_condition 'severity' must be a finite number when present" };
        }
        delta.severity = e.severity;
      }
      return { ok: true, value: delta };
    }
    case "remove_condition":
      if (!hasString(e, "condition")) return { ok: false, message: "remove_condition requires 'condition'" };
      return {
        ok: true,
        value: { type: "remove_condition", characterId: e.characterId, condition: e.condition, reason: e.reason },
      };
    case "add_inventory":
      if (!hasString(e, "item")) return { ok: false, message: "add_inventory requires 'item'" };
      if (!Array.isArray(e.tags) || !e.tags.every((tag) => typeof tag === "string")) {
        return { ok: false, message: "add_inventory 'tags' must be a string array" };
      }
      return {
        ok: true,
        value: { type: "add_inventory", characterId: e.characterId, item: e.item, tags: e.tags, reason: e.reason },
      };
    case "spend_resource":
      if (!hasString(e, "resource")) return { ok: false, message: "spend_resource requires 'resource'" };
      if (typeof e.amount !== "number" || !Number.isFinite(e.amount)) {
        return { ok: false, message: "spend_resource 'amount' must be a finite number" };
      }
      return {
        ok: true,
        value: { type: "spend_resource", characterId: e.characterId, resource: e.resource, amount: e.amount, reason: e.reason },
      };
    case "update_relationship":
      if (!hasString(e, "targetId")) return { ok: false, message: "update_relationship requires 'targetId'" };
      if (!hasString(e, "attitude")) return { ok: false, message: "update_relationship requires 'attitude'" };
      return {
        ok: true,
        value: {
          type: "update_relationship",
          characterId: e.characterId,
          targetId: e.targetId,
          attitude: e.attitude,
          reason: e.reason,
        },
      };
    case "advance_personal_clock":
      if (!hasString(e, "clockId")) return { ok: false, message: "advance_personal_clock requires 'clockId'" };
      if (typeof e.ticks !== "number" || !Number.isFinite(e.ticks)) {
        return { ok: false, message: "advance_personal_clock 'ticks' must be a finite number" };
      }
      return {
        ok: true,
        value: { type: "advance_personal_clock", characterId: e.characterId, clockId: e.clockId, ticks: e.ticks, reason: e.reason },
      };
    case "add_memory":
      if (!hasString(e, "text")) return { ok: false, message: "add_memory requires 'text'" };
      if (typeof e.salience !== "number" || !Number.isFinite(e.salience)) {
        return { ok: false, message: "add_memory 'salience' must be a finite number" };
      }
      return {
        ok: true,
        value: { type: "add_memory", characterId: e.characterId, text: e.text, salience: e.salience, reason: e.reason },
      };
    default:
      return { ok: false, message: `unknown characterDelta type '${e.type}'` };
  }
}

function parseCharacterDeltas(value: unknown): { ok: true; value: CharacterDelta[] } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, message: "'characterDeltas' must be an array" };
  const deltas: CharacterDelta[] = [];
  for (const entry of value) {
    const parsed = parseCharacterDelta(entry);
    if (!parsed.ok) return parsed;
    deltas.push(parsed.value);
  }
  return { ok: true, value: deltas };
}

function parseBlackboardDeltas(value: unknown): BlackboardDelta[] {
  if (!Array.isArray(value)) return [];
  const deltas: BlackboardDelta[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.type !== "string" || typeof e.reason !== "string") continue;
    switch (e.type) {
      case "reveal_clue":
        if (typeof e.clueId === "string") deltas.push({ type: "reveal_clue", clueId: e.clueId, reason: e.reason });
        break;
      case "reveal_secret":
        if (typeof e.secretId === "string" && (e.reveal === "partial" || e.reveal === "full")) {
          deltas.push({ type: "reveal_secret", secretId: e.secretId, reveal: e.reveal, reason: e.reason });
        }
        break;
      case "npc_attitude":
        if (typeof e.npcId === "string" && typeof e.characterId === "string" && typeof e.attitude === "string") {
          deltas.push({ type: "npc_attitude", npcId: e.npcId, characterId: e.characterId, attitude: e.attitude, reason: e.reason });
        }
        break;
      case "npc_reveal":
        if (typeof e.npcId === "string") {
          deltas.push({ type: "npc_reveal", npcId: e.npcId, reason: e.reason });
        }
        break;
      case "npc_location":
        if (typeof e.npcId === "string" && typeof e.location === "string") {
          deltas.push({ type: "npc_location", npcId: e.npcId, location: e.location, reason: e.reason });
        }
        break;
      case "npc_goal_update":
        if (typeof e.npcId === "string" && Array.isArray(e.goals) && e.goals.every((goal) => typeof goal === "string")) {
          deltas.push({ type: "npc_goal_update", npcId: e.npcId, goals: e.goals, reason: e.reason });
        }
        break;
      case "add_threat":
        if (isThreatState(e.threat)) {
          deltas.push({ type: "add_threat", threat: e.threat, reason: e.reason });
        }
        break;
      case "advance_front":
        if (typeof e.frontId === "string" && typeof e.stage === "string") {
          deltas.push({ type: "advance_front", frontId: e.frontId, stage: e.stage, reason: e.reason });
        }
        break;
      case "set_world_flag":
        if (typeof e.key === "string" && (typeof e.value === "boolean" || typeof e.value === "string" || typeof e.value === "number")) {
          deltas.push({ type: "set_world_flag", key: e.key, value: e.value, reason: e.reason });
        }
        break;
    }
  }
  return deltas;
}

/**
 * Parse AI-proposed memory writes defensively (like blackboardDeltas): each
 * malformed entry is dropped fail-closed rather than failing the decision.
 */
function parseMemoryWrites(value: unknown): MemoryWrite[] {
  if (!Array.isArray(value)) return [];
  const writes: MemoryWrite[] = [];
  for (const entry of value) {
    const validated = validateMemoryWrite(entry);
    if (validated.ok) writes.push(validated.value);
  }
  return writes;
}

function isThreatState(value: unknown): value is ThreatState {
  if (typeof value !== "object" || value === null) return false;
  const threat = value as Record<string, unknown>;
  return (
    typeof threat.id === "string" &&
    typeof threat.name === "string" &&
    (threat.status === undefined || typeof threat.status === "string")
  );
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
  const noRollRationales = parseNoRollRationales(obj["noRollRationales"]);
  if (!noRollRationales.ok) return noRollRationales;
  const clockDeltas = parseClockDeltas(obj["clockDeltas"]);
  if (!clockDeltas.ok) return clockDeltas;
  const characterDeltas = parseCharacterDeltas(obj["characterDeltas"]);
  if (!characterDeltas.ok) return characterDeltas;
  const blackboardDeltas = parseBlackboardDeltas(obj["blackboardDeltas"]);
  const memoryWrites = parseMemoryWrites(obj["memoryWrites"]);

  const intent = obj["intent"];
  const gmMove = obj["gmMove"];
  const scenePurpose = obj["scenePurpose"];
  const needsRoll = obj["needsRoll"] === true || checks.value.length > 0;

  const decision: GmDecision = {
    needsRoll,
    checks: checks.value,
    noRollRationales: noRollRationales.value,
    clockDeltas: clockDeltas.value,
    characterDeltas: characterDeltas.value,
    blackboardDeltas,
    memoryWrites,
    stateChanges: readStateChanges(obj["stateChanges"]),
    procedureNotes: readStringArray(obj["procedureNotes"]),
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
  if (typeof scenePurpose === "string" && (SCENE_PURPOSES as readonly string[]).includes(scenePurpose)) {
    decision.scenePurpose = scenePurpose as ScenePurpose;
  }
  if (typeof obj["spotlightTarget"] === "string" && obj["spotlightTarget"].trim().length > 0) {
    decision.spotlightTarget = obj["spotlightTarget"];
  }
  if (typeof obj["stakes"] === "string" && obj["stakes"].trim().length > 0) {
    decision.stakes = obj["stakes"];
  }
  return { ok: true, value: decision };
}
