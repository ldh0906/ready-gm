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
import type { ClockStore } from "../services/clock-store.js";
import { seedClocksForScenario, areClocksVisible } from "../services/scenario-clocks.js";
import type { SceneStore } from "../services/scene-store.js";
import { seedSceneForScenario } from "../services/scenario-scenes.js";
import {
  seedCharacterStatesForCharacters,
  type CharacterStateStore,
} from "../services/character-state-store.js";
import type { BlackboardStore } from "../services/blackboard-store.js";
import { seedBlackboardForScenario } from "../services/scenario-blackboard.js";
import type { MemoryStore } from "../services/memory-store.js";
import { resolveGameProfileForScenario } from "../core/game-profile.js";
import { toVisibleBlackboard } from "../core/scenario-blackboard.js";
import type { Character, Player, Room } from "../services/types.js";
import type { Scenario } from "../services/scenario-service.js";
import { sheetSchemaForScenario } from "../services/sheet-schema.js";
import {
  toContext,
  type TurnStateContext,
} from "../services/turn-state-context.js";
import type {
  GenerationResult,
  DeclaredCheck,
  DeclareRoundResult,
  GenerateEndingOptions,
  Narration,
  NarrateDeclaredRoundInput,
  RoundDeclaration,
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
import type { ServerEvent } from "./connection.js";
import type { SessionSummaryRepository } from "../persistence/types.js";
import type { CheckRecord, PendingCheck } from "../core/turn-state.js";

const MAX_AUTOMATIC_FAILED_RESOLUTION_RETRIES = 1;

interface PendingResolution {
  declaration: RoundDeclaration;
  roundNumber: number;
  allReadyAtIso: string;
  resolvedByCheckId: Map<string, CheckRecord>;
}

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
  | { type: "ROLL_CHECK"; from: PlayerId; checkId: string }
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
  /** Broadcast a non-state event to every connected room member. */
  broadcast(roomId: string, event: ServerEvent): void;
}

/**
 * The slice of the AI GM Coordinator the orchestrator drives. {@link
 * import("../ai/ai-gm-coordinator.js").AiGmCoordinator} satisfies this.
 */
