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
  AttributeKey,
  DifficultyGrade,
  OutcomeGrade,
  Phase,
  ReadinessStatus,
} from "./types.js";

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
}

/** A single in-round chat message, attributed to the sender's character (R6.3, R6.4). */
export interface ChatEntry {
  playerId: string;
  characterName: string;
  text: string;
  /** ISO timestamp string; ordering is by array position (send order). */
  ts: string;
}

/**
 * A check resolved this round. The recorded `outcome` always equals
 * `resolveCheck(attribute, difficulty, roll)` (Requirements 11.3, 11.5).
 */
export interface CheckRecord {
  characterId: string;
  attribute: AttributeKey;
  difficulty: DifficultyGrade;
  /** Server-side dice result (R11.2). */
  roll: number;
  outcome: OutcomeGrade;
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
  /** Recent narrative context, newest last (R12.2). */
  narrativeContext: NarrativeContextEntry[];
  /** ISO deadline for the ready-check countdown, or `null` when not running (R8.1, R8.3). */
  readyCheckDeadline: string | null;
  /** Ready-check timeout in ms; default 90000 (R8.4). */
  readyCheckTimeoutMs: number;
  /** At-most-once resolution guard (R10.3, R16.1). */
  resolutionRequested: boolean;
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
  return {
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
    })),
    checks: state.checks.map((entry) => ({
      characterId: entry.characterId,
      attribute: entry.attribute,
      difficulty: entry.difficulty,
      roll: entry.roll,
      outcome: entry.outcome,
    })),
    narrativeContext: state.narrativeContext.map((entry) => ({
      round: entry.round,
      text: entry.text,
    })),
    readyCheckDeadline: state.readyCheckDeadline,
    readyCheckTimeoutMs: state.readyCheckTimeoutMs,
    resolutionRequested: state.resolutionRequested,
  };
}
