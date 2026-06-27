/**
 * Room Orchestrator — the per-room actor that is the SINGLE WRITER of a room's
 * Turn_State (design.md "3. Session Orchestrator (Round Loop)").
 *
 * The orchestrator is the impure shell around the pure {@link reduce} round-loop
 * reducer. It wires four things together so a full round can flow
 * `free-chat → ready-check → resolution → next round`:
 *
 *  1. **Inbound client commands**, accepted via {@link RoomOrchestrator.dispatch}
 *     and processed STRICTLY SEQUENTIALLY per room through an in-order async
 *     queue (a per-room promise chain). Sequential processing is how concurrent
 *     readiness changes are made convergent and how "at most one resolution per
 *     round" stays true under races (Requirement 13.6).
 *  2. **The Turn_State Store** — every command loads the room's current
 *     Turn_State, applies the reducer, and (on change) persists the new state
 *     before broadcasting it via the gateway (Requirements 10.5, 13.x).
 *  3. **The AI GM Coordinator** — when the reduced state enters `resolving`, the
 *     orchestrator runs the round resolution OUTSIDE the per-room lock (so a
 *     mid-resolution readiness revert can still be processed to halt it,
 *     Requirement 7.9) and feeds the result back as a serialized
 *     `RESOLUTION_READY`, guarded by the reducer's at-most-once
 *     `resolutionRequested` flag (Requirements 10.1, 10.5). Opening narration is
 *     generated on `START_SESSION` (Requirements 5.2, 5.3) and the closing
 *     narration + Session_Summary on an ending (Requirements 15.1, 15.2, 15.5).
 *  4. **A configured EventSink** — a best-effort `round_timing` QA event is
 *     emitted once per resolved round, capturing the moment all players became
 *     ready (resolution entered) and the moment GM narration returned, for
 *     latency analysis. Emission never blocks or fails the round.
 *
 * The gateway and coordinator are consumed through the narrow {@link
 * OrchestratorGateway} / {@link OrchestratorCoordinator} ports so the actor is
 * fully unit-testable with fakes; the production wiring lives in
 * {@link import("./engine.js").createEngine}.
 *
 * Requirements: 5.2, 5.3, 10.1, 10.4, 10.5, 13.6, 15.1, 15.2, 15.5, 18.5.
 */
import {
  createInitialTurnState,
  reduce,
  type Command,
  type PlayerId,
} from "../core/round-loop.js";
import type { TurnState } from "../core/turn-state.js";
import type { EngineConfig } from "../core/types.js";
import { DEFAULT_ENGINE_CONFIG } from "../core/config.js";
import type { TurnStateStore } from "../services/turn-state-store.js";
import type { Character, Player, Room } from "../services/types.js";
import type { Scenario } from "../services/scenario-service.js";
import {
  toContext,
  type TurnStateContext,
} from "../services/turn-state-context.js";
import type {
  GenerationResult,
  Narration,
  ResolveRoundInput,
  ResolveRoundResult,
  SessionSummary,
} from "../ai/ai-gm-coordinator.js";
import type { EventSink } from "../observability/event-sink.js";
import {
  makeRoundTimingEvent,
  type CorrelationKey,
  type EnvelopeGenerators,
} from "../observability/events.js";
import type { NarrationPayload } from "./connection.js";
import type { SessionSummaryRepository } from "../persistence/types.js";

/**
 * The client-facing command surface the orchestrator accepts. It mirrors the
 * design's inbound `RoomCommand` MINUS the server-supplied fields (active-player
 * roster, ready-check deadline, host id, chat attribution/timestamp) which the
 * orchestrator injects from room context and the clock, and MINUS the
 * internal-only `RESOLUTION_READY` (the orchestrator issues that itself).
 */
export type OrchestratorCommand =
  | { type: "START_SESSION"; by: PlayerId }
  | { type: "SEND_CHAT"; from: PlayerId; text: string }
  | { type: "CONFIRM_ACTION"; from: PlayerId; action: string }
  | { type: "PASS"; from: PlayerId }
  | { type: "REVISE"; from: PlayerId; action: string | null }
  | { type: "TIMEOUT_EXPIRED"; player: PlayerId }
  | { type: "FORCE_PROCEED"; by: PlayerId };

/**
 * The slice of the realtime gateway the orchestrator drives. {@link
 * import("./gateway.js").RealtimeGateway} satisfies this structurally.
 */
export interface OrchestratorGateway {
  /** Broadcast the room's current Turn_State to every connection (R13.1). */
  broadcastTurnState(roomId: string): void;
  /** Deliver GM narration (buffered when the room is empty) (R10.4, R10.7). */
  deliverNarration(roomId: string, narration: NarrationPayload): void;
}

