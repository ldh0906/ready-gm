/**
 * Transport-agnostic realtime connection abstraction and the server → client
 * event envelope.
 *
 * The {@link RealtimeGateway} is written against the {@link Connection} port —
 * NOT against a concrete WebSocket — so the gateway's connection lifecycle,
 * broadcast, retry, heartbeat, and narration-buffering logic can be unit-tested
 * with a fake in-memory connection and never needs a real network socket. The
 * production binding (a thin `ws` adapter) lives in `ws-connection.ts`.
 *
 * Every server → client message is a {@link ServerEvent}: a JSON-serializable
 * discriminated union keyed on `type`. The gateway delivers `turn_state` on
 * (re)connect (Requirements 13.2, 13.5), broadcasts state/scenario/player/
 * readiness changes (Requirement 13.1, 13.3), pushes narration (Requirement
 * 10.7), and notifies a player with `delivery_failed` when a send fails before
 * retrying (Requirement 6.5).
 *
 * Requirements: 6.5, 10.7, 13.1, 13.2, 13.3, 13.4, 13.5.
 */
import type { ChatEntry, PendingCheck, ReadinessEntry, TurnState } from "../core/turn-state.js";

/** Which narration a {@link NarrationPayload} carries. */
export type NarrationKind = "opening" | "resolution" | "closing";

/** A player-visible Progress Clock snapshot (only sent for clock-visible scenarios). */
export interface VisibleClock {
  name: string;
  value: number;
  max: number;
}

/** A player-visible resolved check snapshot (sent with resolution narration). */
export interface VisibleCheck {
  /** The rule-system attribute key (e.g. "Might", "Sneaky"). */
  attribute: string;
  /**
   * The scenario-localized (Korean) label for {@link attribute}, derived from
   * the sheet schema's trait labels. Falls back to the raw key when no label is
   * defined (e.g. universal EZFudge stats). Lets the client show 은밀함 rather
   * than the raw "Sneaky".
   */
  attributeLabel: string;
  /**
   * The acting character's name (as seen in the sheet). Empty string when the
   * roll cannot be attributed to a known character. Lets the client show who
   * rolls which die and gate a player's own roll behind a "굴리기" button.
   */
  characterName: string;
  difficulty: string;
  advantage: "none" | "advantage" | "disadvantage";
  /** The individual EZFudge totals (length 1 for none, 2 for adv/disadv). */
  rolls: number[];
  /** The chosen total. */
  roll: number;
  outcome: string;
}

/**
 * A piece of GM narration delivered over the channel. Narration generated while
 * no players are connected is buffered and delivered on (re)connect
 * (Requirements 10.7, 13.5).
 */
export interface NarrationPayload {
  kind: NarrationKind;
  /** The round the narration belongs to. */
  roundNumber: number;
  /** The Korean narration text (already validated upstream). */
  text: string;
  /**
   * Current Progress Clock snapshot for the room, present ONLY when the
   * scenario opts into visible clocks. Optional + additive so existing clients
   * that ignore it are unaffected.
   */
  clocks?: VisibleClock[];
  /**
   * The round's player-visible resolved checks, present ONLY on `resolution`
   * narration when at least one public (visibility="player") check was rolled.
   * Lets the client animate the EZFudge dice for the results. Hidden GM rolls
   * are never included. Optional + additive.
   */
  checks?: VisibleCheck[];
  /**
   * The player-visible ScenarioBlackboard projection (discovered clues,
   * visible NPC presence, active threats). Hidden secrets and undiscovered
   * clue conclusions are projected away server-side and never ride along.
   * Optional + additive.
   */
  blackboard?: import("../core/scenario-blackboard.js").VisibleBlackboard;
}

/** A minimal player summary broadcast on roster changes (Requirement 2.5). */
export interface RealtimePlayerSummary {
  id: string;
  displayName: string;
  isHost: boolean;
}

/**
 * The server → client event envelope. A JSON-serializable discriminated union
 * so a concrete transport (WebSocket) can serialize it directly.
 */
export type ServerEvent =
  /** Full current Turn_State, pushed on (re)connect and on change (R13.1–13.5). */
  | { type: "turn_state"; roomId: string; state: TurnState }
  /** A single chat message delivered to room members (Requirement 6.2). */
  | { type: "chat_message"; roomId: string; message: ChatEntry }
  /** GM narration (opening/resolution/closing) (Requirements 5.3, 10.4, 15.5). */
  | { type: "narration"; roomId: string; narration: NarrationPayload }
  /** Per-player readiness snapshot after a readiness change (Requirement 7.3). */
  | { type: "readiness_updated"; roomId: string; readiness: readonly ReadinessEntry[] }
  /** Player-visible checks selected by the GM, before any roll values exist. */
  | { type: "checks_pending"; roomId: string; checks: readonly PendingCheck[] }
  /** One selected check has been rolled by the authoritative server dice service. */
  | { type: "check_rolled"; roomId: string; check: PendingCheck }
  /** The scenario selected for the room (Requirement 3.3). */
  | { type: "scenario_set"; roomId: string; scenarioId: string; title: string; summary: string }
  /** The room roster after a join/leave (Requirement 2.5). */
  | { type: "player_list_updated"; roomId: string; players: readonly RealtimePlayerSummary[] }
  /** Notice to a player that a message failed to reach them before retry (R6.5). */
  | { type: "delivery_failed"; roomId: string; failedType: ServerEvent["type"]; detail: string }
  /** Explicit notice that narration generation failed (opening/ending, or a
   *  round resolution whose automatic retries are exhausted) and can be retried. */
  | {
      type: "narration_failed";
      roomId: string;
      phase: "opening" | "ending" | "resolution";
      reason: string;
      retryable: boolean;
    };

/**
 * A transport-agnostic, single-player connection to a room.
 *
 * Implementations wrap one underlying transport (e.g. a `ws` WebSocket). The
 * gateway treats {@link send} as synchronous and fail-fast: it MUST throw when
 * the message cannot be handed to the transport (e.g. the socket is not open)
 * so the gateway can run its notify-and-retry policy (Requirement 6.5).
 */
export interface Connection {
  /** Stable identifier for this connection (one per socket). */
  readonly id: string;
  /** The room this connection belongs to. */
  readonly roomId: string;
  /** The player behind this connection. */
  readonly playerId: string;
  /**
   * Hand a {@link ServerEvent} to the transport. MUST throw synchronously when
   * delivery cannot be attempted (closed/broken transport) so the caller can
   * notify the player and retry (Requirement 6.5).
   */
  send(event: ServerEvent): void;
  /** Send a liveness probe; the peer is expected to answer (Requirement 13.4). */
  ping(): void;
  /** Close the underlying transport (forces client-side re-establishment). */
  close(code?: number, reason?: string): void;
  /**
   * Register a handler invoked for ANY inbound traffic (data or pong). The
   * gateway uses this purely as a liveness signal for the heartbeat sweep.
   */
  onMessage(handler: (raw: string) => void): void;
  /** Register a handler invoked when the transport closes. */
  onClose(handler: () => void): void;
}
