/**
 * Turn_State entity model and lossless JSON serialization.
 *
 * The Turn_State is the canonical per-room JSON short-term memory record. It
 * lives in Redis for low-latency reads/writes and is persisted to Postgres on
 * change. It MUST serialize and deserialize losslessly so the live and durable
 * stores never disagree (design.md "Turn_State (JSON short-term memory)").
 *
 * These types are pure data with no runtime dependencies so the core stays
 * unit- and property-testable without a network, AI, or DB.
 *
 * Requirements: 12.1 (JSON record per active room), 12.2 (carries round number,
 * phase, per-player readiness, each player's pending action, recent narrative).
 */
import type {
  ActionKind,
  DifficultyGrade,
  OutcomeGrade,
  Phase,
  ReadinessStatus,
} from "./types.js";
import type { VisibleCharacterState } from "./character-state.js";
import type { VisibleBlackboard } from "./scenario-blackboard.js";

/**
 * Per active-player readiness during a ready-check (Requirements 7.1, 7.2, 12.2).
 * Captures the player's pending action: its kind (confirmed/pass/auto-pass) and
 * the confirmed action content when applicable.
 */
export interface ReadinessEntry {
  playerId: string;
  /** Whether the player has signalled ready for resolution (R7.1, R7.2). */
  status: ReadinessStatus;
  /** Confirmed action / pass / auto-pass; `null` until recorded (R8.2). */
  actionKind: ActionKind;
  /** The confirmed action content, or `null` for pass/auto-pass/unset. */
  actionText: string | null;
  /**
   * The player's character name, for `characterName(displayName)` roster
   * display. Display-only: injected by the realtime fan-out (gateway decorator)
   * from room/character data and NOT part of the canonical persisted Turn_State,
   * so the round-loop/serializer never read or write it.
   */
  characterName?: string;
  /** The player's room join display name, paired with {@link characterName} for the roster. */
  displayName?: string;
}

/** A single in-round chat message, attributed to the sender's character (R6.3, R6.4). */
export interface ChatEntry {
  playerId: string;
  characterName: string;
  text: string;
  /** ISO timestamp string; ordering is by array position (send order). */
  ts: string;
  /**
   * The sender's room join display name, for `characterName(displayName)`
   * attribution; optional/absent on legacy entries.
   */
  displayName?: string;
}

/**
 * A check resolved this round. The recorded `outcome` always equals
 * `resolveCheck(attribute, difficulty, roll)` (Requirements 11.3, 11.5).
 */
export interface CheckRecord {
  characterId: string;
  /**
   * The attribute the check was resolved against — any key the acting character
   * actually has (EZFudge Might/Agility/Wits/Spirit, or a custom-stat scenario's
   * own keys). Kept as a free string so non-EZFudge scenarios resolve too.
   */
  attribute: string;
  difficulty: DifficultyGrade;
  /** The CHOSEN server-side dice total (R11.2). For an advantage/disadvantage
   * check this is the higher/lower of the two rolls in {@link CheckRecord.rolls};
   * for `"none"` it equals `rolls[0]`. Existing consumers keep reading `roll`. */
  roll: number;
  outcome: OutcomeGrade;
  /**
   * The advantage mode the check was resolved under (mirrors D&D 5e adv/disadv).
   * The union is inlined here (rather than importing `RollAdvantage` from
   * `./ezfudge.js`) to keep this pure-data module dependency-free. Defaults to
   * `"none"` when a legacy record is deserialized without it.
   */
  advantage: "none" | "advantage" | "disadvantage";
  /**
   * The individual EZFudge totals the engine considered for this check: length 1
   * for `"none"`, length 2 for advantage/disadvantage. The chosen total is
   * surfaced as {@link CheckRecord.roll}. Defaults to `[roll]` for legacy records.
   */
  rolls: number[];
  /**
   * Whether the check was a public PLAYER check (the player actively attempted
   * something and rolls openly) or a hidden GM roll (a trap, a passive sense
   * against an ambush, a fate/event roll). The engine resolves both server-side;
   * only `"player"` checks are surfaced to the client. Defaults to `"player"`
   * when a legacy record is deserialized without it.
   */
  visibility: "player" | "gm";
}

/**
 * Public per-check rolling state for the current round. Pending entries omit
 * roll/outcome values; rolled entries carry only the server-authoritative
 * resolved values. This is persisted in Turn_State so reconnecting clients can
 * resume a mid-roll round without exposing unresolved dice.
 */
export interface PendingCheck {
  checkId: string;
  characterId: string;
  characterName?: string;
  /** Owning player who may request the roll; null means server/GM-owned. */
  playerId: string | null;
  attribute: string;
  difficulty: DifficultyGrade;
  advantage: "none" | "advantage" | "disadvantage";
  visibility: "player" | "gm";
  status: "pending" | "rolled";
  /** Present only after the server rolls this check. */
  roll?: number;
  /** Present only after the server rolls this check. */
  rolls?: number[];
  /** Present only after the server rolls this check. */
  outcome?: OutcomeGrade;
  /** True when the server rolled because the owner was absent or timed out. */
  autoRolled?: boolean;
}

/** A recent narrative memory entry (resolution/opening narration), newest last (R12.2, R12.5). */
export interface NarrativeContextEntry {
  round: number;
  text: string;
}

/**
 * The canonical per-room Turn_State JSON record (Requirement 12.1).
 *
 * Includes the round number, phase, per-player readiness with each player's
 * pending action, the round's chat and resolved checks, recent narrative
 * context, the ready-check timer fields, and the at-most-once resolution guard.
 */