/**
 * The slice of the AI GM Coordinator the orchestrator drives. {@link
 * import("../ai/ai-gm-coordinator.js").AiGmCoordinator} satisfies this.
 */
export interface OrchestratorCoordinator {
  resolveRound(input: ResolveRoundInput): Promise<ResolveRoundResult>;
  generateOpening(
    ctx: TurnStateContext,
    correlation?: CorrelationKey,
  ): Promise<GenerationResult<Narration>>;
  generateEnding(
    ctx: TurnStateContext,
    correlation?: CorrelationKey,
  ): Promise<GenerationResult<{ closing: Narration; summary: SessionSummary }>>;
}

/** Read-only room data the orchestrator needs to enrich commands and context. */
export interface RoomReader {
  getRoom(roomId: string): Room | undefined;
  listPlayers(roomId: string): Player[];
  listCharactersByRoom(roomId: string): Character[];
  /**
   * Optionally persist a room. When present, the orchestrator marks the room
   * `ended` after the closing summary is produced (Requirement 15.6). Omitting
   * it simply skips the durable transition. {@link
   * import("../services/room-store.js").RoomStore} provides it.
   */
  saveRoom?(room: Room): void;
}

/** Resolves the effective scenario for a room (explicit selection or default). */
export interface ScenarioResolver {
  getSelectedScenario(roomId: string): Scenario | null;
}

/** Construction dependencies for {@link RoomOrchestrator}. */
export interface RoomOrchestratorDeps {
  /** Canonical Turn_State store (Redis live / Postgres durable behind the port). */
  store: TurnStateStore;
  /** Realtime fan-out for Turn_State + narration. */
  gateway: OrchestratorGateway;
  /** AI GM coordinator for opening / resolution / ending narration. */
  coordinator: OrchestratorCoordinator;
  /** Read access to rooms, players, and characters. */
  roomReader: RoomReader;
  /** Resolves the room's scenario grounding. */
  scenarioResolver: ScenarioResolver;
  /** Durable Session_Summary persistence (Requirement 15.3). */
  sessionSummaryRepository: SessionSummaryRepository;
  /** Best-effort QA event sink; defaults to no emission. */
  eventSink?: EventSink;
  /** Engine config (ready-check timeout, resolution token budget). */
  config?: EngineConfig;
  /** Clock; defaults to wall-clock. Injectable for deterministic tests. */
  now?: () => Date;
  /** Deterministic envelope generators for QA events (tests). */
  generators?: EnvelopeGenerators;
}

/**
 * The per-room single-writer actor. One instance serves many rooms; each room
 * has its own in-order command queue so writes never interleave within a room.
 */
export class RoomOrchestrator {
  private readonly store: TurnStateStore;
  private readonly gateway: OrchestratorGateway;
  private readonly coordinator: OrchestratorCoordinator;
  private readonly roomReader: RoomReader;
  private readonly scenarioResolver: ScenarioResolver;
  private readonly sessionSummaryRepository: SessionSummaryRepository;
  private readonly eventSink: EventSink | undefined;
  private readonly config: EngineConfig;
  private readonly now: () => Date;
  private readonly generators: EnvelopeGenerators | undefined;

  /** Per-room serialization chain (the single-writer queue). */
  private readonly tails = new Map<string, Promise<void>>();
  /** Every in-flight activity (queued tasks + out-of-lock AI work) for {@link whenSettled}. */
  private readonly pending = new Set<Promise<unknown>>();
  /** `${roomId}:${roundNo}` → ISO timestamp the round entered resolving (all-ready). */
  private readonly allReadyAt = new Map<string, string>();

  constructor(deps: RoomOrchestratorDeps) {
    this.store = deps.store;
    this.gateway = deps.gateway;
    this.coordinator = deps.coordinator;
    this.roomReader = deps.roomReader;
    this.scenarioResolver = deps.scenarioResolver;
    this.sessionSummaryRepository = deps.sessionSummaryRepository;
    this.eventSink = deps.eventSink;
    this.config = deps.config ?? DEFAULT_ENGINE_CONFIG;
    this.now = deps.now ?? (() => new Date());
    this.generators = deps.generators;
  }

  /**
   * Accept one inbound client command for a room and process it on the room's
   * serial queue. Resolves once THIS command's synchronous state transition has
   * been applied and broadcast; any AI resolution it triggers runs outside the
   * lock — await {@link whenSettled} to also drain that work (e.g. in tests).
   */
  dispatch(roomId: string, command: OrchestratorCommand): Promise<void> {
    return this.enqueue(roomId, () => this.applyClientCommand(roomId, command));
  }

