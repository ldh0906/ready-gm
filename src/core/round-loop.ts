/**
 * Round-loop reducer — the pure state machine that drives a session round.
 *
 * This module implements the Turn_State round loop described in design.md
 * ("Round Loop State Machine" and "Turn_State (JSON short-term memory)") as a
 * single **pure** function:
 *
 * ```ts
 * reduce(state: TurnState, command: Command): TurnState
 * ```
 *
 * It performs no I/O, reads no clock, and never mutates its inputs. Anything the
 * machine cannot derive on its own — the current time / ready-check deadline,
 * whether an external Auto_Pass attempt failed, the AI's resolution narration —
 * is carried *inside the command*. This keeps the orchestrator (the impure
 * single-writer actor) responsible for transport, timers, and the AI call, while
 * the state-machine semantics stay deterministic and exhaustively testable.
 *
 * Phase transitions (design.md round-loop diagram):
 *
 * ```
 * free_chat --first readiness submission--> ready_check
 * ready_check --confirm/pass/revise/auto-pass--> ready_check
 * ready_check --all active ready OR force-proceed--> resolving
 * resolving --readiness reverts mid-resolution--> ready_check (halt)
 * resolving --resolution delivered--> free_chat (round N+1)
 * resolving --ending condition reached--> ended (terminal)
 * ```
 *
 * The set of **active players** is exactly the set of {@link ReadinessEntry}
 * rows in the Turn_State; `START_SESSION` seeds that roster. Membership checks,
 * the all-ready gate, and the at-most-once resolution guard all read from it.
 *
 * Requirements: 5.4, 6.1, 6.3, 6.4, 7.1, 7.2, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9,
 * 8.1, 8.2, 8.5, 9.2, 9.3, 9.4, 10.3, 10.5, 11.5, 13.6, 15.4, 15.6, 15.7, 16.1.
 */
import type { ActionKind, ReadinessStatus } from "./types.js";
import type {
  CheckRecord,
  ChatEntry,
  ReadinessEntry,
  TurnState,
} from "./turn-state.js";

/** A player identity. Opaque string assigned by the Room Service. */
export type PlayerId = string;

/**
 * Host starts the session: initialize Round 1 and seed the active-player
 * readiness roster (Requirement 5.4). Rejected on an `ended` Turn_State so an
 * ended room cannot be restarted (Requirement 15.7).
 */
export interface StartSessionCommand {
  type: "START_SESSION";
  /** The player invoking the start. */
  by: PlayerId;
  /**
   * The room's host. Start is host-only: a mismatch between `by` and `hostId`
   * leaves the Turn_State unchanged (Requirement 5.2), mirroring the
   * {@link ForceProceedCommand} host gate.
   */
  hostId: PlayerId;
  /** The active players for the session; one readiness entry is seeded each. */
  activePlayers: PlayerId[];
}

/**
 * A free-chat message (Requirements 6.1, 6.3, 6.4). Accepted only while the
 * round is in `free_chat` and only from an active room member; appended to the
 * current round's `chatLog` in send order, attributed to the sender's character.
 */
export interface SendChatCommand {
  type: "SEND_CHAT";
  from: PlayerId;
  /** The sender's character name used for attribution (R6.3). */
  characterName: string;
  text: string;
  /** ISO timestamp supplied by the caller — the reducer reads no clock. */
  ts: string;
}

/**
 * Confirm an action for the current round (Requirement 7.1). Marks the player
 * ready with `actionKind = "confirmed_action"` and stores the action text. The
 * first submission of a round opens the ready-check gate (`free_chat` ->
 * `ready_check`) and arms the countdown using {@link ConfirmActionCommand.deadline}.
 */
export interface ConfirmActionCommand {
  type: "CONFIRM_ACTION";
  from: PlayerId;
  /** The confirmed action text. */
  action: string;
  /** ISO deadline to arm when this submission opens the gate (R8.1); may be `null`. */
  deadline: string | null;
}

/**
 * Pass for the current round (Requirement 7.2). Marks the player ready with
 * `actionKind = "pass"` and no action text. Like confirm, the first submission
 * opens the ready-check gate and arms the countdown.
 */
export interface PassCommand {
  type: "PASS";
  from: PlayerId;
  /** ISO deadline to arm when this submission opens the gate (R8.1); may be `null`. */
  deadline: string | null;
}