export interface TurnState {
  roomId: string;
  /** Starts at 1 once the session has started (R5.4). */
  roundNumber: number;
  /** Round-loop phase (R5.4, round loop). */
  phase: Phase;
  /** One entry per active player (R12.2). */
  readiness: ReadinessEntry[];
  /** Current round's chat in send order (R6.4). */
  chatLog: ChatEntry[];
  /** Checks resolved this round (R11.5). */
  checks: CheckRecord[];
  /** Pending/rolled player-visible checks during the two-phase rolling window. */
  rollingChecks?: PendingCheck[];
  /** Recent narrative context, newest last (R12.2). */
  narrativeContext: NarrativeContextEntry[];
  /** ISO deadline for the ready-check countdown, or `null` when not running (R8.1, R8.3). */
  readyCheckDeadline: string | null;
  /** Ready-check timeout in ms; default 90000 (R8.4). */
  readyCheckTimeoutMs: number;
  /** At-most-once resolution guard (R10.3, R16.1). */
  resolutionRequested: boolean;
  /**
   * Player-visible character states (conditions/inventory/resources/personal
   * clocks) for the game UI. Display-only: injected by the realtime fan-out
   * (gateway decorator) from the CharacterStateStore and NOT part of the
   * canonical persisted Turn_State — the serializer strips it, and GM-only
   * material (memories, flags, relationships, delta reasons) is never included.
   */
  characterStates?: VisibleCharacterState[];
  /** Player-visible ScenarioBlackboard projection, injected at fan-out only. */
  blackboard?: VisibleBlackboard;
}

/**
 * Serialize a {@link TurnState} to a JSON string.
 *
 * Fields are written in a fixed, explicit order so the output is stable and the
 * round-trip with {@link deserializeTurnState} is lossless.
 */
export function serializeTurnState(state: TurnState): string {
  return JSON.stringify(toPlain(state));
}

/**
 * Deserialize a JSON string produced by {@link serializeTurnState} back into a
 * {@link TurnState}. Reconstructs the object explicitly so the result is a
 * clean, normalized value (no extraneous keys) that is deep-equal to the
 * original (Requirements 12.1, 12.2).
 */
export function deserializeTurnState(json: string): TurnState {
  const raw = JSON.parse(json) as unknown;
  if (typeof raw !== "object" || raw === null) {
    throw new TypeError("Turn_State JSON must decode to an object");
  }
  return toPlain(raw as TurnState);
}

/**
 * Normalize a Turn_State-shaped value into a canonical plain object with fields
 * in a fixed order and nested arrays rebuilt entry-by-entry. Shared by serialize
 * (to guarantee stable output) and deserialize (to strip extraneous keys).
 */
function toPlain(state: TurnState): TurnState {
  const plain: TurnState = {
    roomId: state.roomId,
    roundNumber: state.roundNumber,
    phase: state.phase,
    readiness: state.readiness.map((entry) => ({
      playerId: entry.playerId,
      status: entry.status,
      actionKind: entry.actionKind,
      actionText: entry.actionText,
    })),
    chatLog: state.chatLog.map((entry) => ({
      playerId: entry.playerId,
      characterName: entry.characterName,
      text: entry.text,
      ts: entry.ts,
      // Carry the room display name through ONLY when present so entries
      // without it serialize/deserialize unchanged (no extraneous key).
      ...(entry.displayName !== undefined ? { displayName: entry.displayName } : {}),
    })),
    checks: state.checks.map((entry) => ({
      characterId: entry.characterId,
      attribute: entry.attribute,
      difficulty: entry.difficulty,
      roll: entry.roll,
      outcome: entry.outcome,
      // Tolerate legacy records lacking the advantage fields: default to a
      // single-roll "none" check so old persisted Turn_State JSON round-trips.
      advantage: entry.advantage ?? "none",
      rolls:
        Array.isArray(entry.rolls) && entry.rolls.length > 0
          ? entry.rolls.map((n) => n)
          : [entry.roll],
      // Tolerate legacy records lacking visibility: default to a public player
      // check so existing persisted Turn_State JSON round-trips unchanged.
      visibility: entry.visibility ?? "player",
    })),
    narrativeContext: state.narrativeContext.map((entry) => ({
      round: entry.round,
      text: entry.text,
    })),
    readyCheckDeadline: state.readyCheckDeadline,
    readyCheckTimeoutMs: state.readyCheckTimeoutMs,
    resolutionRequested: state.resolutionRequested,
  };
  if (Array.isArray(state.rollingChecks)) {
    plain.rollingChecks = state.rollingChecks.map((entry) => ({
      checkId: entry.checkId,
      characterId: entry.characterId,
      ...(entry.characterName !== undefined ? { characterName: entry.characterName } : {}),
      playerId: entry.playerId ?? null,
      attribute: entry.attribute,
      difficulty: entry.difficulty,
      advantage: entry.advantage ?? "none",
      visibility: entry.visibility ?? "player",
      status: entry.status === "rolled" ? "rolled" : "pending",
      ...(entry.roll !== undefined ? { roll: entry.roll } : {}),
      ...(Array.isArray(entry.rolls) ? { rolls: entry.rolls.map((n) => n) } : {}),
      ...(entry.outcome !== undefined ? { outcome: entry.outcome } : {}),
      ...(entry.autoRolled !== undefined ? { autoRolled: entry.autoRolled } : {}),
    }));
  }
  return plain;
}
