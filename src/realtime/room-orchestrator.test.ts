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
import type { TurnState } from "../core/turn-state.js";
import { InMemoryRoomStore } from "../services/room-store.js";
import { InMemoryTurnStateStore } from "../services/turn-state-store.js";
import { InMemoryClockStore } from "../services/clock-store.js";
import { InMemorySceneStore } from "../services/scene-store.js";
import { MVP_SCENARIO, ScenarioService } from "../services/scenario-service.js";
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
  GenerationResult,
  Narration,
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
}

/** A programmable fake coordinator implementing the orchestrator's port. */
class FakeCoordinator implements OrchestratorCoordinator {
  resolveCalls = 0;
  openingCalls = 0;
  endingCalls = 0;
  lastResolveInput: ResolveRoundInput | undefined;

  constructor(
    private readonly opts: {
      resolve?: (input: ResolveRoundInput) => ResolveRoundResult;
      opening?: Narration;
      ending?: { closing: Narration; summary: SessionSummary };
      /** Side effect run synchronously inside resolveRound (e.g. advance clock). */
      onResolve?: () => void;
    } = {},
  ) {}

  resolveRound(input: ResolveRoundInput): Promise<ResolveRoundResult> {
    this.resolveCalls += 1;
    this.lastResolveInput = input;
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

  generateOpening(): Promise<GenerationResult<Narration>> {
    this.openingCalls += 1;
    return Promise.resolve({ ok: true, value: this.opts.opening ?? "오프닝 내레이션" });
  }

  generateEnding(): Promise<GenerationResult<{ closing: Narration; summary: SessionSummary }>> {
    this.endingCalls += 1;
    return Promise.resolve({
      ok: true,
      value: this.opts.ending ?? { closing: "엔딩 내레이션", summary: { text: "세션 요약" } },
    });
  }
}

interface Harness {
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
}

/** Build a room with a host + one other player, both with confirmed characters. */
function seedRoom(roomStore: InMemoryRoomStore): void {
  const room: Room = {
    id: ROOM_ID,
    inviteToken: "tok",
    hostPlayerId: HOST,
    scenarioId: MVP_SCENARIO.id,
    state: "in_session",
    maxPlayers: 6,
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  roomStore.saveRoom(room);
  const players: Player[] = [
    { id: HOST, roomId: ROOM_ID, displayName: "Aria", isHost: true, characterId: "c1", connectionStatus: "connected" },
    { id: PLAYER_2, roomId: ROOM_ID, displayName: "Borin", isHost: false, characterId: "c2", connectionStatus: "connected" },
  ];
  for (const p of players) roomStore.savePlayer(p);
  const characters: Character[] = [
    { id: "c1", playerId: HOST, roomId: ROOM_ID, name: "Aria", concept: "scout", attributes: { Might: 0, Agility: 2, Wits: 1, Spirit: 0 }, confirmed: true },
    { id: "c2", playerId: PLAYER_2, roomId: ROOM_ID, name: "Borin", concept: "smith", attributes: { Might: 2, Agility: 0, Wits: 0, Spirit: 1 }, confirmed: true },
  ];
  for (const c of characters) roomStore.saveCharacter(c);
}

function makeHarness(
  coordinator: FakeCoordinator,
  clock = makeClock(),
  clockStore?: InMemoryClockStore,
  sceneStore?: InMemorySceneStore,
): Harness {
  const roomStore = new InMemoryRoomStore();
  const turnStateStore = new InMemoryTurnStateStore();
  const summaries = new InMemorySessionSummaryRepository();
  const sink = new InMemoryEventSink();
  seedRoom(roomStore);

  const gateway = new RealtimeGateway({ getTurnState: (id) => turnStateStore.get(id) });
  const connection = new FakeConnection("conn-1", ROOM_ID, HOST);
  gateway.connect(connection);

  const orchestrator = new RoomOrchestrator({
    store: turnStateStore,
    gateway,
    coordinator,
    roomReader: roomStore,
    scenarioResolver: new ScenarioService(),
    sessionSummaryRepository: summaries,
    eventSink: sink,
    config: DEFAULT_ENGINE_CONFIG,
    now: clock.now,
    ...(clockStore ? { clockStore } : {}),
    ...(sceneStore ? { sceneStore } : {}),
  });

  return { orchestrator, gateway, connection, roomStore, turnStateStore, summaries, sink, coordinator, clock, clockStore, sceneStore };
}

/** Start the session and drain the opening narration. */
async function start(h: Harness): Promise<void> {
  await h.orchestrator.dispatch(ROOM_ID, { type: "START_SESSION", by: HOST });
  await h.orchestrator.whenSettled();
}

describe("RoomOrchestrator", () => {
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