/**
 * Revise a prior submission (Requirement 7.6) or revert readiness to not-ready.
 *
 * - `action: string` — revise the confirmed action. Accepted while
 *   `ready_check`; **rejected (no-op) while `resolving`** because controls are
 *   locked once resolution begins (Requirement 7.8).
 * - `action: null` — revert to not-ready. Accepted while `ready_check`; while
 *   `resolving` an accepted revert **halts** the in-progress resolution and
 *   returns the round to `ready_check` (Requirement 7.9).
 */
export interface ReviseCommand {
  type: "REVISE";
  from: PlayerId;
  /** New action text, or `null` to revert readiness to not-ready. */
  action: string | null;
}

/**
 * The ready-check countdown elapsed for a player (Requirements 8.1, 8.2, 8.5).
 * Applies an Auto_Pass (`actionKind = "auto_pass"`, distinguishable from a
 * manual pass) and marks the player ready. The expiry decision is made by the
 * caller's timer; the reducer holds no clock.
 */
export interface TimeoutExpiredCommand {
  type: "TIMEOUT_EXPIRED";
  player: PlayerId;
}

/**
 * Host force-proceed (Requirements 9.2, 9.3, 9.4). Auto-passes every unready
 * active player and triggers resolution exactly once. Restricted to the host:
 * the command carries both the invoker (`by`) and the room's `hostId`, and a
 * mismatch leaves the Turn_State unchanged. If the caller's external Auto_Pass
 * attempts failed for any players, it reports them via
 * {@link ForceProceedCommand.failedAutoPasses} and the action aborts with no
 * partial state change (Requirement 9.3).
 */
export interface ForceProceedCommand {
  type: "FORCE_PROCEED";
  by: PlayerId;
  hostId: PlayerId;
  /** Players whose Auto_Pass failed externally; non-empty aborts the action (R9.3). */
  failedAutoPasses?: PlayerId[];
}

/**
 * Successful AI GM resolution delivery (Requirements 10.5, 11.5, 15.4).
 * Applied only while `resolving` with the resolution guard set; a stale delivery
 * (e.g. after a mid-resolution halt) is ignored. Records the resolved checks,
 * appends the narration to recent narrative context, then either advances to the
 * next round's `free_chat` or, when the scenario ending condition was reached,
 * transitions to the terminal `ended` phase.
 */
export interface ResolutionReadyCommand {
  type: "RESOLUTION_READY";
  /** The AI GM resolution narration for the round. */
  narration: string;
  /** Checks resolved during this round (recorded into Turn_State, R11.5). */
  checks: CheckRecord[];
  /** Whether the scenario ending condition was reached (R15.4). */
  endingReached: boolean;
}

/** The discriminated union of every command the round-loop reducer accepts. */
export type Command =
  | StartSessionCommand
  | SendChatCommand
  | ConfirmActionCommand
  | PassCommand
  | ReviseCommand
  | TimeoutExpiredCommand
  | ForceProceedCommand
  | ResolutionReadyCommand;

/** Default ready-check timeout in ms (Requirement 8.4). */
const DEFAULT_READY_CHECK_TIMEOUT_MS = 90000;

/**
 * Build a pre-start {@link TurnState} for a room. Round number is `0` and the
 * roster is empty until `START_SESSION` seeds Round 1 (Requirement 5.4).
 * Overrides are applied last so tests can pin any field.
 */
export function createInitialTurnState(
  roomId: string,
  overrides: Partial<TurnState> = {},
): TurnState {
  return {
    roomId,
    roundNumber: 0,
    phase: "free_chat",
    readiness: [],
    chatLog: [],
    checks: [],
    narrativeContext: [],
    readyCheckDeadline: null,
    readyCheckTimeoutMs: DEFAULT_READY_CHECK_TIMEOUT_MS,
    resolutionRequested: false,
    ...overrides,
  };
}

/** Whether `playerId` is an active player (has a readiness row). */
function isMember(state: TurnState, playerId: PlayerId): boolean {
  return state.readiness.some((entry) => entry.playerId === playerId);
}

/**
 * Every active player is ready. Returns `false` for an empty roster so a round
 * never resolves with no players (the all-ready gate requires real consensus).
 */
function allActiveReady(state: TurnState): boolean {
  return state.readiness.length > 0 && state.readiness.every((entry) => entry.status === "ready");
}