export interface OrchestratorCoordinator {
  resolveRound(input: ResolveRoundInput): Promise<ResolveRoundResult>;
  declareRound(input: ResolveRoundInput): Promise<DeclareRoundResult>;
  rollDeclaredCheck(check: DeclaredCheck): GenerationResult<CheckRecord>;
  narrateDeclaredRound(input: NarrateDeclaredRoundInput): Promise<ResolveRoundResult>;
  generateOpening(
    ctx: TurnStateContext,
    correlation?: CorrelationKey,
  ): Promise<GenerationResult<Narration>>;
  generateEnding(
    ctx: TurnStateContext,
    correlation?: CorrelationKey,
    options?: GenerateEndingOptions,
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
  markRoomEndedIfInSession?(roomId: string): Promise<boolean>;
}

function hasRoomEndedCas(
  roomReader: RoomReader,
): roomReader is RoomReader & { markRoomEndedIfInSession(roomId: string): Promise<boolean> } {
  return typeof roomReader.markRoomEndedIfInSession === "function";
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
  /**
   * Optional per-room Progress Clock store. When present, the orchestrator seeds
   * the scenario's static clocks at session start, supplies them to each round
   * resolution, and persists the engine-applied result. When omitted, rounds
   * resolve with no clocks (the prior behaviour).
   */
  clockStore?: ClockStore;
  /**
   * Optional per-room Scene State store. When present, the orchestrator seeds
   * the scenario's opening scene at session start, supplies it to each round
   * resolution for grounding, and persists the engine-applied result (revealed
   * clues). When omitted, rounds resolve with no scene grounding.
   */
  sceneStore?: SceneStore;
  /**
   * Optional per-room Character State store. When present, the orchestrator
   * seeds empty mutable state for confirmed characters at session start,
   * supplies it to each round resolution, and persists the engine-applied
   * CharacterDelta result.
   */
  characterStateStore?: CharacterStateStore;
  /** Optional per-room ScenarioBlackboard store. */
  blackboardStore?: BlackboardStore;
  /** Optional per-room Memory Clerk store (summarized long-term memory). */
  memoryStore?: MemoryStore;
  /** Best-effort QA event sink; defaults to no emission. */
  eventSink?: EventSink;
  /** Engine config (ready-check timeout, resolution token budget). */
  config?: EngineConfig;
  /** Clock; defaults to wall-clock. Injectable for deterministic tests. */
  now?: () => Date;
  /** Deterministic envelope generators for QA events (tests). */
  generators?: EnvelopeGenerators;
  /**
   * Schedule a one-shot timer (default `setTimeout`, unref'd so it never keeps
   * the process alive). Injectable so tests can drive the ready-check countdown
   * deterministically. Returns an opaque handle passed to {@link cancelTimer}.
   */
  scheduleTimer?: (fn: () => void, ms: number) => unknown;
  /** Cancel a timer scheduled by {@link scheduleTimer} (default `clearTimeout`). */
  cancelTimer?: (handle: unknown) => void;
  /**
   * Optional best-effort flow logger for session tracing (phase transitions,
   * resolution start/outcome, narration delivery, timeout/force/revert). No-op
   * when omitted; never affects game flow.
   */
  log?: (category: string, data?: Record<string, unknown>) => void;
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
  private readonly clockStore: ClockStore | undefined;
  private readonly sceneStore: SceneStore | undefined;
  private readonly characterStateStore: CharacterStateStore | undefined;
  private readonly blackboardStore: BlackboardStore | undefined;
  private readonly memoryStore: MemoryStore | undefined;
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
  /** `${roomId}:${roundNo}` → automatic retries already armed after resolution failures. */
  private readonly failedResolutionRetries = new Map<string, number>();
  /** roomId → in-flight ready-check countdown handle (auto-pass unready on expiry). */
  private readonly readyCheckTimers = new Map<string, unknown>();
  /** roomId → pending two-phase dice declaration awaiting player rolls. */
  private readonly pendingResolutions = new Map<string, PendingResolution>();
  /** roomId → in-flight roll-check timeout handle (auto-roll unresolved checks). */
  private readonly rollCheckTimers = new Map<string, unknown>();
  private readonly scheduleTimer: (fn: () => void, ms: number) => unknown;
  private readonly cancelTimer: (handle: unknown) => void;
  /** Best-effort flow logger for session tracing (no-op when not provided). */
  private readonly log: (category: string, data?: Record<string, unknown>) => void;

  constructor(deps: RoomOrchestratorDeps) {
    this.store = deps.store;
    this.gateway = deps.gateway;
    this.coordinator = deps.coordinator;
    this.roomReader = deps.roomReader;
    this.scenarioResolver = deps.scenarioResolver;
    this.sessionSummaryRepository = deps.sessionSummaryRepository;
    this.clockStore = deps.clockStore;
    this.sceneStore = deps.sceneStore;
    this.characterStateStore = deps.characterStateStore;
    this.blackboardStore = deps.blackboardStore;
    this.memoryStore = deps.memoryStore;
    this.eventSink = deps.eventSink;
    this.config = deps.config ?? DEFAULT_ENGINE_CONFIG;
    this.now = deps.now ?? (() => new Date());
    this.generators = deps.generators;
    this.scheduleTimer =
      deps.scheduleTimer ??
      ((fn, ms) => {
        const handle = globalThis.setTimeout(fn, ms);
        // Never let a pending countdown keep the Node process alive.
        if (typeof (handle as { unref?: () => void }).unref === "function") {
          (handle as { unref: () => void }).unref();
        }
        return handle;
      });
    this.cancelTimer =
      deps.cancelTimer ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>));
    this.log = deps.log ?? (() => undefined);
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
    if (command.type === "ROLL_CHECK") {
      this.applyRollCheckCommand(roomId, command.from, command.checkId);
      return;
    }
    const before = this.loadState(roomId);
    const reducerCommand = this.toReducerCommand(roomId, before, command);
    if (reducerCommand === null) return;

