/**
 * Unit tests for the {@link RoomOrchestrator} — the per-room single-writer actor.
 *
 * These tests wire the orchestrator against in-memory stores, a fake AI GM
 * coordinator, the real {@link RealtimeGateway} observed through a fake
 * {@link Connection}, and a deterministic clock, so the full round cascade
 * (free-chat → all-ready → resolving → resolveRound → RESOLUTION_READY →
 * round N+1) is observable end-to-end without a network, real AI, or DB.
 *
 * Coverage:
 *  - a full round advances and delivers resolution narration;
 *  - interleaved readiness commands converge and resolve exactly once;
 *  - at-most-once resolution under all-ready + force-proceed;
 *  - a `round_timing` event is emitted once per round with both timestamps;
 *  - the ending path persists a Session_Summary and marks the room ended;
 *  - an AI failure preserves the round's recorded actions.
 */
import { describe, expect, it } from "vitest";
import { createInitialTurnState } from "../core/round-loop.js";
import { DEFAULT_ENGINE_CONFIG } from "../core/config.js";
import { makeCharacterState } from "../core/character-state.js";
import { createEmptyBlackboard } from "../core/scenario-blackboard.js";
import { makeClock as makeProgressClock } from "../core/progress-clock.js";
import { DiceRollError, type DiceRollRecord, type DiceService } from "../core/dice.js";
import {
  applySinksResolutions,
  createSinksDayState,
  unresolvedRequiredCardIds,
  type SinksResolutionProposal,
} from "../core/sinks-day-state.js";
import type { TurnState } from "../core/turn-state.js";
import { InMemoryRoomStore } from "../services/room-store.js";
import { InMemoryTurnStateStore } from "../services/turn-state-store.js";
import { InMemoryClockStore } from "../services/clock-store.js";
import { InMemorySceneStore } from "../services/scene-store.js";
import { InMemoryCharacterStateStore } from "../services/character-state-store.js";
import { InMemoryBlackboardStore } from "../services/blackboard-store.js";
import { InMemoryMemoryStore } from "../services/memory-store.js";
import { InMemorySinksDayStore } from "../services/sinks-day-store.js";
import { buildSinksEventSchedule } from "../services/sinks-event-deck.js";
import { DEMO_SCENARIO_CATALOG, MVP_SCENARIO } from "../services/scenario-service.js";
import type { Character, Player, Room } from "../services/types.js";
import { InMemorySessionSummaryRepository } from "../persistence/pg-session-summary-repository.js";
import { InMemoryEventSink } from "../observability/event-sink.js";
import type { RoundTimingEvent } from "../observability/events.js";
import { RealtimeGateway } from "./gateway.js";
import type { Connection, NarrationPayload, ServerEvent } from "./connection.js";
import {
  RoomOrchestrator,
  type OrchestratorCoordinator,
} from "./room-orchestrator.js";
import type {
  DeclaredCheck,
  DeclareRoundResult,
  GenerationResult,
  GenerateEndingOptions,
  FacilitateSinksDayInput,
  FacilitateSinksDayResult,
  Narration,
  NarrateDeclaredRoundInput,
  RoundDeclaration,
  ResolveRoundInput,
  ResolveRoundResult,
  SessionSummary,
} from "../ai/ai-gm-coordinator.js";
import type { TurnStateContext } from "../services/turn-state-context.js";

const ROOM_ID = "room-1";
const HOST = "p-host";
const PLAYER_2 = "p-2";

/** A deterministic, manually-advanced clock. */
function makeClock(startIso = "2024-01-01T00:00:00.000Z") {
  let ms = Date.parse(startIso);
  return {
    now: (): Date => new Date(ms),
    advance: (deltaMs: number): void => {
      ms += deltaMs;
    },
  };
}

function makeManualTimers() {
  const callbacks: Array<(() => void) | undefined> = [];
  const delays: number[] = [];
  return {
    scheduleTimer(fn: () => void, delayMs?: number): number {
      callbacks.push(fn);
      delays.push(delayMs ?? 0);
      return callbacks.length - 1;
    },
    cancelTimer(handle: unknown): void {
      if (typeof handle === "number") callbacks[handle] = undefined;
    },
    runLatest(): void {
      let index = -1;
      for (let i = callbacks.length - 1; i >= 0; i -= 1) {
        if (callbacks[i] !== undefined) {
          index = i;
          break;
        }
      }
      if (index < 0) return;
      const fn = callbacks[index];
      callbacks[index] = undefined;
      fn?.();
    },
    pendingCount(): number {
      return callbacks.filter((fn) => fn !== undefined).length;
    },
    latestDelayMs(): number | undefined {
      return delays.at(-1);
    },
  };
}

/** A fake {@link Connection} that records every {@link ServerEvent} it receives. */
class FakeConnection implements Connection {
  readonly events: ServerEvent[] = [];
  private closeHandlers: Array<() => void> = [];

  constructor(
    readonly id: string,
    readonly roomId: string,
    readonly playerId: string,
  ) {}

  send(event: ServerEvent): void {
    this.events.push(event);
  }
  ping(): void {}
  close(): void {
    for (const h of this.closeHandlers) h();
  }
  onMessage(_handler: (raw: string) => void): void {}
  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  /** Narration payloads delivered to this connection, in order. */
  narrations(): NarrationPayload[] {
    return this.events
      .filter((e): e is Extract<ServerEvent, { type: "narration" }> => e.type === "narration")
      .map((e) => e.narration);
  }

  /** Turn_State snapshots delivered to this connection, in order. */
  turnStates(): TurnState[] {
    return this.events
      .filter((e): e is Extract<ServerEvent, { type: "turn_state" }> => e.type === "turn_state")
      .map((e) => e.state);
  }

  narrationFailures(): Array<Extract<ServerEvent, { type: "narration_failed" }>> {
    return this.events.filter(
      (e): e is Extract<ServerEvent, { type: "narration_failed" }> =>
        e.type === "narration_failed",
    );
  }

  checksPending(): Array<Extract<ServerEvent, { type: "checks_pending" }>> {
    return this.events.filter(
      (e): e is Extract<ServerEvent, { type: "checks_pending" }> =>
        e.type === "checks_pending",
    );
  }

  checksRolled(): Array<Extract<ServerEvent, { type: "check_rolled" }>> {
    return this.events.filter(
      (e): e is Extract<ServerEvent, { type: "check_rolled" }> =>
        e.type === "check_rolled",
    );
  }
}

/** A programmable fake coordinator implementing the orchestrator's port. */
class FakeCoordinator implements OrchestratorCoordinator {
  resolveCalls = 0;
  declareCalls = 0;
  narrateCalls = 0;
  rollCalls = 0;
  openingCalls = 0;
  endingCalls = 0;
  sinksOpeningCalls = 0;
  sinksDayCalls = 0;
  lastResolveInput: ResolveRoundInput | undefined;
  lastSinksDayInput: FacilitateSinksDayInput | undefined;
  lastEndingOptions: GenerateEndingOptions | undefined;
  readonly resolveInputs: ResolveRoundInput[] = [];
  private lastDeclaredLegacyResult: ResolveRoundResult | undefined;

  constructor(
    private readonly opts: {
      resolve?: (input: ResolveRoundInput) => ResolveRoundResult;
      declare?: (input: ResolveRoundInput) => DeclareRoundResult;
      narrate?: (input: NarrateDeclaredRoundInput) => ResolveRoundResult;
      declaredChecks?: DeclaredCheck[];
      opening?: Narration;
      sinksOpening?: Narration;
      sinksDay?: (input: FacilitateSinksDayInput) => FacilitateSinksDayResult;
      ending?: { closing: Narration; summary: SessionSummary };
      openingFailure?: string;
      endingFailure?: string;
      /** When set, generateOpening resolves only after this gate settles (T-2 tests). */
      openingGate?: Promise<void>;
      /** Side effect run synchronously inside resolveRound (e.g. advance clock). */
      onResolve?: () => void;
    } = {},
  ) {}