/** Return a copy of `state` with one player's readiness fields patched. */
function patchReadiness(
  state: TurnState,
  playerId: PlayerId,
  status: ReadinessStatus,
  actionKind: ActionKind,
  actionText: string | null,
): TurnState {
  return {
    ...state,
    readiness: state.readiness.map((entry) =>
      entry.playerId === playerId ? { playerId, status, actionKind, actionText } : entry,
    ),
  };
}

/**
 * The at-most-once resolution guard (Requirements 7.5, 10.3, 16.1). When the
 * round is gathering readiness and every active player is ready, atomically
 * check-and-set `resolutionRequested` and enter `resolving`. If the guard is
 * already set, or not all players are ready, the state is returned unchanged so
 * no second resolution is ever triggered.
 */
function maybeTriggerResolution(state: TurnState): TurnState {
  if (state.phase === "ready_check" && allActiveReady(state) && !state.resolutionRequested) {
    return { ...state, phase: "resolving", resolutionRequested: true, readyCheckDeadline: null };
  }
  return state;
}

/** Compile-time exhaustiveness guard for the command union. */
function assertNever(command: never): never {
  throw new TypeError(`Unhandled round-loop command: ${JSON.stringify(command)}`);
}

/**
 * Apply a single {@link Command} to a {@link TurnState}, returning the next
 * state. Pure and total: every command maps to a defined next state, and a
 * command that is not applicable in the current phase is a no-op that returns
 * the input state unchanged.
 */