    const after = reduce(before, reducerCommand);
    // The reducer returns the same reference for inapplicable (no-op) commands.
    if (after === before) return;

    this.store.save(after);
    this.gateway.broadcastTurnState(roomId);

    // Trace the accepted command and any phase transition it caused.
    this.log("command", {
      roomId,
      type: command.type,
      from: "from" in command ? command.from : "by" in command ? command.by : undefined,
      phase: before.phase === after.phase ? after.phase : `${before.phase}→${after.phase}`,
      round: after.roundNumber,
      ready: after.readiness.filter((r) => r.status === "ready").length,
      total: after.readiness.length,
    });

    // Ready-check countdown (R8.1): arm a server-side timer when the gate opens
    // so unready/idle/disconnected players are auto-passed at the deadline and a
    // round can ALWAYS advance. The reducer accepts TIMEOUT_EXPIRED but nothing
    // else fires it, so without this a single idle/extra player stalls the round
    // forever. Clear it whenever the round leaves ready_check.
    const enteredReadyCheck = before.phase !== "ready_check" && after.phase === "ready_check";
    const leftReadyCheck = before.phase === "ready_check" && after.phase !== "ready_check";
    if (leftReadyCheck) this.clearReadyCheckTimer(roomId);
    if (enteredReadyCheck) this.armReadyCheckTimer(roomId, after.readyCheckTimeoutMs);
    if (before.phase === "rolling" && after.phase !== "rolling") {
      this.pendingResolutions.delete(roomId);
      this.clearRollCheckTimer(roomId);
    }