  resolveRound(input: ResolveRoundInput): Promise<ResolveRoundResult> {
    this.resolveCalls += 1;
    this.lastResolveInput = input;
    this.resolveInputs.push(input);
    this.opts.onResolve?.();
    const result =
      this.opts.resolve?.(input) ??
      ({
        ok: true,
        narration: "결과 내레이션",
        checks: [],
        endingReached: false,
        context: input as unknown as TurnStateContext,
      } satisfies ResolveRoundResult);
    return Promise.resolve(result);
  }

  declareRound(input: ResolveRoundInput): Promise<DeclareRoundResult> {
    this.declareCalls += 1;
    this.resolveCalls += 1;
    this.lastResolveInput = input;
    this.resolveInputs.push(input);
    this.opts.onResolve?.();
    const legacy = this.opts.resolve?.(input);
    if (legacy !== undefined && !legacy.ok) {
      return Promise.resolve(legacy);
    }
    const declaration: RoundDeclaration = {
      state: input.state,
      context: input as unknown as TurnStateContext,
      decision: {} as RoundDeclaration["decision"],
      checks: this.opts.declaredChecks ?? [],
      procedurePlan: {} as RoundDeclaration["procedurePlan"],
      correlation: {} as RoundDeclaration["correlation"],
    };
    this.lastDeclaredLegacyResult = legacy;
    const result =
      this.opts.declare?.(input) ??
      ({ ok: true, declaration } satisfies DeclareRoundResult);
    return Promise.resolve(result);
  }

  rollDeclaredCheck(check: DeclaredCheck): GenerationResult<import("../core/turn-state.js").CheckRecord> {
    this.rollCalls += 1;
    return {
      ok: true,
      value: {
        characterId: check.characterId,
        attribute: check.attribute,
        difficulty: check.difficulty,
        roll: 1,
        rolls: [1],
        advantage: check.advantage,
        visibility: check.visibility,
        outcome: "Success",
      },
    };
  }

  narrateDeclaredRound(input: NarrateDeclaredRoundInput): Promise<ResolveRoundResult> {
    this.narrateCalls += 1;
    const result =
      this.opts.narrate?.(input) ??
      this.lastDeclaredLegacyResult ??
      ({
        ok: true,
        narration: "결과 내레이션",
        checks: input.resolvedChecks,
        endingReached: false,
        context: input.declaration.context,
      } satisfies ResolveRoundResult);
    return Promise.resolve(result);
  }

  generateOpening(): Promise<GenerationResult<Narration>> {
    this.openingCalls += 1;
    const finish = (): GenerationResult<Narration> =>
      this.opts.openingFailure !== undefined
        ? { ok: false, error: { reason: "ai_request_failed", message: this.opts.openingFailure } }
        : { ok: true, value: this.opts.opening ?? "오프닝 내레이션" };
    if (this.opts.openingGate !== undefined) {
      return this.opts.openingGate.then(finish);
    }
    return Promise.resolve(finish());
  }

  facilitateSinksOpening(): Promise<GenerationResult<Narration>> {
    this.sinksOpeningCalls += 1;
    return Promise.resolve({ ok: true, value: this.opts.sinksOpening ?? "낚시꾼이 시체로 발견되다. 저녁 대화를 시작합니다." });
  }

  facilitateSinksDay(input: FacilitateSinksDayInput): Promise<GenerationResult<FacilitateSinksDayResult>> {
    this.sinksDayCalls += 1;
    this.lastSinksDayInput = input;
    return Promise.resolve({
      ok: true,
      value: this.opts.sinksDay?.(input) ?? { narration: "한국어 날짜 전환 내레이션", resolutionProposals: [] },
    });
  }

  generateEnding(
    _ctx?: TurnStateContext,
    _correlation?: unknown,
    options?: GenerateEndingOptions,
  ): Promise<GenerationResult<{ closing: Narration; summary: SessionSummary }>> {
    this.endingCalls += 1;
    this.lastEndingOptions = options;
    if (this.opts.endingFailure !== undefined) {
      return Promise.resolve({
        ok: false,
        error: { reason: "ai_request_failed", message: this.opts.endingFailure },
      });
    }
    return Promise.resolve({
      ok: true,
      value: this.opts.ending ?? { closing: "엔딩 내레이션", summary: { text: "세션 요약" } },
    });
  }
}

interface Harness {
  roomId: string;
  orchestrator: RoomOrchestrator;
  gateway: RealtimeGateway;
  connection: FakeConnection;
  roomStore: InMemoryRoomStore;
  turnStateStore: InMemoryTurnStateStore;
  summaries: InMemorySessionSummaryRepository;
  sink: InMemoryEventSink;
  coordinator: FakeCoordinator;
  clock: ReturnType<typeof makeClock>;
  clockStore: InMemoryClockStore | undefined;
  sceneStore: InMemorySceneStore | undefined;
  characterStateStore: InMemoryCharacterStateStore | undefined;
  blackboardStore: InMemoryBlackboardStore | undefined;
  memoryStore: InMemoryMemoryStore | undefined;
  sinksDayStore: InMemorySinksDayStore | undefined;
}