  /**
   * Resolve once there is no in-flight activity across all rooms: queued
   * commands, AI calls, ending generation, and summary persistence. Intended
   * for tests to make the otherwise-async cascade observable.
   */
  async whenSettled(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }

  /** The current Turn_State for a room (convenience passthrough). */
  getTurnState(roomId: string): TurnState | undefined {
    return this.store.get(roomId);
  }

  // -------------------------------------------------------------------------
  // Serialization queue
  // -------------------------------------------------------------------------

  /**
   * Append a task to the room's serial chain so writes never interleave within
   * a room. The chain itself never rejects (each link's failure is swallowed)
   * so one failed task cannot wedge the queue; the returned promise mirrors the
   * task's own settlement for callers that wish to await it.
   */
  private enqueue(roomId: string, task: () => Promise<void> | void): Promise<void> {
    const previous = this.tails.get(roomId) ?? Promise.resolve();
    const run = previous.then(() => task());
    // The chain tail must never be a rejected promise or the next task is skipped.
    this.tails.set(
      roomId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    this.track(run);
    return run;
  }

  /** Register an activity so {@link whenSettled} can await it; auto-removed on settle. */
  private track<T>(promise: Promise<T>): void {
    this.pending.add(promise);
    void promise
      .catch(() => undefined)
      .finally(() => {
        this.pending.delete(promise);
      });
  }

  // -------------------------------------------------------------------------
  // Command application (runs INSIDE the per-room lock)
  // -------------------------------------------------------------------------

  /**
   * Apply one client command: load → enrich → reduce → (on change) persist +
   * broadcast, then detect phase transitions that need AI work (opening on
   * start, resolution on entering `resolving`). The AI work is launched OUTSIDE
   * this lock so a concurrent revert can still halt an in-flight resolution.
   */
  private applyClientCommand(roomId: string, command: OrchestratorCommand): void {
    const before = this.loadState(roomId);
    const reducerCommand = this.toReducerCommand(roomId, before, command);
    if (reducerCommand === null) return;

    const after = reduce(before, reducerCommand);
    // The reducer returns the same reference for inapplicable (no-op) commands.
    if (after === before) return;

    this.store.save(after);
    this.gateway.broadcastTurnState(roomId);

    // Session start: generate + deliver the opening narration (R5.2, R5.3).
    if (
      command.type === "START_SESSION" &&
      after.roundNumber === 1 &&
      before.roundNumber !== 1
    ) {
      this.launchOpening(roomId, after);
    }

    // Entered resolution: kick off the at-most-once round resolution (R10.1).
    const enteredResolving =
      before.phase !== "resolving" && after.phase === "resolving" && after.resolutionRequested;
    if (enteredResolving) {
      const allReadyAtIso = this.nowIso();
      this.allReadyAt.set(timingKey(roomId, after.roundNumber), allReadyAtIso);
      this.launchResolution(roomId, after, allReadyAtIso);
    }
  }

  /** Load the room's Turn_State, or a fresh pre-start state seeded with config. */
  private loadState(roomId: string): TurnState {
    return (
      this.store.get(roomId) ??
      createInitialTurnState(roomId, { readyCheckTimeoutMs: this.config.readyCheckTimeoutMs })
    );
  }

  /**
   * Enrich a client command into the pure-reducer {@link Command}, injecting the
   * server-owned fields. Returns `null` when the command cannot be formed (e.g.
   * a force-proceed for a room with no known host).
   */
  private toReducerCommand(
    roomId: string,
    state: TurnState,
    command: OrchestratorCommand,
  ): Command | null {
    switch (command.type) {
      case "START_SESSION": {
        // Host-only start: inject the room's host so the reducer can gate it
        // (R5.2). A room with no known host cannot be started.
        const hostId = this.roomReader.getRoom(roomId)?.hostPlayerId;
        if (hostId === undefined) return null;
        return {
          type: "START_SESSION",
          by: command.by,
          hostId,
          activePlayers: this.roomReader.listPlayers(roomId).map((player) => player.id),
        };
      }
      case "SEND_CHAT":
        return {
          type: "SEND_CHAT",
          from: command.from,
          characterName: this.characterNameFor(roomId, command.from) ?? command.from,
          text: command.text,
          ts: this.nowIso(),
        };
      case "CONFIRM_ACTION":
        return {
          type: "CONFIRM_ACTION",
          from: command.from,
          action: command.action,
          deadline: this.deadlineFor(state),
        };
      case "PASS":
        return { type: "PASS", from: command.from, deadline: this.deadlineFor(state) };
      case "REVISE":
        return { type: "REVISE", from: command.from, action: command.action };
      case "TIMEOUT_EXPIRED":
        return { type: "TIMEOUT_EXPIRED", player: command.player };
      case "FORCE_PROCEED": {
        const hostId = this.roomReader.getRoom(roomId)?.hostPlayerId;
        if (hostId === undefined) return null;
        return { type: "FORCE_PROCEED", by: command.by, hostId };
      }
      default:
        return assertNever(command);
    }
  }

  // -------------------------------------------------------------------------
  // Opening narration (runs OUTSIDE the lock)
  // -------------------------------------------------------------------------

  /** Generate and deliver the session opening narration (Requirements 5.2, 5.3). */
  private launchOpening(roomId: string, startedState: TurnState): void {
    this.track(
      (async () => {
        const scenario = this.scenarioResolver.getSelectedScenario(roomId);
        if (scenario === null) return;
        const ctx = toContext(startedState, scenario, this.charactersFor(roomId));
        const result = await this.coordinator.generateOpening(ctx, correlationFor(startedState));
        if (!result.ok) return; // Withheld on failure; nothing to deliver (R14.4).
        this.gateway.deliverNarration(roomId, {
          kind: "opening",
          roundNumber: startedState.roundNumber,
          text: result.value,
        });
      })(),
    );
  }

  // -------------------------------------------------------------------------
  // Round resolution (AI call OUTSIDE the lock; application serialized)
  // -------------------------------------------------------------------------

  /**
   * Resolve a round: run the AI coordinator OUTSIDE the per-room lock, then feed
   * the outcome back through the queue so its application is serialized and
   * guarded by the reducer's at-most-once `resolutionRequested` flag. Keeping
   * the AI call out of the lock lets a concurrent readiness revert halt the
   * in-flight resolution (Requirement 7.9).
   */
  private launchResolution(roomId: string, resolving: TurnState, allReadyAtIso: string): void {
    this.track(
      (async () => {
        const scenario = this.scenarioResolver.getSelectedScenario(roomId);
        if (scenario === null) {
          await this.enqueue(roomId, () => this.applyResolutionFailure(roomId));
          return;
        }
        const result = await this.coordinator.resolveRound({
          state: resolving,
          scenario,
          characters: this.charactersFor(roomId),
          budget: this.config.tokenBudgets.resolution,
        });
        const narrationReturnedAtIso = this.nowIso();
        await this.enqueue(roomId, () =>
          this.applyResolutionResult(
            roomId,
            resolving.roundNumber,
            allReadyAtIso,
            narrationReturnedAtIso,
            result,
          ),
        );
      })(),
    );
  }

  /**
   * Apply the resolution outcome on the serial queue. A success is committed via
   * the reducer's `RESOLUTION_READY` (which is a no-op if the round was halted
   * meanwhile, discarding the stale narration — R7.9); a failure reverts to
   * `ready_check` while preserving the round's recorded actions (R17.2, R17.4).
   */
  private applyResolutionResult(
    roomId: string,
    roundNumber: number,
    allReadyAtIso: string,
    narrationReturnedAtIso: string,
    result: ResolveRoundResult,
  ): void {
    const current = this.loadState(roomId);

    if (!result.ok) {
      this.revertFailedResolution(roomId, current);
      return;
    }

    // Stale delivery (e.g. a mid-resolution revert already halted this round):
    // discard the narration and do nothing (R7.9, R10.3).
    if (current.phase !== "resolving" || !current.resolutionRequested) return;

    const next = reduce(current, {
      type: "RESOLUTION_READY",
      narration: result.narration,
      checks: result.checks,
      endingReached: result.endingReached,
    });
    if (next === current) return; // Guard rejected the delivery; nothing committed.

    this.store.save(next);
    this.gateway.broadcastTurnState(roomId);

    // Deliver the resolution narration for the round just resolved (R10.4, R15.5).
    this.gateway.deliverNarration(roomId, {
      kind: "resolution",
      roundNumber,
      text: result.narration,
    });

    // Best-effort latency event for the round (all-ready → narration-returned).
    this.emitRoundTiming(roomId, roundNumber, allReadyAtIso, narrationReturnedAtIso);
    this.allReadyAt.delete(timingKey(roomId, roundNumber));

    // Ending reached during resolution: produce closing + Session_Summary (R15.x).
    if (next.phase === "ended") {
      this.launchEnding(roomId, next);
    }
  }

  /**
   * Revert a failed resolution back to `ready_check`, clearing the at-most-once
   * guard while keeping every recorded action/pass so the round can be retried
   * without losing input (Requirements 17.2, 17.4). No-op if the round already
   * left `resolving` (e.g. halted by a revert).
   */
  private revertFailedResolution(roomId: string, current: TurnState): void {
    if (current.phase !== "resolving" || !current.resolutionRequested) return;
    const reverted: TurnState = {
      ...current,
      phase: "ready_check",
      resolutionRequested: false,
      readyCheckDeadline: null,
    };
    this.store.save(reverted);
    this.gateway.broadcastTurnState(roomId);
  }

  /** Handle the no-scenario case: there is nothing to resolve, so just revert. */
  private applyResolutionFailure(roomId: string): void {
    this.revertFailedResolution(roomId, this.loadState(roomId));
  }

  // -------------------------------------------------------------------------
  // Ending (runs OUTSIDE the lock)
  // -------------------------------------------------------------------------

  /**
   * Generate the closing narration + Session_Summary, persist the summary, mark
   * the room ended, and deliver the closing narration (Requirements 15.1, 15.2,
   * 15.3, 15.5, 15.6).
   */
  private launchEnding(roomId: string, endedState: TurnState): void {
    this.track(
      (async () => {
        const scenario = this.scenarioResolver.getSelectedScenario(roomId);
        if (scenario === null) return;
        const ctx = toContext(endedState, scenario, this.charactersFor(roomId));
        const result = await this.coordinator.generateEnding(ctx, correlationFor(endedState));
        if (!result.ok) return; // Withheld on failure (R14.4).

        await this.sessionSummaryRepository.save({
          roomId,
          closingNarration: result.value.closing,
          summaryText: result.value.summary.text,
          createdAt: this.nowIso(),
        });

        // Mark the durable room ended so it rejects restarts (R15.6, R15.7).
        this.markRoomEnded(roomId);

        this.gateway.deliverNarration(roomId, {
          kind: "closing",
          roundNumber: endedState.roundNumber,
          text: result.value.closing,
        });
      })(),
    );
  }

  /** Best-effort durable room-ended transition (Requirement 15.6). */
  private markRoomEnded(roomId: string): void {
    const room = this.roomReader.getRoom(roomId);
    if (room === undefined || room.state === "ended") return;
    this.roomReader.saveRoom?.({ ...room, state: "ended" });
  }

  // -------------------------------------------------------------------------
  // QA timing event
  // -------------------------------------------------------------------------

  /** Emit a best-effort `round_timing` event; never throws into game flow. */
  private emitRoundTiming(
    roomId: string,
    roundNumber: number,
    allReadyAtIso: string,
    narrationReturnedAtIso: string,
  ): void {
    if (this.eventSink === undefined) return;
    try {
      this.eventSink.emit(
        makeRoundTimingEvent(
          { sessionId: roomId, roundNo: roundNumber },
          { allReadyAt: allReadyAtIso, narrationReturnedAt: narrationReturnedAtIso },
          this.generators,
        ),
      );
    } catch {
      // Instrumentation is best-effort (Requirement 18.7).
    }
  }

  // -------------------------------------------------------------------------
  // Small helpers
  // -------------------------------------------------------------------------

  /** The room's characters as the coordinator/context expect them. */
  private charactersFor(roomId: string): readonly Character[] {
    return this.roomReader.listCharactersByRoom(roomId);
  }

  /** The sending player's character name for chat attribution (R6.3). */
  private characterNameFor(roomId: string, playerId: PlayerId): string | undefined {
    return this.roomReader
      .listCharactersByRoom(roomId)
      .find((character) => character.playerId === playerId)?.name;
  }

  /** ISO ready-check deadline = now + the state's configured timeout (R8.1). */
  private deadlineFor(state: TurnState): string {
    return new Date(this.now().getTime() + state.readyCheckTimeoutMs).toISOString();
  }

  /** Current instant as an ISO string. */
  private nowIso(): string {
    return this.now().toISOString();
  }
}

/** Compile-time exhaustiveness guard for {@link OrchestratorCommand}. */
function assertNever(command: never): never {
  throw new TypeError(`Unhandled orchestrator command: ${JSON.stringify(command)}`);
}

/** Stable map key for a room+round pair. */
function timingKey(roomId: string, roundNumber: number): string {
  return `${roomId}:${roundNumber}`;
}

/** Correlation derived from a Turn_State for QA events. */
function correlationFor(state: TurnState): CorrelationKey {
  return { sessionId: state.roomId, roundNo: state.roundNumber };
}