    // Session start: generate + deliver the opening narration (R5.2, R5.3).
    if (
      command.type === "START_SESSION" &&
      after.roundNumber === 1 &&
      before.roundNumber !== 1
    ) {
      this.seedClocks(roomId);
      this.seedScene(roomId);
      this.seedCharacterStates(roomId);
      this.seedBlackboard(roomId);
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
   * Arm the ready-check countdown for a room. On expiry, auto-pass every player
   * still not ready (one TIMEOUT_EXPIRED each, serialized through the queue);
   * the last one trips {@link maybeTriggerResolution} so the round advances even
   * if some player never acts or disconnected. Replaces any prior timer.
   */
  private armReadyCheckTimer(roomId: string, timeoutMs: number): void {
    this.clearReadyCheckTimer(roomId);
    const handle = this.scheduleTimer(() => {
      this.readyCheckTimers.delete(roomId);
      const state = this.store.get(roomId);
      if (state === undefined || state.phase !== "ready_check") return;
      const unready = state.readiness.filter((entry) => entry.status !== "ready");
      if (unready.length > 0) {
        // Auto-pass everyone not yet ready; the last one trips resolution (R8.x).
        this.log("ready_timeout", { roomId, round: state.roundNumber, autoPass: unready.map((e) => e.playerId) });
        for (const entry of unready) {
          void this.dispatch(roomId, { type: "TIMEOUT_EXPIRED", player: entry.playerId });
        }
      } else if (state.readiness.length > 0 && !state.resolutionRequested) {
        // Everyone is ready but the round is NOT progressing — this is the
        // recovery path for a prior resolution that failed and reverted to
        // ready_check. Force a fresh resolution so the round never wedges.
        const hostId = this.roomReader.getRoom(roomId)?.hostPlayerId;
        if (hostId !== undefined) {
          this.log("ready_force_retry", { roomId, round: state.roundNumber });
          void this.dispatch(roomId, { type: "FORCE_PROCEED", by: hostId });
        }
      }
    }, Math.max(0, timeoutMs));
    this.readyCheckTimers.set(roomId, handle);
  }

  /** Cancel and forget a room's ready-check countdown (no-op when none armed). */
  private clearReadyCheckTimer(roomId: string): void {
    const handle = this.readyCheckTimers.get(roomId);
    if (handle !== undefined) {
      this.cancelTimer(handle);
      this.readyCheckTimers.delete(roomId);
    }
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
      case "SEND_CHAT": {
        // Attach the sender's room join display name when known; conditionally
        // included so a missing name introduces no key (exactOptionalPropertyTypes).
        const displayName = this.displayNameFor(roomId, command.from);
        return {
          type: "SEND_CHAT",
          from: command.from,
          characterName: this.characterNameFor(roomId, command.from) ?? command.from,
          text: command.text,
          ts: this.nowIso(),
          ...(displayName !== undefined ? { displayName } : {}),
        };
      }
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
      case "ROLL_CHECK":
        return null;
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
        if (!result.ok) {
          this.log("opening_failed", { roomId, reason: result.error.reason, message: result.error.message });
          this.emitNarrationFailure(roomId, "opening", result.error.message);
          return;
        }
        this.log("narration", { roomId, kind: "opening", round: startedState.roundNumber });
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
    this.log("resolution_start", { roomId, round: resolving.roundNumber });
    this.track(
      (async () => {
        const scenario = this.scenarioResolver.getSelectedScenario(roomId);
        if (scenario === null) {
          this.log("resolution_no_scenario", { roomId, round: resolving.roundNumber });
          await this.enqueue(roomId, () => this.applyResolutionFailure(roomId));
          return;
        }
        const clocks = this.clockStore?.get(roomId);
        const scene = this.sceneStore?.get(roomId);
        const characterStates = this.characterStateStore?.get(roomId);
        const blackboard = this.blackboardStore?.get(roomId);
        const memories = this.memoryStore?.list(roomId);
        const result = await this.coordinator.declareRound({
          state: resolving,
          scenario,
          characters: this.charactersFor(roomId),
          budget: this.config.tokenBudgets.resolution,
          profile: resolveGameProfileForScenario(scenario.id),
          ...(clocks !== undefined ? { clocks } : {}),
          ...(scene !== undefined ? { scene } : {}),
          ...(characterStates !== undefined ? { characterStates } : {}),
          ...(blackboard !== undefined ? { blackboard } : {}),
          ...(memories !== undefined ? { memories } : {}),
        });
        this.log("checks_declared", {
          roomId,
          round: resolving.roundNumber,
          ok: result.ok,
          ...(result.ok
            ? {}
            : { reason: result.error.reason, message: result.error.message }),
        });
        await this.enqueue(roomId, () =>
          this.applyDeclarationResult(
            roomId,
            resolving.roundNumber,
            allReadyAtIso,
            result,
          ),
        );
      })(),
    );
  }

  private applyDeclarationResult(
    roomId: string,
    roundNumber: number,
    allReadyAtIso: string,
    result: DeclareRoundResult,
  ): void {
    const current = this.loadState(roomId);
    if (!result.ok) {
      this.revertFailedResolution(roomId, current);
      return;
    }
    if (
      (current.phase !== "resolving" && current.phase !== "rolling") ||
      !current.resolutionRequested
    ) {
      return;
    }

    const publicChecks = result.declaration.checks.filter(
      (check) => check.visibility === "player",
    );
    const pendingChecks = publicChecks.map((check) => this.toPendingCheck(check, "pending"));
    this.pendingResolutions.set(roomId, {
      declaration: result.declaration,
      roundNumber,
      allReadyAtIso,
      resolvedByCheckId: new Map(),
    });

    if (pendingChecks.length > 0) {
      const next = reduce(current, { type: "DECLARE_CHECKS", checks: pendingChecks });
      if (next === current) {
        this.pendingResolutions.delete(roomId);
        return;
      }
      this.store.save(next);
      this.gateway.broadcastTurnState(roomId);
      this.gateway.broadcast(roomId, { type: "checks_pending", roomId, checks: pendingChecks });
    }

    // Hidden GM checks and public ownerless checks cannot wait on a player.
    // Resolve them immediately so disconnected/absent actors never wedge the round.
    for (const check of result.declaration.checks) {
      if (check.visibility !== "player" || check.playerId === null) {
        this.rollDeclaredCheck(roomId, check.checkId, true);
      }
    }

    if (this.hasUnrolledChecks(roomId)) {
      this.armRollCheckTimer(roomId);
    } else {
      this.maybeLaunchDeclaredNarration(roomId);
    }
  }

  private applyRollCheckCommand(roomId: string, playerId: PlayerId, checkId: string): void {
    const current = this.loadState(roomId);
    if (current.phase !== "rolling" || !current.resolutionRequested) return;
    const pending = (current.rollingChecks ?? []).find((check) => check.checkId === checkId);
    if (pending === undefined) return;
    if (pending.status === "rolled") return;
    if (pending.playerId !== playerId) return;
    this.rollDeclaredCheck(roomId, checkId, false);
  }

  private rollDeclaredCheck(roomId: string, checkId: string, autoRolled: boolean): void {
    const pending = this.pendingResolutions.get(roomId);
    if (pending === undefined) return;
    if (pending.resolvedByCheckId.has(checkId)) return;
    const declared = pending.declaration.checks.find((check) => check.checkId === checkId);
    if (declared === undefined) return;

    const rolled = this.coordinator.rollDeclaredCheck(declared);
    if (!rolled.ok) {
      this.revertFailedResolution(roomId, this.loadState(roomId));
      return;
    }
    pending.resolvedByCheckId.set(checkId, rolled.value);

    if (declared.visibility === "player") {
      const current = this.loadState(roomId);
      const next = reduce(current, {
        type: "CHECK_ROLLED",
        checkId,
        check: rolled.value,
        ...(autoRolled ? { autoRolled: true } : {}),
      });
      if (next !== current) {
        this.store.save(next);
        this.gateway.broadcastTurnState(roomId);
      }
      this.gateway.broadcast(roomId, {
        type: "check_rolled",
        roomId,
        check: {
          ...this.toPendingCheck(declared, "rolled"),
          roll: rolled.value.roll,
          rolls: [...rolled.value.rolls],
          outcome: rolled.value.outcome,
          ...(autoRolled ? { autoRolled: true } : {}),
        },
      });
    }

    this.maybeLaunchDeclaredNarration(roomId);
  }

  private hasUnrolledChecks(roomId: string): boolean {
    const pending = this.pendingResolutions.get(roomId);
    if (pending === undefined) return false;
    return pending.declaration.checks.some((check) => !pending.resolvedByCheckId.has(check.checkId));
  }

  private maybeLaunchDeclaredNarration(roomId: string): void {
    const pending = this.pendingResolutions.get(roomId);
    if (pending === undefined || this.hasUnrolledChecks(roomId)) return;
    this.pendingResolutions.delete(roomId);
    this.clearRollCheckTimer(roomId);
    const resolvedChecks = pending.declaration.checks
      .map((check) => pending.resolvedByCheckId.get(check.checkId))
      .filter((check): check is CheckRecord => check !== undefined);
    this.track(
      (async () => {
        const result = await this.coordinator.narrateDeclaredRound({
          declaration: pending.declaration,
          resolvedChecks,
        });
        this.log("resolution_returned", {
          roomId,
          round: pending.roundNumber,
          ok: result.ok,
          ...(result.ok ? {} : { reason: result.error.reason, message: result.error.message }),
        });
        const narrationReturnedAtIso = this.nowIso();
        await this.enqueue(roomId, () =>
          this.applyResolutionResult(
            roomId,
            pending.roundNumber,
            pending.allReadyAtIso,
            narrationReturnedAtIso,
            result,
          ),
        );
      })(),
    );
  }

  private armRollCheckTimer(roomId: string): void {
    this.clearRollCheckTimer(roomId);
    const handle = this.scheduleTimer(() => {
      this.rollCheckTimers.delete(roomId);
      void this.enqueue(roomId, () => this.autoRollRemainingChecks(roomId));
    }, Math.max(0, this.config.rollCheckTimeoutMs));
    this.rollCheckTimers.set(roomId, handle);
  }

  private clearRollCheckTimer(roomId: string): void {
    const handle = this.rollCheckTimers.get(roomId);
    if (handle !== undefined) {
      this.cancelTimer(handle);
      this.rollCheckTimers.delete(roomId);
    }
  }

  private autoRollRemainingChecks(roomId: string): void {
    const pending = this.pendingResolutions.get(roomId);
    if (pending === undefined) return;
    for (const check of pending.declaration.checks) {
      if (!pending.resolvedByCheckId.has(check.checkId)) {
        this.rollDeclaredCheck(roomId, check.checkId, true);
      }
    }
  }

  private toPendingCheck(check: DeclaredCheck, status: PendingCheck["status"]): PendingCheck {
    return {
      checkId: check.checkId,
      characterId: check.characterId,
      ...(check.characterName !== undefined ? { characterName: check.characterName } : {}),
      playerId: check.playerId,
      attribute: check.attribute,
      difficulty: check.difficulty,
      advantage: check.advantage,
      visibility: check.visibility,
      status,
    };
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
    if (
      (current.phase !== "resolving" && current.phase !== "rolling") ||
      !current.resolutionRequested
    ) {
      return;
    }

    const next = reduce(current, {
      type: "RESOLUTION_READY",
      narration: result.narration,
      checks: result.checks,
      endingReached: result.endingReached,
    });
    if (next === current) return; // Guard rejected the delivery; nothing committed.

    this.store.save(next);
    // Persist the engine-applied clocks for the round just resolved. Reacting to
    // fired clocks (`result.firedClocks` onComplete ids → spawning threats /
    // scene changes) is deferred Front work — see blackboard-scope.ts.
    if (this.clockStore !== undefined && result.clocks !== undefined) {
      this.clockStore.save(roomId, result.clocks);
    }
    // Persist the engine-applied scene (e.g. clues the GM revealed this round).
    if (this.sceneStore !== undefined && result.scene !== undefined) {
      this.sceneStore.save(roomId, result.scene);
    }
    // Persist the engine-applied character state. The AI proposes deltas; the
    // coordinator applies only validated deltas and returns the resulting state.
    if (this.characterStateStore !== undefined && result.characterStates !== undefined) {
      this.characterStateStore.save(roomId, result.characterStates);
    }
    if (this.blackboardStore !== undefined && result.blackboard !== undefined) {
      this.blackboardStore.save(roomId, result.blackboard);
    }
    // Persist the Memory Clerk records (deterministic derivation + validated
    // AI writes) so the next round's context can select by salience.
    if (this.memoryStore !== undefined && result.memories !== undefined) {
      this.memoryStore.save(roomId, result.memories);
    }
    this.gateway.broadcastTurnState(roomId);

    // Deliver the resolution narration for the round just resolved (R10.4, R15.5).
    // Visible-clock scenarios also surface the current clock gauges to players.
    const visibleClocks = this.visibleClocksFor(roomId, result.clocks);
    // Player-visible checks (hidden GM rolls excluded) so the client can animate
    // the EZFudge dice for this round's results. Each check carries the acting
    // character's name (so the client shows who rolls what and can gate a
    // player's own roll) and a scenario-localized attribute label (so custom
    // stats like "Sneaky" display as 은밀함 rather than the raw key).
    const characters = this.charactersFor(roomId);
    const nameById = new Map(characters.map((c) => [c.id, c.name] as const));
    const scenario = this.scenarioResolver.getSelectedScenario(roomId);
    const labelByAttribute = new Map<string, string>();
    if (scenario !== null) {
      for (const trait of sheetSchemaForScenario(scenario).traits) {
        labelByAttribute.set(trait.key, trait.label);
      }
    }
    const visibleChecks = result.checks
      .filter((c) => (c.visibility ?? "player") === "player")
      .map((c) => ({
        attribute: c.attribute,
        attributeLabel: labelByAttribute.get(c.attribute) ?? c.attribute,
        characterName: nameById.get(c.characterId) ?? "",
        difficulty: c.difficulty,
        advantage: c.advantage ?? "none",
        rolls: Array.isArray(c.rolls) && c.rolls.length > 0 ? [...c.rolls] : [c.roll],
        roll: c.roll,
        outcome: c.outcome,
      }));
    // The round's player-visible blackboard projection (discovered clues /
    // NPC presence / threats) rides the narration payload so the client panel
    // updates in the same beat; hidden material is projected away server-side.
    const visibleBlackboard =
      result.blackboard !== undefined ? toVisibleBlackboard(result.blackboard) : undefined;
    this.gateway.deliverNarration(roomId, {
      kind: "resolution",
      roundNumber,
      text: result.narration,
      ...(visibleClocks !== undefined ? { clocks: visibleClocks } : {}),
      ...(visibleChecks.length > 0 ? { checks: visibleChecks } : {}),
      ...(visibleBlackboard !== undefined ? { blackboard: visibleBlackboard } : {}),
    });
    this.log("narration", {
      roomId,
      kind: "resolution",
      round: roundNumber,
      nextPhase: next.phase,
      endingReached: next.phase === "ended",
    });

    // Best-effort latency event for the round (all-ready → narration-returned).
    this.emitRoundTiming(roomId, roundNumber, allReadyAtIso, narrationReturnedAtIso);
    const key = timingKey(roomId, roundNumber);
    this.allReadyAt.delete(key);
    this.failedResolutionRetries.delete(key);

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
    if (
      (current.phase !== "resolving" && current.phase !== "rolling") ||
      !current.resolutionRequested
    ) {
      return;
    }
    this.pendingResolutions.delete(roomId);
    this.clearRollCheckTimer(roomId);
    const reverted: TurnState = {
      ...current,
      phase: "ready_check",
      checks: [],
      rollingChecks: [],
      resolutionRequested: false,
      readyCheckDeadline: null,
    };
    this.store.save(reverted);
    this.gateway.broadcastTurnState(roomId);
    this.log("resolution_reverted", { roomId, round: reverted.roundNumber });
    // Re-arm the countdown so a reverted, all-ready round can retry once without
    // wedging forever. Further failures wait for a manual force/proceed path
    // instead of creating an unbounded AI-cost loop.
    const key = timingKey(roomId, reverted.roundNumber);
    this.allReadyAt.delete(key);
    const retryCount = (this.failedResolutionRetries.get(key) ?? 0) + 1;
    this.failedResolutionRetries.set(key, retryCount);
    if (retryCount > MAX_AUTOMATIC_FAILED_RESOLUTION_RETRIES) {
      this.log("ready_retry_exhausted", { roomId, round: reverted.roundNumber, retries: retryCount });
      // Automatic retries are exhausted: surface an explicit room-visible
      // failure instead of silence. Players retry by re-readying (the round's
      // recorded actions are preserved), so the notice names that affordance.
      this.emitNarrationFailure(roomId, "resolution", "automatic retries exhausted");
      return;
    }
    this.armReadyCheckTimer(roomId, reverted.readyCheckTimeoutMs);
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
        const endingFacts: GenerateEndingOptions = {};
        if (this.blackboardStore !== undefined) {
          const blackboard = this.blackboardStore.get(roomId);
          if (blackboard !== undefined) endingFacts.blackboard = blackboard;
        }
        if (this.clockStore !== undefined) endingFacts.clocks = this.clockStore.get(roomId);
        if (this.memoryStore !== undefined) endingFacts.memories = this.memoryStore.list(roomId);
        const result = await this.coordinator.generateEnding(ctx, correlationFor(endedState), endingFacts);
        if (!result.ok) {
          this.emitNarrationFailure(roomId, "ending", result.error.message);
          return;
        }
        const markedEnded = await this.markRoomEnded(roomId);
        if (!markedEnded) return;

        await this.sessionSummaryRepository.save({
          roomId,
          closingNarration: result.value.closing,
          summaryText: result.value.summary.text,
          createdAt: this.nowIso(),
        });

        this.gateway.deliverNarration(roomId, {
          kind: "closing",
          roundNumber: endedState.roundNumber,
          text: result.value.closing,
        });
      })(),
    );
  }

  /** Best-effort durable room-ended transition (Requirement 15.6). */
  private async markRoomEnded(roomId: string): Promise<boolean> {
    const room = this.roomReader.getRoom(roomId);
    if (room === undefined || room.state === "ended") return false;
    if (hasRoomEndedCas(this.roomReader)) {
      const changed = await this.roomReader.markRoomEndedIfInSession(roomId);
      if (!changed) return false;
    }
    this.roomReader.saveRoom?.({ ...room, state: "ended" });
    return true;
  }

  private emitNarrationFailure(
    roomId: string,
    phase: "opening" | "ending" | "resolution",
    reason: string,
  ): void {
    this.gateway.broadcast(roomId, {
      type: "narration_failed",
      roomId,
      phase,
      reason,
      retryable: true,
    });
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

  /**
   * Seed the scenario's static Progress Clocks at session start (no-op when no
   * clock store is wired or the room has no scenario). Until a Front Planner
   * generates clocks, these hand-authored seeds are the round's pressure gauges.
   */
  private seedClocks(roomId: string): void {
    if (this.clockStore === undefined) return;
    const scenario = this.scenarioResolver.getSelectedScenario(roomId);
    if (scenario === null) return;
    this.clockStore.save(roomId, seedClocksForScenario(scenario.id));
  }

  /** Seed the scenario's opening Scene State at session start (no-op when unwired). */
  private seedScene(roomId: string): void {
    if (this.sceneStore === undefined) return;
    const scenario = this.scenarioResolver.getSelectedScenario(roomId);
    if (scenario === null) return;
    const scene = seedSceneForScenario(scenario.id);
    if (scene !== null) this.sceneStore.save(roomId, scene);
  }

  /** Seed empty mutable state for confirmed characters at session start. */
  private seedCharacterStates(roomId: string): void {
    if (this.characterStateStore === undefined) return;
    this.characterStateStore.save(roomId, seedCharacterStatesForCharacters(this.charactersFor(roomId)));
  }

  /** Seed the scenario blackboard at session start, empty for scenarios without authored data. */
  private seedBlackboard(roomId: string): void {
    if (this.blackboardStore === undefined) return;
    const scenario = this.scenarioResolver.getSelectedScenario(roomId);
    if (scenario === null) return;
    this.blackboardStore.save(roomId, seedBlackboardForScenario(roomId, scenario.id));
  }

  /**
   * The player-visible clock snapshot for a room, or `undefined` when the
   * scenario keeps clocks hidden or none are available. Used to decide whether
   * to attach clock gauges to delivered narration (per-scenario tone lever).
   */
  private visibleClocksFor(
    roomId: string,
    resolvedClocks: readonly { name: string; value: number; max: number }[] | undefined,
  ): { name: string; value: number; max: number }[] | undefined {
    const scenario = this.scenarioResolver.getSelectedScenario(roomId);
    if (scenario === null || !areClocksVisible(scenario.id)) return undefined;
    const clocks = resolvedClocks ?? this.clockStore?.get(roomId) ?? [];
    if (clocks.length === 0) return undefined;
    return clocks.map((c) => ({ name: c.name, value: c.value, max: c.max }));
  }

  /** The sending player's character name for chat attribution (R6.3). */
  private characterNameFor(roomId: string, playerId: PlayerId): string | undefined {
    return this.roomReader
      .listCharactersByRoom(roomId)
      .find((character) => character.playerId === playerId)?.name;
  }

  /** The sending player's room join display name for `characterName(displayName)` attribution. */
  private displayNameFor(roomId: string, playerId: PlayerId): string | undefined {
    return this.roomReader.listPlayers(roomId).find((p) => p.id === playerId)?.displayName;
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