/** Build a room with a host + one other player, both with confirmed characters. */
function seedRoom(roomStore: InMemoryRoomStore, roomId = ROOM_ID): void {
  const room: Room = {
    id: roomId,
    inviteToken: "tok",
    hostPlayerId: HOST,
    scenarioId: MVP_SCENARIO.id,
    state: "in_session",
    maxPlayers: 6,
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  roomStore.saveRoom(room);
  const players: Player[] = [
    { id: HOST, roomId, displayName: "Aria", isHost: true, characterId: "c1", connectionStatus: "connected" },
    { id: PLAYER_2, roomId, displayName: "Borin", isHost: false, characterId: "c2", connectionStatus: "connected" },
  ];
  for (const p of players) roomStore.savePlayer(p);
  const characters: Character[] = [
    { id: "c1", playerId: HOST, roomId, name: "Aria", concept: "scout", attributes: { Might: 0, Agility: 2, Wits: 1, Spirit: 0 }, confirmed: true },
    { id: "c2", playerId: PLAYER_2, roomId, name: "Borin", concept: "smith", attributes: { Might: 2, Agility: 0, Wits: 0, Spirit: 1 }, confirmed: true },
  ];
  for (const c of characters) roomStore.saveCharacter(c);
}

function setRoomScenario(roomStore: InMemoryRoomStore, scenarioId: string, roomId = ROOM_ID): void {
  const room = roomStore.getRoom(roomId);
  if (room !== undefined) roomStore.saveRoom({ ...room, scenarioId });
}

function scriptedDice(values: readonly number[]): DiceService {
  let index = 0;
  const next = (): number => {
    const value = values[index];
    index += 1;
    if (value === undefined) throw new Error("scripted dice exhausted");
    return value;
  };
  return {
    range: { min: 1, max: 6 },
    roll: next,
    tryRoll: () => {
      try {
        return { ok: true as const, value: next() };
      } catch (error) {
        return { ok: false as const, error: new DiceRollError("scripted dice exhausted", error) };
      }
    },
    rollWithRecord: () => {
      const value = next();
      return { value, rawValues: [value], seed: null, range: { min: 1, max: 6 } } satisfies DiceRollRecord;
    },
  };
}

function makeHarness(
  coordinator: FakeCoordinator,
  clock = makeClock(),
  clockStore?: InMemoryClockStore,
  sceneStore?: InMemorySceneStore,
  characterStateStore?: InMemoryCharacterStateStore,
  timers?: ReturnType<typeof makeManualTimers>,
  endingStores: {
    blackboardStore?: InMemoryBlackboardStore;
    memoryStore?: InMemoryMemoryStore;
    sinksDayStore?: InMemorySinksDayStore;
    sinksDice?: DiceService;
    roomId?: string;
  } = {},
): Harness {
  const roomId = endingStores.roomId ?? ROOM_ID;
  const roomStore = new InMemoryRoomStore();
  const turnStateStore = new InMemoryTurnStateStore();
  const summaries = new InMemorySessionSummaryRepository();
  const sink = new InMemoryEventSink();
  seedRoom(roomStore, roomId);

  const gateway = new RealtimeGateway({ getTurnState: (id) => turnStateStore.get(id) });
  const connection = new FakeConnection("conn-1", roomId, HOST);
  gateway.connect(connection);

  const orchestrator = new RoomOrchestrator({
    store: turnStateStore,
    gateway,
    coordinator,
    roomReader: roomStore,
    scenarioResolver: {
      getSelectedScenario: (id) => {
        const scenarioId = roomStore.getRoom(id)?.scenarioId ?? MVP_SCENARIO.id;
        return DEMO_SCENARIO_CATALOG.find((scenario) => scenario.id === scenarioId) ?? null;
      },
    },
    sessionSummaryRepository: summaries,
    eventSink: sink,
    config: DEFAULT_ENGINE_CONFIG,
    now: clock.now,
    ...(clockStore ? { clockStore } : {}),
    ...(sceneStore ? { sceneStore } : {}),
    ...(characterStateStore ? { characterStateStore } : {}),
    ...(endingStores.blackboardStore ? { blackboardStore: endingStores.blackboardStore } : {}),
    ...(endingStores.memoryStore ? { memoryStore: endingStores.memoryStore } : {}),
    ...(endingStores.sinksDayStore ? { sinksDayStore: endingStores.sinksDayStore } : {}),
    ...(endingStores.sinksDice ? { sinksDice: endingStores.sinksDice } : {}),
    ...(timers ? { scheduleTimer: timers.scheduleTimer, cancelTimer: timers.cancelTimer } : {}),
  });

  return {
    roomId,
    orchestrator,
    gateway,
    connection,
    roomStore,
    turnStateStore,
    summaries,
    sink,
    coordinator,
    clock,
    clockStore,
    sceneStore,
    characterStateStore,
    blackboardStore: endingStores.blackboardStore,
    memoryStore: endingStores.memoryStore,
    sinksDayStore: endingStores.sinksDayStore,
  };
}

/** Start the session and drain the opening narration. */
async function start(h: Harness): Promise<void> {
  await h.orchestrator.dispatch(h.roomId, { type: "START_SESSION", by: HOST });
  await h.orchestrator.whenSettled();
}

describe("RoomOrchestrator", () => {
  it("runs GM-less sinks day advancement on all-ready without declaring checks", async () => {
    const sinksDayStore = new InMemorySinksDayStore();
    const coordinator = new FakeCoordinator();
    const h = makeHarness(coordinator, makeClock(), undefined, undefined, undefined, undefined, { sinksDayStore });
    setRoomScenario(h.roomStore, "until-it-sinks");

    await start(h);
    expect(coordinator.sinksOpeningCalls).toBe(1);
    expect(coordinator.openingCalls).toBe(0);
    expect(sinksDayStore.get(ROOM_ID)?.day).toBe(1);

    await h.orchestrator.dispatch(ROOM_ID, { type: "SEND_CHAT", from: HOST, text: "낚시꾼 사건을 이야기한다." });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: HOST });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    expect(coordinator.sinksDayCalls).toBe(1);
    expect(coordinator.declareCalls).toBe(0);
    expect(h.connection.checksPending()).toHaveLength(0);
    expect(sinksDayStore.get(ROOM_ID)?.day).toBe(2);
    expect(h.turnStateStore.get(ROOM_ID)?.phase).toBe("free_chat");
    expect(h.connection.narrations().some((n) => n.kind === "resolution" && n.text === "한국어 날짜 전환 내레이션")).toBe(true);
  });

  it("assigns exactly one lowest-roll target and rerolls ties", async () => {
    const sinksDayStore = new InMemorySinksDayStore();
    let roomId = ROOM_ID;
    let schedule = buildSinksEventSchedule(roomId);
    for (let i = 0; i < 200 && schedule.days.every((event) => event.card.resolution !== "lowest_roll"); i += 1) {
      roomId = `room-lowest-${i}`;
      schedule = buildSinksEventSchedule(roomId);
    }
    const lowest = schedule.days.find((event) => event.card.resolution === "lowest_roll");
    if (lowest === undefined) throw new Error("fixture schedule should contain a lowest_roll card");
    const beforeLowest = createSinksDayState(roomId, schedule);
    const revealedBefore = ["fisherman_found", ...schedule.days.filter((event) => event.day < lowest.day).map((event) => event.card.id)];
    const coordinator = new FakeCoordinator();
    const h = makeHarness(
      coordinator,
      makeClock(),
      undefined,
      undefined,
      undefined,
      undefined,
      { sinksDayStore, sinksDice: scriptedDice([2, 2, 5, 3]), roomId },
    );
    setRoomScenario(h.roomStore, "until-it-sinks", h.roomId);
    await start(h);
    sinksDayStore.save(h.roomId, {
      ...beforeLowest,
      day: lowest.day - 1,
      revealedCardIds: revealedBefore,
    });

    await h.orchestrator.dispatch(h.roomId, { type: "PASS", from: HOST });
    await h.orchestrator.dispatch(h.roomId, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    const state = sinksDayStore.get(h.roomId);
    expect(Object.keys(state?.targetByCardId ?? {})).toEqual([lowest.card.id]);
    expect(Object.values(state?.targetByCardId ?? {})).toEqual(["c2"]);
    expect(coordinator.lastSinksDayInput?.targetCharacterName).toBe("Borin");
  });

  it("reopens final-day conversation when unresolved cards remain, then ends with resolutions", async () => {
    const sinksDayStore = new InMemorySinksDayStore();
    const schedule = buildSinksEventSchedule(ROOM_ID);
    let finalState = createSinksDayState(ROOM_ID, schedule);
    for (const event of schedule.days) {
      finalState = {
        ...finalState,
        day: event.day,
        revealedCardIds: [...finalState.revealedCardIds, event.card.id],
        finalDayReached: event.isFinalDay,
      };
      if (event.isFinalDay) break;
    }
    const coordinator = new FakeCoordinator({
      sinksDay: (input) => ({
        narration: input.stalledOnFinalDay ? "한국어 마지막 대화를 다시 엽니다." : "한국어 날짜 전환",
        resolutionProposals: [],
      }),
    });
    const h = makeHarness(coordinator, makeClock(), undefined, undefined, undefined, undefined, { sinksDayStore });
    setRoomScenario(h.roomStore, "until-it-sinks");
    await start(h);
    sinksDayStore.save(ROOM_ID, finalState);

    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: HOST });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    expect(coordinator.lastSinksDayInput?.stalledOnFinalDay).toBe(true);
    expect(sinksDayStore.get(ROOM_ID)?.day).toBe(finalState.day);
    expect(h.turnStateStore.get(ROOM_ID)?.phase).toBe("free_chat");
    expect(coordinator.endingCalls).toBe(0);

    const resolved = applySinksResolutions(
      sinksDayStore.get(ROOM_ID)!,
      unresolvedRequiredCardIds(sinksDayStore.get(ROOM_ID)!).map((cardId): SinksResolutionProposal => ({
        cardId,
        explanation: `해명 ${cardId}`,
      })),
    ).state;
    sinksDayStore.save(ROOM_ID, resolved);

    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: HOST });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    expect(h.turnStateStore.get(ROOM_ID)?.phase).toBe("ended");
    expect(coordinator.endingCalls).toBe(1);
    expect(coordinator.lastEndingOptions?.resolutions?.map((r) => r.cardId).sort()).toEqual(
      resolved.resolutions.map((r) => r.cardId).sort(),
    );
  });

  it("keeps the existing checks flow for sunless-crypt", async () => {
    const sinksDayStore = new InMemorySinksDayStore();
    const coordinator = new FakeCoordinator();
    const h = makeHarness(coordinator, makeClock(), undefined, undefined, undefined, undefined, { sinksDayStore });
    setRoomScenario(h.roomStore, "the-sunless-crypt");

    await start(h);
    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "문을 연다" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    expect(coordinator.declareCalls).toBe(1);
    expect(coordinator.sinksDayCalls).toBe(0);
    expect(sinksDayStore.get(ROOM_ID)).toBeUndefined();
  });

  it("runs a full round: free-chat -> all-ready -> resolving -> next round", async () => {
    const coordinator = new FakeCoordinator();
    const h = makeHarness(coordinator);

    await start(h);

    // Opening narration generated and delivered (R5.2, R5.3).
    expect(coordinator.openingCalls).toBe(1);
    expect(h.connection.narrations().some((n) => n.kind === "opening")).toBe(true);

    let state = h.turnStateStore.get(ROOM_ID) as TurnState;
    expect(state.roundNumber).toBe(1);
    expect(state.phase).toBe("free_chat");

    // Free chat is accepted and attributed to the sender's character (R6.x).
    await h.orchestrator.dispatch(ROOM_ID, { type: "SEND_CHAT", from: HOST, text: "정찰한다" });
    state = h.turnStateStore.get(ROOM_ID) as TurnState;
    expect(state.chatLog).toHaveLength(1);
    expect(state.chatLog[0]?.characterName).toBe("Aria");

    // Both players confirm; the round resolves and advances to round 2 (R10.5).
    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "문을 연다" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: PLAYER_2, action: "엄호한다" });
    await h.orchestrator.whenSettled();

    expect(coordinator.resolveCalls).toBe(1);
    state = h.turnStateStore.get(ROOM_ID) as TurnState;
    expect(state.roundNumber).toBe(2);
    expect(state.phase).toBe("free_chat");
    expect(state.readiness.every((r) => r.status === "not_ready")).toBe(true);

    // The resolution narration was delivered (R10.4, R15.5).
    expect(h.connection.narrations().some((n) => n.kind === "resolution" && n.roundNumber === 1)).toBe(true);
  });

  it("declares pending checks and waits for the owning player roll before narration", async () => {
    const coordinator = new FakeCoordinator({
      declaredChecks: [
        {
          checkId: "round-1-check-1",
          characterId: "c1",
          playerId: HOST,
          characterName: "Aria",
          attribute: "Might",
          difficulty: "Average",
          advantage: "none",
          visibility: "player",
          attributeLevel: 0,
        },
      ],
    });
    const h = makeHarness(coordinator);
    await start(h);

    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "문을 연다" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    expect(coordinator.declareCalls).toBe(1);
    expect(coordinator.narrateCalls).toBe(0);
    expect(h.turnStateStore.get(ROOM_ID)?.phase).toBe("rolling");
    expect(h.connection.checksPending()).toHaveLength(1);
    expect(h.connection.checksPending()[0]?.checks[0]).toMatchObject({
      checkId: "round-1-check-1",
      playerId: HOST,
      characterName: "Aria",
      attribute: "Might",
      difficulty: "Average",
      status: "pending",
    });
    expect(h.connection.narrations().some((n) => n.kind === "resolution")).toBe(false);

    await h.orchestrator.dispatch(ROOM_ID, {
      type: "ROLL_CHECK",
      from: HOST,
      checkId: "round-1-check-1",
    });
    await h.orchestrator.whenSettled();

    expect(coordinator.rollCalls).toBe(1);
    expect(coordinator.narrateCalls).toBe(1);
    expect(h.connection.checksRolled()).toHaveLength(1);
    expect(h.connection.checksRolled()[0]?.check).toMatchObject({
      checkId: "round-1-check-1",
      roll: 1,
      outcome: "Success",
    });
    expect(h.connection.narrations().some((n) => n.kind === "resolution" && n.roundNumber === 1)).toBe(true);
  });

  it("rejects non-owner roll commands and treats duplicate owner rolls as idempotent", async () => {
    const coordinator = new FakeCoordinator({
      declaredChecks: [
        {
          checkId: "round-1-check-1",
          characterId: "c1",
          playerId: HOST,
          characterName: "Aria",
          attribute: "Might",
          difficulty: "Average",
          advantage: "none",
          visibility: "player",
          attributeLevel: 0,
        },
      ],
    });
    const h = makeHarness(coordinator);
    await start(h);

    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "문을 연다" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    await h.orchestrator.dispatch(ROOM_ID, {
      type: "ROLL_CHECK",
      from: PLAYER_2,
      checkId: "round-1-check-1",
    });
    await h.orchestrator.whenSettled();

    expect(coordinator.rollCalls).toBe(0);
    expect(h.connection.checksRolled()).toHaveLength(0);
    expect(h.turnStateStore.get(ROOM_ID)?.rollingChecks?.[0]?.status).toBe("pending");

    await h.orchestrator.dispatch(ROOM_ID, {
      type: "ROLL_CHECK",
      from: HOST,
      checkId: "round-1-check-1",
    });
    await h.orchestrator.dispatch(ROOM_ID, {
      type: "ROLL_CHECK",
      from: HOST,
      checkId: "round-1-check-1",
    });
    await h.orchestrator.whenSettled();

    expect(coordinator.rollCalls).toBe(1);
    expect(h.connection.checksRolled()).toHaveLength(1);
  });

  it("does not narrate until every pending check is rolled", async () => {
    const coordinator = new FakeCoordinator({
      declaredChecks: [
        {
          checkId: "round-1-check-1",
          characterId: "c1",
          playerId: HOST,
          characterName: "Aria",
          attribute: "Might",
          difficulty: "Average",
          advantage: "none",
          visibility: "player",
          attributeLevel: 0,
        },
        {
          checkId: "round-1-check-2",
          characterId: "c2",
          playerId: PLAYER_2,
          characterName: "Borin",
          attribute: "Spirit",
          difficulty: "Hard",
          advantage: "none",
          visibility: "player",
          attributeLevel: 1,
        },
      ],
    });
    const h = makeHarness(coordinator);
    await start(h);
    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "a" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    await h.orchestrator.dispatch(ROOM_ID, { type: "ROLL_CHECK", from: HOST, checkId: "round-1-check-1" });
    await h.orchestrator.whenSettled();

    expect(coordinator.narrateCalls).toBe(0);
    expect(h.connection.narrations().some((n) => n.kind === "resolution")).toBe(false);

    await h.orchestrator.dispatch(ROOM_ID, { type: "ROLL_CHECK", from: PLAYER_2, checkId: "round-1-check-2" });
    await h.orchestrator.whenSettled();

    expect(coordinator.narrateCalls).toBe(1);
    expect(h.connection.narrations().some((n) => n.kind === "resolution")).toBe(true);
  });

  it("enforces declaration order for player rolls and refreshes the next turn deadline", async () => {
    const clock = makeClock();
    const coordinator = new FakeCoordinator({
      declaredChecks: [
        {
          checkId: "round-1-check-1",
          characterId: "c1",
          playerId: HOST,
          characterName: "Aria",
          attribute: "Might",
          difficulty: "Average",
          advantage: "none",
          visibility: "player",
          attributeLevel: 0,
        },
        {
          checkId: "round-1-check-2",
          characterId: "c2",
          playerId: PLAYER_2,
          characterName: "Borin",
          attribute: "Spirit",
          difficulty: "Hard",
          advantage: "none",
          visibility: "player",
          attributeLevel: 1,
        },
      ],
    });
    const h = makeHarness(coordinator, clock);
    await start(h);
    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "a" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    const initialDeadline = h.turnStateStore.get(ROOM_ID)?.rollCheckDeadline;
    await h.orchestrator.dispatch(ROOM_ID, { type: "ROLL_CHECK", from: PLAYER_2, checkId: "round-1-check-2" });
    await h.orchestrator.whenSettled();

    expect(coordinator.rollCalls).toBe(0);
    expect(h.connection.checksRolled()).toHaveLength(0);
    expect(h.turnStateStore.get(ROOM_ID)?.rollingChecks?.map((check) => check.status)).toEqual([
      "pending",
      "pending",
    ]);

    clock.advance(1_000);
    await h.orchestrator.dispatch(ROOM_ID, { type: "ROLL_CHECK", from: HOST, checkId: "round-1-check-1" });
    await h.orchestrator.whenSettled();

    const afterFirst = h.turnStateStore.get(ROOM_ID);
    expect(coordinator.rollCalls).toBe(1);
    expect(afterFirst?.rollingChecks?.map((check) => check.status)).toEqual(["rolled", "pending"]);
    expect(afterFirst?.rollCheckDeadline).not.toBe(initialDeadline);
    expect(afterFirst?.rollCheckDeadline).not.toBeNull();
    expect(coordinator.narrateCalls).toBe(0);

    await h.orchestrator.dispatch(ROOM_ID, { type: "ROLL_CHECK", from: PLAYER_2, checkId: "round-1-check-2" });
    await h.orchestrator.whenSettled();

    expect(coordinator.rollCalls).toBe(2);
    expect(h.connection.checksRolled().map((event) => event.check.checkId)).toEqual([
      "round-1-check-1",
      "round-1-check-2",
    ]);
    expect(h.turnStateStore.get(ROOM_ID)?.rollCheckDeadline).toBeNull();
    expect(coordinator.narrateCalls).toBe(1);
  });

  it("auto-rolls pending checks on timeout and proceeds to narration", async () => {
    const timers = makeManualTimers();
    const coordinator = new FakeCoordinator({
      declaredChecks: [
        {
          checkId: "round-1-check-1",
          characterId: "c1",
          playerId: HOST,
          characterName: "Aria",
          attribute: "Might",
          difficulty: "Average",
          advantage: "none",
          visibility: "player",
          attributeLevel: 0,
        },
      ],
    });
    const h = makeHarness(coordinator, makeClock(), undefined, undefined, undefined, timers);
    await start(h);
    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "a" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    timers.runLatest();
    await h.orchestrator.whenSettled();

    expect(coordinator.rollCalls).toBe(1);
    expect(coordinator.narrateCalls).toBe(1);
    expect(h.connection.checksRolled()[0]?.check).toMatchObject({
      checkId: "round-1-check-1",
      autoRolled: true,
    });
    expect(h.connection.narrations().some((n) => n.kind === "resolution")).toBe(true);
  });

  it("auto-rolls only the active check per timeout and rearms for the next check", async () => {
    const timers = makeManualTimers();
    const coordinator = new FakeCoordinator({
      declaredChecks: [
        {
          checkId: "round-1-check-1",
          characterId: "c1",
          playerId: HOST,
          characterName: "Aria",
          attribute: "Might",
          difficulty: "Average",
          advantage: "none",
          visibility: "player",
          attributeLevel: 0,
        },
        {
          checkId: "round-1-check-2",
          characterId: "c2",
          playerId: PLAYER_2,
          characterName: "Borin",
          attribute: "Spirit",
          difficulty: "Hard",
          advantage: "none",
          visibility: "player",
          attributeLevel: 1,
        },
      ],
    });
    const h = makeHarness(coordinator, makeClock(), undefined, undefined, undefined, timers);
    await start(h);
    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "a" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    timers.runLatest();
    await h.orchestrator.whenSettled();

    expect(coordinator.rollCalls).toBe(1);
    expect(coordinator.narrateCalls).toBe(0);
    expect(h.connection.checksRolled()).toHaveLength(1);
    expect(h.connection.checksRolled()[0]?.check).toMatchObject({
      checkId: "round-1-check-1",
      autoRolled: true,
    });
    expect(h.turnStateStore.get(ROOM_ID)?.rollingChecks?.map((check) => check.status)).toEqual([
      "rolled",
      "pending",
    ]);
    expect(timers.pendingCount()).toBe(1);

    timers.runLatest();
    await h.orchestrator.whenSettled();

    expect(coordinator.rollCalls).toBe(2);
    expect(coordinator.narrateCalls).toBe(1);
    expect(h.connection.checksRolled()[1]?.check).toMatchObject({
      checkId: "round-1-check-2",
      autoRolled: true,
    });
    expect(h.turnStateStore.get(ROOM_ID)?.rollCheckDeadline).toBeNull();
    expect(h.connection.narrations().some((n) => n.kind === "resolution")).toBe(true);
  });

  it("rolls hidden and ownerless declarations immediately before the first owned active check", async () => {
    const coordinator = new FakeCoordinator({
      declaredChecks: [
        {
          checkId: "round-1-hidden",
          characterId: "gm-char",
          playerId: null,
          characterName: "GM",
          attribute: "Wits",
          difficulty: "Average",
          advantage: "none",
          visibility: "gm",
          attributeLevel: 0,
        },
        {
          checkId: "round-1-ownerless",
          characterId: "npc-char",
          playerId: null,
          characterName: "NPC",
          attribute: "Agility",
          difficulty: "Average",
          advantage: "none",
          visibility: "player",
          attributeLevel: 0,
        },
        {
          checkId: "round-1-check-1",
          characterId: "c1",
          playerId: HOST,
          characterName: "Aria",
          attribute: "Might",
          difficulty: "Average",
          advantage: "none",
          visibility: "player",
          attributeLevel: 0,
        },
      ],
    });
    const h = makeHarness(coordinator);
    await start(h);
    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "a" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    expect(coordinator.rollCalls).toBe(2);
    expect(coordinator.narrateCalls).toBe(0);
    expect(h.connection.checksPending()[0]?.checks.map((check) => check.checkId)).toEqual([
      "round-1-ownerless",
      "round-1-check-1",
    ]);
    expect(h.connection.checksRolled()).toHaveLength(1);
    expect(h.connection.checksRolled()[0]?.check).toMatchObject({
      checkId: "round-1-ownerless",
      status: "rolled",
      autoRolled: true,
    });
    expect(h.turnStateStore.get(ROOM_ID)?.rollingChecks).toMatchObject([
      { checkId: "round-1-ownerless", status: "rolled" },
      { checkId: "round-1-check-1", status: "pending" },
    ]);

    await h.orchestrator.dispatch(ROOM_ID, { type: "ROLL_CHECK", from: HOST, checkId: "round-1-check-1" });
    await h.orchestrator.whenSettled();

    expect(coordinator.rollCalls).toBe(3);
    expect(coordinator.narrateCalls).toBe(1);
  });

  it("seeds scenario clocks, supplies them to resolution, and persists the applied result", async () => {
    const clockStore = new InMemoryClockStore();
    const coordinator = new FakeCoordinator({
      resolve: (input) => ({
        ok: true,
        narration: "결과 내레이션",
        checks: [],
        endingReached: false,
        context: input as unknown as TurnStateContext,
        // Engine applies a +1 to every supplied clock this round.
        clocks: (input.clocks ?? []).map((c) => ({ ...c, value: c.value + 1 })),
        firedClocks: [],
      }),
    });
    const h = makeHarness(coordinator, makeClock(), clockStore);

    await start(h);

    // Scenario clocks seeded at session start (the-sunless-crypt).
    const seeded = clockStore.get(ROOM_ID);
    expect(seeded.map((c) => c.id).sort()).toEqual(["crypt_alert", "ritual_progress"]);
    expect(seeded.every((c) => c.value === 0)).toBe(true);

    // Drive a round to resolution.
    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "a" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    // The seeded clocks were supplied to resolveRound...
    expect(coordinator.lastResolveInput?.clocks?.map((c) => c.id).sort()).toEqual([
      "crypt_alert",
      "ritual_progress",
    ]);
    // ...and the engine-applied result was persisted.
    const persisted = clockStore.get(ROOM_ID);
    expect(persisted.every((c) => c.value === 1)).toBe(true);
  });

  it("resolves with no clocks when no clock store is wired (prior behaviour)", async () => {
    const coordinator = new FakeCoordinator();
    const h = makeHarness(coordinator); // no clockStore

    await start(h);
    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "a" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    expect(coordinator.resolveCalls).toBe(1);
    expect(coordinator.lastResolveInput?.clocks).toBeUndefined();
  });

  it("seeds + supplies + persists the scene, and surfaces visible clocks in narration", async () => {
    const clockStore = new InMemoryClockStore();
    const sceneStore = new InMemorySceneStore();
    const coordinator = new FakeCoordinator({
      resolve: (input) => {
        const clocks = (input.clocks ?? []).map((c) => ({ ...c, value: c.value + 1 }));
        // Echo the supplied scene with one clue revealed (omit scene entirely
        // when none was supplied — exactOptionalPropertyTypes forbids `undefined`).
        if (input.scene) {
          return {
            ok: true,
            narration: "결과 내레이션",
            checks: [],
            endingReached: false,
            context: input as unknown as TurnStateContext,
            clocks,
            firedClocks: [],
            scene: { ...input.scene, availableClues: [], revealedClues: ["small_footprints"] },
          } satisfies ResolveRoundResult;
        }
        return {
          ok: true,
          narration: "결과 내레이션",
          checks: [],
          endingReached: false,
          context: input as unknown as TurnStateContext,
          clocks,
          firedClocks: [],
        } satisfies ResolveRoundResult;
      },
    });
    const h = makeHarness(coordinator, makeClock(), clockStore, sceneStore);

    await start(h);

    // Scenario scene seeded at session start (the-sunless-crypt).
    const seededScene = sceneStore.get(ROOM_ID);
    expect(seededScene?.sceneId).toBe("crypt_entrance");
    expect(seededScene?.availableClues).toContain("small_footprints");

    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "a" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    // Scene was supplied to resolveRound...
    expect(coordinator.lastResolveInput?.scene?.sceneId).toBe("crypt_entrance");
    // ...and the engine-applied scene was persisted (clue moved to revealed).
    expect(sceneStore.get(ROOM_ID)?.revealedClues).toContain("small_footprints");

    // the-sunless-crypt is a clock-visible scenario: the resolution narration
    // payload carries the clock gauges.
    const resolution = h.connection.narrations().find((n) => n.kind === "resolution");
    expect(resolution?.clocks).toBeDefined();
    expect(resolution?.clocks?.map((c) => c.name)).toContain("묘지 경계도");
  });

  it("emits a room-visible failure event when opening narration fails", async () => {
    const h = makeHarness(new FakeCoordinator({ openingFailure: "model timeout" }));

    await start(h);

    expect(h.connection.narrationFailures()).toContainEqual({
      type: "narration_failed",
      roomId: ROOM_ID,
      phase: "opening",
      reason: "model timeout",
      retryable: true,
    });
    expect(h.connection.narrations().some((n) => n.kind === "opening")).toBe(false);
  });

  it("seeds, supplies, and persists character states across resolved rounds", async () => {
    const characterStateStore = new InMemoryCharacterStateStore();
    const coordinator = new FakeCoordinator({
      resolve: (input) => ({
        ok: true,
        narration: "결과 내레이션",
        checks: [],
        endingReached: false,
        context: input as unknown as TurnStateContext,
        characterStates: (input.characterStates ?? []).map((state) =>
          state.characterId === "c1"
            ? makeCharacterState({
                ...state,
                conditions: [
                  ...state.conditions,
                  { name: `round-${input.state.roundNumber}`, reason: "test" },
                ],
              })
            : state,
        ),
      }),
    });
    const h = makeHarness(coordinator, makeClock(), undefined, undefined, characterStateStore);

    await start(h);

    expect(characterStateStore.get(ROOM_ID).map((state) => state.characterId).sort()).toEqual(["c1", "c2"]);

    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "a" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    expect(characterStateStore.get(ROOM_ID).find((state) => state.characterId === "c1")?.conditions).toContainEqual({
      name: "round-1",
      reason: "test",
    });

    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "b" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    expect(coordinator.resolveInputs[1]?.characterStates?.find((state) => state.characterId === "c1")?.conditions).toContainEqual({
      name: "round-1",
      reason: "test",
    });
    expect(characterStateStore.get(ROOM_ID).find((state) => state.characterId === "c1")?.conditions).toContainEqual({
      name: "round-2",
      reason: "test",
    });
  });

  it("converges interleaved readiness commands and resolves exactly once", async () => {
    const coordinator = new FakeCoordinator();
    const h = makeHarness(coordinator);
    await start(h);

    // Fire readiness commands "concurrently"; the per-room queue serializes them
    // so the final state reflects every player's final submission (R13.6). The
    // host revises before the last player readies, so the revision is retained.
    await Promise.all([
      h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "a" }),
      h.orchestrator.dispatch(ROOM_ID, { type: "REVISE", from: HOST, action: "a2" }),
      h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 }),
    ]);
    await h.orchestrator.whenSettled();

    const state = h.turnStateStore.get(ROOM_ID) as TurnState;
    expect(state.roundNumber).toBe(2); // advanced after a single resolution
    expect(coordinator.resolveCalls).toBe(1);
    // The resolved round's recorded action reflected the host's final revision.
    const hostAction = coordinator.lastResolveInput?.state.readiness.find((r) => r.playerId === HOST);
    expect(hostAction?.actionText).toBe("a2");
  });

  it("issues at most one resolution when all-ready races force-proceed", async () => {
    const coordinator = new FakeCoordinator();
    const h = makeHarness(coordinator);
    await start(h);

    await Promise.all([
      h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "a" }),
      h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: PLAYER_2, action: "b" }),
      h.orchestrator.dispatch(ROOM_ID, { type: "FORCE_PROCEED", by: HOST }),
    ]);
    await h.orchestrator.whenSettled();

    expect(coordinator.resolveCalls).toBe(1);
  });

  it("emits one round_timing event per round with both timestamps", async () => {
    const clock = makeClock();
    // The AI 'takes' 1500ms, so all-ready and narration-returned differ.
    const coordinator = new FakeCoordinator({ onResolve: () => clock.advance(1500) });
    const h = makeHarness(coordinator, clock);
    await start(h);

    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "a" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();
    await h.sink.flush();

    const timings = h.sink
      .queryByRound(ROOM_ID, 1)
      .filter((e): e is RoundTimingEvent => e.eventType === "round_timing");
    expect(timings).toHaveLength(1);
    const timing = timings[0] as RoundTimingEvent;
    expect(Number.isNaN(Date.parse(timing.allReadyAt))).toBe(false);
    expect(Number.isNaN(Date.parse(timing.narrationReturnedAt))).toBe(false);
    expect(timing.latencyMs).toBe(1500);
  });

  it("persists a Session_Summary and ends the room on the ending path", async () => {
    const coordinator = new FakeCoordinator({
      resolve: () => ({ ok: true, narration: "마지막 내레이션", checks: [], endingReached: true, context: {} as TurnStateContext }),
      ending: { closing: "막을 내린다", summary: { text: "키 이벤트 요약" } },
    });
    const h = makeHarness(coordinator);
    await start(h);

    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "a" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    const state = h.turnStateStore.get(ROOM_ID) as TurnState;
    expect(state.phase).toBe("ended");

    expect(coordinator.endingCalls).toBe(1);
    const summary = await h.summaries.get(ROOM_ID);
    expect(summary?.closingNarration).toBe("막을 내린다");
    expect(summary?.summaryText).toBe("키 이벤트 요약");

    // Room marked ended (R15.6) and closing narration delivered (R15.5).
    expect(h.roomStore.getRoom(ROOM_ID)?.state).toBe("ended");
    expect(h.connection.narrations().some((n) => n.kind === "closing")).toBe(true);
  });

  it("passes confirmed blackboard, clock, and visible memory facts to ending generation", async () => {
    const clockStore = new InMemoryClockStore();
    const blackboardStore = new InMemoryBlackboardStore();
    const memoryStore = new InMemoryMemoryStore();
    const coordinator = new FakeCoordinator({
      resolve: () => ({ ok: true, narration: "마지막 내레이션", checks: [], endingReached: true, context: {} as TurnStateContext }),
      ending: { closing: "막을 내린다", summary: { text: "키 이벤트 요약" } },
    });
    const h = makeHarness(
      coordinator,
      makeClock(),
      clockStore,
      undefined,
      undefined,
      undefined,
      { blackboardStore, memoryStore },
    );
    await start(h);

    blackboardStore.save(ROOM_ID, {
      ...createEmptyBlackboard(ROOM_ID, "scenario-1"),
      clues: [
        {
          id: "seen-clue",
          conclusion: "발견된 결론",
          discoveryCondition: { kind: "action_intent", intent: "inspect" },
          visibility: "discovered",
        },
      ],
    });
    clockStore.save(ROOM_ID, [
      makeProgressClock({
        id: "bell",
        name: "종소리",
        scope: "front",
        max: 6,
        value: 2,
        onComplete: "bell_tolls",
      }),
    ]);
    memoryStore.save(ROOM_ID, [
      {
        id: "mem-1",
        roomId: ROOM_ID,
        kind: "player_choice",
        summary: "플레이어가 낙서를 조사했다.",
        salience: 0.5,
        visibility: "player_visible",
        sourceEventIds: ["round-1"],
      },
    ]);

    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "a" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    expect(coordinator.lastEndingOptions?.blackboard?.clues[0]?.id).toBe("seen-clue");
    expect(coordinator.lastEndingOptions?.clocks?.[0]?.name).toBe("종소리");
    expect(coordinator.lastEndingOptions?.memories?.[0]?.summary).toBe("플레이어가 낙서를 조사했다.");
  });

  it("emits a room-visible failure event when ending narration fails", async () => {
    const coordinator = new FakeCoordinator({
      resolve: () => ({ ok: true, narration: "마지막 내레이션", checks: [], endingReached: true, context: {} as TurnStateContext }),
      endingFailure: "invalid ending output",
    });
    const h = makeHarness(coordinator);
    await start(h);

    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "a" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    expect(coordinator.endingCalls).toBe(1);
    expect(await h.summaries.get(ROOM_ID)).toBeUndefined();
    expect(h.roomStore.getRoom(ROOM_ID)?.state).toBe("in_session");
    expect(h.connection.narrationFailures()).toContainEqual({
      type: "narration_failed",
      roomId: ROOM_ID,
      phase: "ending",
      reason: "invalid ending output",
      retryable: true,
    });
  });

  it("preserves recorded actions when AI resolution fails", async () => {
    const coordinator = new FakeCoordinator({
      resolve: (input) => ({
        ok: false,
        error: { reason: "ai_request_failed", message: "boom" },
        preservedState: { ...input.state, resolutionRequested: false },
      }),
    });
    const h = makeHarness(coordinator);
    await start(h);

    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "문을 연다" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    const state = h.turnStateStore.get(ROOM_ID) as TurnState;
    // Round did NOT advance; it reverted to ready_check for retry (R17.2).
    expect(state.roundNumber).toBe(1);
    expect(state.phase).toBe("ready_check");
    expect(state.resolutionRequested).toBe(false);
    // Recorded actions/passes are intact (R17.4).
    const host = state.readiness.find((r) => r.playerId === HOST);
    const p2 = state.readiness.find((r) => r.playerId === PLAYER_2);
    expect(host?.actionText).toBe("문을 연다");
    expect(host?.status).toBe("ready");
    expect(p2?.actionKind).toBe("pass");
  });

  it("broadcasts retrying declaration failures and retries all-ready rounds after five seconds", async () => {
    let declarationAttempts = 0;
    const timers = makeManualTimers();
    const coordinator = new FakeCoordinator({
      declare: (input) => {
        declarationAttempts += 1;
        if (declarationAttempts === 1) {
          return {
            ok: false,
            error: { reason: "ai_request_failed", message: "declaration boom" },
            preservedState: { ...input.state, resolutionRequested: false },
          };
        }
        return {
          ok: true,
          declaration: {
            state: input.state,
            context: input as unknown as TurnStateContext,
            decision: {} as RoundDeclaration["decision"],
            checks: [],
            procedurePlan: {} as RoundDeclaration["procedurePlan"],
            correlation: {} as RoundDeclaration["correlation"],
          },
        };
      },
    });
    const h = makeHarness(coordinator, makeClock(), undefined, undefined, undefined, timers);
    await start(h);

    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "문을 연다" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    expect(coordinator.declareCalls).toBe(1);
    expect(timers.pendingCount()).toBe(1);
    expect(timers.latestDelayMs()).toBe(5_000);
    expect(h.connection.narrationFailures()).toContainEqual({
      type: "narration_failed",
      roomId: ROOM_ID,
      phase: "resolution",
      reason: "declaration boom",
      retryable: true,
      retrying: true,
    });

    timers.runLatest();
    await h.orchestrator.whenSettled();

    expect(coordinator.declareCalls).toBe(2);
    expect(h.connection.narrations().some((n) => n.kind === "resolution")).toBe(true);
  });

  it("broadcasts retrying narration failures and retries declared narration after five seconds", async () => {
    let narrateAttempts = 0;
    const timers = makeManualTimers();
    const coordinator = new FakeCoordinator({
      narrate: (input) => {
        narrateAttempts += 1;
        if (narrateAttempts === 1) {
          return {
            ok: false,
            error: { reason: "ai_request_failed", message: "narration boom" },
            preservedState: { ...input.declaration.state, resolutionRequested: false },
          };
        }
        return {
          ok: true,
          narration: "재시도 결과 내레이션",
          checks: input.resolvedChecks,
          endingReached: false,
          context: input.declaration.context,
        };
      },
    });
    const h = makeHarness(coordinator, makeClock(), undefined, undefined, undefined, timers);
    await start(h);

    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "문을 연다" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    expect(coordinator.narrateCalls).toBe(1);
    expect(timers.pendingCount()).toBe(1);
    expect(timers.latestDelayMs()).toBe(5_000);
    expect(h.connection.narrationFailures()).toContainEqual({
      type: "narration_failed",
      roomId: ROOM_ID,
      phase: "resolution",
      reason: "narration boom",
      retryable: true,
      retrying: true,
    });

    timers.runLatest();
    await h.orchestrator.whenSettled();

    expect(coordinator.narrateCalls).toBe(2);
    expect(h.connection.narrations().some((n) => n.kind === "resolution" && n.text === "재시도 결과 내레이션")).toBe(true);
  });

  it("caps automatic ready-check retries after repeated AI resolution failures", async () => {
    const coordinator = new FakeCoordinator({
      resolve: (input) => ({
        ok: false,
        error: { reason: "ai_request_failed", message: "boom" },
        preservedState: { ...input.state, resolutionRequested: false },
      }),
    });
    const timers = makeManualTimers();
    const h = makeHarness(coordinator, makeClock(), undefined, undefined, undefined, timers);
    await start(h);

    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "문을 연다" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    expect(coordinator.resolveCalls).toBe(1);
    expect(timers.pendingCount()).toBe(1);
    expect(h.connection.narrationFailures().at(-1)).toMatchObject({ retrying: true });

    timers.runLatest();
    await h.orchestrator.whenSettled();

    expect(coordinator.resolveCalls).toBe(2);
    expect(timers.pendingCount()).toBe(0);
    expect(h.connection.narrationFailures().at(-1)).toEqual({
      type: "narration_failed",
      roomId: ROOM_ID,
      phase: "resolution",
      reason: "automatic retries exhausted",
      retryable: true,
    });
  });

  it("falls back to the ready-check timeout when reverted players are not all ready", async () => {
    const timers = makeManualTimers();
    let h: Harness;
    const coordinator = new FakeCoordinator({
      declare: (input) => {
        const current = h.turnStateStore.get(ROOM_ID) as TurnState;
        h.turnStateStore.save({
          ...current,
          readiness: current.readiness.map((entry) =>
            entry.playerId === PLAYER_2
              ? { playerId: entry.playerId, status: "not_ready", actionKind: null, actionText: null }
              : entry,
          ),
        });
        return {
          ok: false,
          error: { reason: "ai_request_failed", message: "declaration boom" },
          preservedState: { ...input.state, resolutionRequested: false },
        };
      },
    });
    h = makeHarness(coordinator, makeClock(), undefined, undefined, undefined, timers);
    await start(h);

    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "문을 연다" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await h.orchestrator.whenSettled();

    expect(h.turnStateStore.get(ROOM_ID)?.phase).toBe("ready_check");
    expect(h.turnStateStore.get(ROOM_ID)?.readiness.find((entry) => entry.playerId === PLAYER_2)?.status).toBe("not_ready");
    expect(timers.pendingCount()).toBe(1);
    expect(timers.latestDelayMs()).toBe(DEFAULT_ENGINE_CONFIG.readyCheckTimeoutMs);
    expect(h.connection.narrationFailures()).toContainEqual({
      type: "narration_failed",
      roomId: ROOM_ID,
      phase: "resolution",
      reason: "declaration boom",
      retryable: true,
      retrying: true,
    });
  });

  it("attaches the sender's room display name alongside the character name on chat", async () => {
    const coordinator = new FakeCoordinator();
    const h = makeHarness(coordinator);

    // Re-seed the host with a character name distinct from the room join name so
    // the UI can render `characterName(displayName)` (e.g. "알렉스(라면)").
    h.roomStore.savePlayer({
      id: HOST,
      roomId: ROOM_ID,
      displayName: "라면",
      isHost: true,
      characterId: "c1",
      connectionStatus: "connected",
    });
    h.roomStore.saveCharacter({
      id: "c1",
      playerId: HOST,
      roomId: ROOM_ID,
      name: "알렉스",
      concept: "scout",
      attributes: { Might: 0, Agility: 2, Wits: 1, Spirit: 0 },
      confirmed: true,
    });

    await start(h);

    await h.orchestrator.dispatch(ROOM_ID, { type: "SEND_CHAT", from: HOST, text: "정찰한다" });

    const state = h.turnStateStore.get(ROOM_ID) as TurnState;
    expect(state.chatLog).toHaveLength(1);
    const entry = state.chatLog[0];
    // characterName stays the pure character name; displayName carries the room
    // join name separately so the UI can show "알렉스(라면)".
    expect(entry?.characterName).toBe("알렉스");
    expect(entry?.displayName).toBe("라면");

    // The broadcast Turn_State carries the same attribution.
    const broadcast = h.connection.turnStates().at(-1) as TurnState;
    expect(broadcast.chatLog[0]?.characterName).toBe("알렉스");
    expect(broadcast.chatLog[0]?.displayName).toBe("라면");
  });

  it("treats an ended room's Turn_State as terminal", async () => {
    // Sanity: a pre-seeded ended Turn_State rejects further start (R15.7).
    const coordinator = new FakeCoordinator();
    const h = makeHarness(coordinator);
    const ended = createInitialTurnState(ROOM_ID, { roundNumber: 3, phase: "ended" });
    h.turnStateStore.save(ended);

    await h.orchestrator.dispatch(ROOM_ID, { type: "START_SESSION", by: HOST });
    await h.orchestrator.whenSettled();

    const state = h.turnStateStore.get(ROOM_ID) as TurnState;
    expect(state.phase).toBe("ended");
    expect(coordinator.openingCalls).toBe(0);
  });
});