export function reduce(state: TurnState, command: Command): TurnState {
  switch (command.type) {
    case "START_SESSION": {
      // An ended room is terminal: reject start/restart (R15.7).
      if (state.phase === "ended") return state;
      // Host-only: a non-host invocation leaves the Turn_State unchanged (R5.2).
      if (command.by !== command.hostId) return state;
      const readiness: ReadinessEntry[] = command.activePlayers.map((playerId) => ({
        playerId,
        status: "not_ready",
        actionKind: null,
        actionText: null,
      }));
      // Initialize Round 1 with free-chat active (R5.4).
      return {
        ...state,
        roundNumber: 1,
        phase: "free_chat",
        readiness,
        chatLog: [],
        checks: [],
        narrativeContext: [],
        readyCheckDeadline: null,
        resolutionRequested: false,
      };
    }

    case "SEND_CHAT": {
      // Chat is accepted only during free-chat (R6.1) and only from members.
      if (state.phase !== "free_chat") return state;
      if (!isMember(state, command.from)) return state;
      const entry: ChatEntry = {
        playerId: command.from,
        characterName: command.characterName,
        text: command.text,
        ts: command.ts,
      };
      // Append in send order, attributed to the sender's character (R6.3, R6.4).
      return { ...state, chatLog: [...state.chatLog, entry] };
    }

    case "CONFIRM_ACTION": {
      if (state.phase === "ended") return state; // terminal
      if (state.phase === "resolving") return state; // controls locked (R7.8)
      if (!isMember(state, command.from)) return state;
      let next = state;
      // First submission of the round opens the ready-check gate and arms the
      // countdown for not-ready players (R8.1).
      if (next.phase === "free_chat") {
        next = { ...next, phase: "ready_check", readyCheckDeadline: command.deadline };
      }
      // Record the confirmed action and mark ready (R7.1).
      next = patchReadiness(next, command.from, "ready", "confirmed_action", command.action);
      return maybeTriggerResolution(next);
    }

    case "PASS": {
      if (state.phase === "ended") return state; // terminal
      if (state.phase === "resolving") return state; // controls locked (R7.8)
      if (!isMember(state, command.from)) return state;
      let next = state;
      if (next.phase === "free_chat") {
        next = { ...next, phase: "ready_check", readyCheckDeadline: command.deadline };
      }
      // Mark ready with no action text (R7.2).
      next = patchReadiness(next, command.from, "ready", "pass", null);
      return maybeTriggerResolution(next);
    }

    case "REVISE": {
      if (state.phase === "ended") return state; // terminal
      if (!isMember(state, command.from)) return state;
      // Nothing has been submitted yet in free-chat, so there is nothing to revise.
      if (state.phase === "free_chat") return state;

      if (state.phase === "resolving") {
        // Editing an action is locked once resolution begins (R7.8).
        if (command.action !== null) return state;
        // A readiness revert halts the in-progress resolution: discard the
        // pending narration (held externally), clear the guard, and return to
        // ready-check (R7.9).
        const reverted = patchReadiness(state, command.from, "not_ready", null, null);
        return { ...reverted, phase: "ready_check", resolutionRequested: false };
      }

      // ready_check: revise the submission until resolution begins (R7.6).
      const next =
        command.action === null
          ? patchReadiness(state, command.from, "not_ready", null, null)
          : patchReadiness(state, command.from, "ready", "confirmed_action", command.action);
      return maybeTriggerResolution(next);
    }

    case "TIMEOUT_EXPIRED": {
      // The countdown only runs during ready-check (R8.1).
      if (state.phase !== "ready_check") return state;
      if (!isMember(state, command.player)) return state;
      const entry = state.readiness.find((row) => row.playerId === command.player);
      // An already-ready player keeps their submission; the timeout is moot.
      if (entry && entry.status === "ready") return state;
      // Apply an Auto_Pass distinguishable from a manual pass (R8.2, R8.5).
      const next = patchReadiness(state, command.player, "ready", "auto_pass", null);
      return maybeTriggerResolution(next);
    }

    case "FORCE_PROCEED": {
      if (state.phase === "ended") return state; // terminal
      // Host-only: a non-host invocation leaves the Turn_State unchanged (R9.4).
      if (command.by !== command.hostId) return state;
      // Abort with no partial state if any external Auto_Pass failed (R9.3).
      if (command.failedAutoPasses && command.failedAutoPasses.length > 0) return state;
      // Force is meaningful only while still awaiting readiness.
      if (state.phase !== "free_chat" && state.phase !== "ready_check") return state;
      // Require at least one active player already ready: the host force-proceeds
      // a round others are holding up, not an empty round nobody has acted in
      // (R9.2). In practice this also blocks `free_chat`, where no one is ready.
      if (!state.readiness.some((entry) => entry.status === "ready")) return state;
      // At-most-once guard: do not re-trigger if resolution is already requested.
      if (state.resolutionRequested) return state;
      // Auto-pass every unready active player (R9.2).
      const readiness: ReadinessEntry[] = state.readiness.map((entry) =>
        entry.status === "ready"
          ? entry
          : { playerId: entry.playerId, status: "ready", actionKind: "auto_pass", actionText: null },
      );
      return {
        ...state,
        readiness,
        phase: "resolving",
        resolutionRequested: true,
        readyCheckDeadline: null,
      };
    }

    case "RESOLUTION_READY": {
      // Only a resolution that is still in flight is honored; a stale delivery
      // (e.g. after a mid-resolution revert/halt) is ignored (R7.9, R10.3).
      if (state.phase !== "resolving" || !state.resolutionRequested) return state;
      const checks: CheckRecord[] = command.checks.map((check) => ({ ...check }));
      const narrativeContext = [
        ...state.narrativeContext,
        { round: state.roundNumber, text: command.narration },
      ];

      if (command.endingReached) {
        // Ending condition reached during resolution: become terminal (R15.4, R15.6).
        return {
          ...state,
          phase: "ended",
          checks,
          narrativeContext,
          resolutionRequested: false,
          readyCheckDeadline: null,
        };
      }

      // Advance to the next round's free-chat (R10.5); reset per-round fields.
      // `checks` holds the checks resolved THIS round, so it is cleared for the
      // new round exactly like `chatLog` — the resolved checks are already
      // reflected in the appended narration. Leaving them would leak the prior
      // round's rolls into the next round's AI GM context.
      const readiness: ReadinessEntry[] = state.readiness.map((entry) => ({
        playerId: entry.playerId,
        status: "not_ready",
        actionKind: null,
        actionText: null,
      }));
      return {
        ...state,
        roundNumber: state.roundNumber + 1,
        phase: "free_chat",
        readiness,
        chatLog: [],
        checks: [],
        narrativeContext,
        readyCheckDeadline: null,
        resolutionRequested: false,
      };
    }

    default:
      return assertNever(command);
  }
}

/**
 * Fold a sequence of commands over a starting state. Because the reducer is the
 * single writer, applying readiness commands in any received order converges to
 * a Turn_State that reflects each player's final submission (Requirement 13.6).
 */
export function reduceMany(state: TurnState, commands: readonly Command[]): TurnState {
  return commands.reduce<TurnState>((current, command) => reduce(current, command), state);
}