describe("RoomOrchestrator — opening gate (T-2)", () => {
  // Let the queued command + tracked resolution IIFE run up to their first
  // suspension (the `await opening`) without releasing the opening gate.
  const flush = () => new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

  it("does not start round resolution until the opening narration settles", async () => {
    let releaseOpening!: () => void;
    const openingGate = new Promise<void>((resolve) => {
      releaseOpening = resolve;
    });
    const coordinator = new FakeCoordinator({ openingGate, declaredChecks: [] });
    const h = makeHarness(coordinator);

    // Start the session but DO NOT drain — the opening is held pending.
    await h.orchestrator.dispatch(ROOM_ID, { type: "START_SESSION", by: HOST });
    // Both players go all-ready BEFORE the opening returns (the F4 race).
    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "달린다" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await flush();

    // The round entered resolving, but the GM decision is GATED behind opening.
    expect((h.turnStateStore.get(ROOM_ID) as TurnState).phase).toBe("resolving");
    expect(coordinator.openingCalls).toBe(1);
    expect(coordinator.declareCalls).toBe(0);
    expect(h.connection.checksPending()).toHaveLength(0);

    // Release the opening → resolution proceeds automatically.
    releaseOpening();
    await h.orchestrator.whenSettled();
    expect(coordinator.declareCalls).toBeGreaterThan(0);
  });

  it("still starts resolution when the opening generation fails (never wedges)", async () => {
    let releaseOpening!: () => void;
    const openingGate = new Promise<void>((resolve) => {
      releaseOpening = resolve;
    });
    const coordinator = new FakeCoordinator({ openingGate, openingFailure: "boom", declaredChecks: [] });
    const h = makeHarness(coordinator);

    await h.orchestrator.dispatch(ROOM_ID, { type: "START_SESSION", by: HOST });
    await h.orchestrator.dispatch(ROOM_ID, { type: "CONFIRM_ACTION", from: HOST, action: "달린다" });
    await h.orchestrator.dispatch(ROOM_ID, { type: "PASS", from: PLAYER_2 });
    await flush();
    expect(coordinator.declareCalls).toBe(0);

    // A FAILED opening must release the gate too, or the round wedges forever.
    releaseOpening();
    await h.orchestrator.whenSettled();
    expect(coordinator.declareCalls).toBeGreaterThan(0);
  });
});
