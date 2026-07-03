/**
 * Local playtest server — wires the engine (orchestrator + Codex GM + realtime
 * gateway) to an HTTP + WebSocket surface so a single player can play a session
 * in the browser at http://localhost:8787.
 *
 * Solo quick-play: `POST /play/new` seeds a room with one player + a confirmed
 * character + the MVP scenario, starts the session (opening narration), and
 * returns the ids. The browser then opens a WebSocket and sends chat / confirm /
 * pass commands; the orchestrator drives free-chat -> ready-check -> resolution
 * and the gateway streams Turn_State + narration back.
 *
 * SECURITY: `POST /play/new` seeds a room AND starts a Codex GM opening
 * generation, so an exposed instance can be driven to burn CPU / `codex`
 * processes / account tokens by request volume alone. To make exposure safe the
 * server (a) binds to loopback by default, (b) refuses a non-loopback bind
 * without a `PLAYTEST_TOKEN` shared secret, (c) requires that token on
 * `/play/new` and the WebSocket upgrade when configured, and (d) enforces a
 * per-IP rate limit plus a global cap on concurrent session starts. See
 * {@link import("./server-security.js")} for the (unit-tested) policy helpers.
 */
import { createServer } from "node:http";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { fileURLToPath, URL, URLSearchParams } from "node:url";
import { dirname, join } from "node:path";
import express, { type Response } from "express";
import { WebSocketServer } from "ws";
import { createEngine } from "./realtime/engine.js";
import { hydratePersistence, resolvePersistenceMode } from "./persistence/factory.js";
import { createSessionLogger } from "./observability/session-log.js";
import { WsConnection } from "./realtime/ws-connection.js";
import type { OrchestratorCommand } from "./realtime/room-orchestrator.js";
import { createCliAiGmClient } from "./ai/cli-client-factory.js";
import { MVP_SCENARIO, DEMO_SCENARIO_CATALOG } from "./services/scenario-service.js";
import { CharacterService } from "./services/character-service.js";
import { RoomService } from "./services/room-service.js";
import { normalizeName } from "./services/names.js";
import {
  rollAllocationValues,
  sheetSchemaForScenario,
  expectedTraitSpecForScenario,
  cardsForScenario,
  projectSheetForViewer,
} from "./services/sheet-schema.js";
import type { Scenario } from "./services/scenario-service.js";
import { dealCardHand } from "./services/card-dealing.js";
import { toContext } from "./services/turn-state-context.js";
import {
  buildNarrativeDraftPrompt,
  parseNarrativeDraftResponse,
} from "./services/narrative-draft.js";
import {
  createSoloSessionStore,
  makeSoloCharacter,
  runSoloAct,
} from "./http/solo-play.js";
import { AiCostGuard, type AiCostGuardAcquireResult } from "./http/ai-cost-guard.js";
import {
  isStartFailureHttpError,
  startMultiplayerSession,
} from "./http/session-start-boundary.js";
import type { AttributeKey, AttributeLevel } from "./core/types.js";
import type { Character, Player, Room } from "./services/types.js";
import {
  FixedWindowBudgetLimiter,
  FixedWindowRateLimiter,
  InFlightKeyLock,
  SessionSlotLimiter,
  buildPublicInviteLink,
  checkStartupSafety,
  isStateChangingRequestCsrfSafe,
  playtestToken,
  readBoundedText,
  resolveBinding,
  resolveTrustProxy,
  tokenMatches,
} from "./server-security.js";
import {
  ConnectionTicketStore,
  authorizeConnection,
  authorizeAction,
  authorizeRoomHost,
  authorizeRoomMember,
} from "./realtime/connection-tickets.js";
import type { ConnectionIdentity } from "./realtime/connection-tickets.js";

// Resolve + validate the bind address before doing anything else: a public bind
// without a shared secret is refused so the AI-cost surface is never anonymous.
const startup = checkStartupSafety(process.env);
if (!startup.ok) {
  process.stderr.write(`\n[playtest] ${startup.reason}\n`);
  process.exit(1);
}
for (const warning of startup.warnings) {
  process.stderr.write(`\n[playtest] WARNING: ${warning}\n`);
}

const { host: HOST, port: PORT } = resolveBinding(process.env);
const TOKEN = playtestToken(process.env);

// Defence-in-depth limits for the AI-cost surface (`/play/new`).
const NEW_SESSION_WINDOW_MS = 60_000;
const NEW_SESSION_PER_IP = 5; // at most 5 new sessions per IP per minute
const LOBBY_MUTATION_WINDOW_MS = 60_000;
const ROOM_CREATES_PER_IP = 30;
const ROOM_JOINS_PER_IP = 60;
const ROOM_JOINS_PER_ROOM = 30;
const AI_ACTION_WINDOW_MS = 60_000;
const SOLO_ACTIONS_PER_SESSION = 12;
const PROPOSALS_PER_PLAYER = 6;
const AI_BUDGET_WINDOW_MS = readPositiveIntegerEnv("AI_BUDGET_WINDOW_MS", 60_000);
const GLOBAL_AI_CALLS_PER_WINDOW = readPositiveIntegerEnv("GLOBAL_AI_CALLS_PER_WINDOW", 60);
const ROOM_AI_CALLS_PER_WINDOW = readPositiveIntegerEnv("ROOM_AI_CALLS_PER_WINDOW", 12);
const PLAYER_AI_CALLS_PER_WINDOW = readPositiveIntegerEnv("PLAYER_AI_CALLS_PER_WINDOW", 6);
const WS_MESSAGE_WINDOW_MS = 10_000;
const WS_MESSAGES_PER_CONNECTION = 40;
const WS_MAX_PAYLOAD_BYTES = 4096;
const MAX_DISPLAY_NAME_LENGTH = 80;
const MAX_CONCEPT_LENGTH = 1_200;
const MAX_ACTION_LENGTH = 1_200;
const MAX_CHAT_LENGTH = 1_000;
const MAX_SCENARIO_ID_LENGTH = 128;
const MAX_CHECK_ID_LENGTH = 128;
// Global cap on concurrently-active sessions (bounds total AI generation cost).
// Configurable via MAX_CONCURRENT_SESSIONS so a self-hosted group can raise it;
// defaults to 8. Invalid/absent values fall back to the default.
const MAX_CONCURRENT_SESSIONS = ((): number => {
  const raw = Number(process.env.MAX_CONCURRENT_SESSIONS);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 8;
})();
const SESSION_SLOT_TTL_MS = 30 * 60_000; // ~30 min: a session's active lifetime

const newSessionRateLimiter = new FixedWindowRateLimiter(
  NEW_SESSION_PER_IP,
  NEW_SESSION_WINDOW_MS,
);
const soloActionRateLimiter = new FixedWindowRateLimiter(
  SOLO_ACTIONS_PER_SESSION,
  AI_ACTION_WINDOW_MS,
);
const proposalRateLimiter = new FixedWindowRateLimiter(
  PROPOSALS_PER_PLAYER,
  AI_ACTION_WINDOW_MS,
);
const roomCreateRateLimiter = new FixedWindowRateLimiter(
  ROOM_CREATES_PER_IP,
  LOBBY_MUTATION_WINDOW_MS,
);
const roomJoinIpRateLimiter = new FixedWindowRateLimiter(
  ROOM_JOINS_PER_IP,
  LOBBY_MUTATION_WINDOW_MS,
);
const roomJoinRoomRateLimiter = new FixedWindowRateLimiter(
  ROOM_JOINS_PER_ROOM,
  LOBBY_MUTATION_WINDOW_MS,
);
const wsMessageRateLimiter = new FixedWindowRateLimiter(
  WS_MESSAGES_PER_CONNECTION,
  WS_MESSAGE_WINDOW_MS,
);
const sessionSlots = new SessionSlotLimiter(MAX_CONCURRENT_SESSIONS, SESSION_SLOT_TTL_MS);
const globalAiBudget = new FixedWindowBudgetLimiter(GLOBAL_AI_CALLS_PER_WINDOW, AI_BUDGET_WINDOW_MS);
const roomAiBudget = new FixedWindowBudgetLimiter(ROOM_AI_CALLS_PER_WINDOW, AI_BUDGET_WINDOW_MS);
const playerAiBudget = new FixedWindowBudgetLimiter(PLAYER_AI_CALLS_PER_WINDOW, AI_BUDGET_WINDOW_MS);
const playNewAiGuard = new AiCostGuard({
  endpointLimiter: newSessionRateLimiter,
  sessionSlots,
  globalBudget: globalAiBudget,
  roomBudget: roomAiBudget,
  playerBudget: playerAiBudget,
});
const soloNewAiGuard = new AiCostGuard({
  endpointLimiter: newSessionRateLimiter,
  sessionSlots,
  globalBudget: globalAiBudget,
  roomBudget: roomAiBudget,
  playerBudget: playerAiBudget,
});
const soloActAiGuard = new AiCostGuard({
  endpointLimiter: soloActionRateLimiter,
  endpointRateReason: "SOLO_ACTION_RATE",
  globalBudget: globalAiBudget,
  roomBudget: roomAiBudget,
  playerBudget: playerAiBudget,
});
const proposalAiGuard = new AiCostGuard({
  endpointLimiter: proposalRateLimiter,
  endpointRateReason: "PROPOSAL_RATE",
  globalBudget: globalAiBudget,
  roomBudget: roomAiBudget,
  playerBudget: playerAiBudget,
});
const multiplayerStartAiGuard = new AiCostGuard({
  sessionSlots,
  globalBudget: globalAiBudget,
  roomBudget: roomAiBudget,
  playerBudget: playerAiBudget,
});
const soloActionLocks = new InFlightKeyLock();

// Server-issued tickets that authenticate a `/ws` socket as a specific player
// (issue #2): the WebSocket identity is derived from the ticket, never from
// client-supplied query params.
const connectionTickets = new ConnectionTicketStore();

/** Extract the shared secret from a request (header preferred, query fallback). */
function tokenFromRequest(headerValue: unknown, queryValue: string | null): string | undefined {
  if (typeof headerValue === "string" && headerValue.length > 0) return headerValue;
  if (queryValue !== null && queryValue.length > 0) return queryValue;
  return undefined;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function writeAiCostFailure(
  res: Response,
  result: Exclude<AiCostGuardAcquireResult, { ok: true }>,
): void {
  res.status(result.status).json({ error: result.error, reason: result.reason });
}

function writePersistenceFailure(res: Response, error: unknown): void {
  process.stderr.write(`\n[playtest] Durable persistence write failed: ${String(error)}\n`);
  res.status(500).json({ error: "Durable persistence write failed." });
}

// Default memory mode keeps local playtests friction-free even when DATABASE_URL
// is present. Set PERSISTENCE_MODE=durable in production to use Postgres.
const persistenceMode = resolvePersistenceMode(process.env);
const aiClient = createCliAiGmClient(process.env);
const engine = createEngine({
  aiClient,
  env: persistenceMode === "durable" ? process.env : {},
  scenarioCatalog: DEMO_SCENARIO_CATALOG,
  // Best-effort local session trace for debugging (default off; SESSION_LOG=1 to
  // enable, SESSION_LOG_FILE to relocate). Logged payloads are redacted/truncated.
  sessionLogger: createSessionLogger(process.env, join(process.cwd(), "logs", "session.jsonl")),
});
const { orchestrator, gateway, persistence, sessionLogger } = engine;
if (persistenceMode === "durable") {
  if (persistence.backend !== "postgres") {
    process.stderr.write(
      "\n[playtest] PERSISTENCE_MODE=durable requires DATABASE_URL or SUPABASE_DB_URL.\n",
    );
    process.exit(1);
  }
  try {
    await hydratePersistence(persistence);
  } catch (error) {
    process.stderr.write(`\n[playtest] Failed to hydrate durable persistence: ${String(error)}\n`);
    process.exit(1);
  }
}
const durableRoomRepository = persistenceMode === "durable" ? persistence.roomRepository : undefined;
if (sessionLogger.enabled) sessionLogger.log("server_start", { host: HOST, port: PORT });

// Lobby socket registry: room id -> set of open lobby WebSockets in that room.
// Used to broadcast roster / scenario / character_setup events to every lobby
// member (not just the connecting socket), and to close lobby sockets when a
// room ends.
const lobbySockets = new Map<string, Set<import("ws").WebSocket>>();

// Revoke a room's connection tickets when its session ends so those tickets can
// no longer authorize any player-acting REST request or `/ws` connection (#2,
// Requirements 7.2/7.3). There is no server-side session-end callback to hook,
// so we observe the room -> "ended" lifecycle transition by wrapping the store's
// `saveRoom`: on the lobby/in_session -> ended edge we call `revokeRoom(roomId)`.
// The prior-state check makes revocation fire exactly once and stay idempotent
// (re-saving an already-ended room does not re-revoke). After revocation the
// existing `authorizePlayerAction`/`resolveSocketIdentity` paths reject reuse of
// the now-unresolvable tickets, so no extra auth branches are needed.
const originalSaveRoom = persistence.roomStore.saveRoom.bind(persistence.roomStore);
persistence.roomStore.saveRoom = (room) => {
  const priorState = persistence.roomStore.getRoom(room.id)?.state;
  originalSaveRoom(room);
  if (room.state === "ended" && priorState !== "ended") {
    connectionTickets.revokeRoom(room.id);
    // A started session held one AI-cost slot; free it when the session ends so
    // finished sessions do not keep capacity reserved for their full TTL.
    if (priorState === "in_session") sessionSlots.release(room.id);
    gateway.closeRoom(room.id, 4000, "room ended");
    const sockets = lobbySockets.get(room.id);
    if (sockets !== undefined) {
      for (const ws of sockets) {
        if (ws.readyState === ws.OPEN) ws.close(4000, "room ended");
      }
      lobbySockets.delete(room.id);
    }
  }
};

// Character setup (record / confirm / name-uniqueness / ladder validation /
// confirmation locking) is owned by the CharacterService, backed by the same
// in-memory store the engine uses. This powers the character-sheet screen's
// proposal / save / confirm REST surface below.
const characterService = new CharacterService({ store: persistence.roomStore });

// Membership (join, capacity, in-room name uniqueness, lobby gating) is owned by
// the RoomService over the same store, so the join endpoint reuses those rules
// rather than re-implementing them.
const roomService = new RoomService({ store: persistence.roomStore });

/** Broadcast a JSON payload to every open lobby socket registered for a room. */
function broadcastToRoom(roomId: string, payload: unknown): void {
  const sockets = lobbySockets.get(roomId);
  if (sockets === undefined) return;
  const data = JSON.stringify(payload);
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

// Rooms whose session has already been started by the all-confirmed gate, so a
// late/duplicate confirm cannot dispatch START_SESSION more than once.
const startedRooms = new Set<string>();

// Rooms whose host pressed "back to lobby" on the character screen. Surfaced in
// the readiness snapshot so every player polling on the character screen returns
// to the lobby together. Cleared when the host re-starts character setup
// (lobby START_SESSION) so the next round is not bounced back immediately.
const lobbyReturnRooms = new Set<string>();

const DEFAULT_ATTRS: Record<AttributeKey, AttributeLevel> = {
  Might: 1,
  Agility: 1,
  Wits: 1,
  Spirit: 1,
};

const app = express();
app.set("trust proxy", resolveTrustProxy(process.env));
app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  const host = req.get("host");
  if (host === undefined || host.length === 0) {
    res.status(400).json({ error: "Host header is required." });
    return;
  }
  const targetOrigin = `${req.protocol}://${host}`;
  if (
    !isStateChangingRequestCsrfSafe(
      { origin: req.get("origin"), secFetchSite: req.get("sec-fetch-site") },
      targetOrigin,
    )
  ) {
    res.status(403).json({ error: "Cross-origin state-changing requests are not allowed." });
    return;
  }
  next();
});
// Cap request bodies: `/play/new` only needs a tiny JSON payload, so a small
// limit removes a cheap memory-pressure lever.
app.use(express.json({ limit: "16kb" }));
app.use(express.static(join(dirname(fileURLToPath(import.meta.url)), "..", "public")));

/** Seed a solo room and start the session. Returns ids for the WebSocket. */
app.post("/play/new", async (req, res) => {
  // Shared-secret gate (no-op when no token is configured).
  if (!tokenMatches(TOKEN, tokenFromRequest(req.header("x-playtest-token"), null))) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const clientIp = req.ip ?? req.socket.remoteAddress ?? "unknown";

  const body = (req.body ?? {}) as { displayName?: string; concept?: string };
  const displayNameInput = readBoundedText(body.displayName, {
    field: "Display name",
    maxLength: MAX_DISPLAY_NAME_LENGTH,
  });
  if (!displayNameInput.ok) {
    res.status(displayNameInput.status).json({ error: displayNameInput.error });
    return;
  }
  const conceptInput = readBoundedText(body.concept, {
    field: "Concept",
    maxLength: MAX_CONCEPT_LENGTH,
  });
  if (!conceptInput.ok) {
    res.status(conceptInput.status).json({ error: conceptInput.error });
    return;
  }
  const displayName = displayNameInput.value || "모험가";
  const concept = conceptInput.value || "용감한 모험가";

  const roomId = randomUUID();
  const playerId = randomUUID();
  const characterId = randomUUID();

  // Global cap + AI budgets are acquired only after validation, so rejected
  // input does not hold scarce capacity.
  const aiGuard = playNewAiGuard.acquire({
    roomId,
    playerId,
    endpointKey: clientIp,
  });
  if (!aiGuard.ok) {
    writeAiCostFailure(res, aiGuard);
    return;
  }

  const room: Room = {
    id: roomId,
    inviteToken: randomUUID(),
    hostPlayerId: playerId,
    scenarioId: MVP_SCENARIO.id,
    state: "in_session",
    maxPlayers: 6,
    createdAt: new Date().toISOString(),
  };
  const player: Player = {
    id: playerId,
    roomId,
    displayName,
    isHost: true,
    characterId,
    connectionStatus: "connected",
  };
  const character: Character = {
    id: characterId,
    playerId,
    roomId,
    name: displayName,
    concept,
    attributes: { ...DEFAULT_ATTRS },
    confirmed: true,
  };
  if (durableRoomRepository !== undefined) {
    try {
      await durableRoomRepository.createRoomWithHost({
        room,
        host: player,
        initialCharacter: character,
        scenarioId: MVP_SCENARIO.id,
      });
    } catch (error) {
      aiGuard.release();
      writePersistenceFailure(res, error);
      return;
    }
  }
  persistence.roomStore.saveRoom(room);
  persistence.roomStore.savePlayer(player);
  persistence.roomStore.saveCharacter(character);
  persistence.scenarioStore.setSelection(roomId, MVP_SCENARIO.id);

  // Start the session (host-only) — generates + delivers the opening narration.
  void orchestrator.dispatch(roomId, { type: "START_SESSION", by: playerId });

  // Issue a connection ticket so the browser can authenticate its WebSocket as
  // THIS player without the server having to trust client-supplied ids (#2).
  const connectionToken = connectionTickets.issue({ roomId, playerId });

  res.status(201).json({ roomId, playerId, connectionToken, scenario: MVP_SCENARIO });
});

// ---------------------------------------------------------------------------
// Solo play (REAL-AI) surface — additive. A single player types a free-text
// action; the REAL LLM (engine.coordinator) judges which checks apply, the
// server rolls EZFudge with advantage, and the LLM narrates the outcome. This
// reuses `engine.coordinator.resolveRound(...)` and does NOT touch /play/new,
// the WebSocket, or engine internals.
const soloSessions = createSoloSessionStore();

/** Start a solo session and generate the opening narration via the real LLM. */
app.post("/solo/new", async (req, res) => {
  // Shared-secret gate (no-op when no token is configured) — same as /play/new.
  if (!tokenMatches(TOKEN, tokenFromRequest(req.header("x-playtest-token"), null))) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const clientIp = req.ip ?? req.socket.remoteAddress ?? "unknown";

  const body = (req.body ?? {}) as { displayName?: string; concept?: string };
  const displayNameInput = readBoundedText(body.displayName, {
    field: "Display name",
    maxLength: MAX_DISPLAY_NAME_LENGTH,
  });
  if (!displayNameInput.ok) {
    res.status(displayNameInput.status).json({ error: displayNameInput.error });
    return;
  }
  const conceptInput = readBoundedText(body.concept, {
    field: "Concept",
    maxLength: MAX_CONCEPT_LENGTH,
  });
  if (!conceptInput.ok) {
    res.status(conceptInput.status).json({ error: conceptInput.error });
    return;
  }
  const sessionId = randomUUID();
  const character = makeSoloCharacter(
    { displayName: displayNameInput.value, concept: conceptInput.value },
    { playerId: randomUUID(), characterId: randomUUID(), roomId: sessionId },
  );

  const aiGuard = soloNewAiGuard.acquire({
    sessionId,
    playerId: character.playerId,
    endpointKey: clientIp,
  });
  if (!aiGuard.ok) {
    writeAiCostFailure(res, aiGuard);
    return;
  }
  const session = soloSessions.create(character, MVP_SCENARIO);

  // Build a free_chat context and ask the real LLM for the opening narration.
  const ctx = toContext(
    {
      roomId: sessionId,
      roundNumber: 1,
      phase: "free_chat",
      readiness: [],
      actionHistory: [],
      chatLog: [],
      checks: [],
      narrativeContext: [],
      readyCheckDeadline: null,
      readyCheckTimeoutMs: engine.config.readyCheckTimeoutMs,
      resolutionRequested: false,
    },
    MVP_SCENARIO,
    [character],
  );

  let opening = MVP_SCENARIO.summary;
  try {
    const result = await engine.coordinator.generateOpening(ctx);
    if (result.ok) opening = result.value;
  } catch {
    // Graceful fallback to the scenario summary on any opening failure.
  }

  soloSessions.set(session.id, session);
  res.status(201).json({
    sessionId,
    scenario: { title: MVP_SCENARIO.title, summary: MVP_SCENARIO.summary },
    opening,
  });
});

/** Resolve one solo action: AI judges checks -> server dice -> AI narrates. */
app.post("/solo/act", async (req, res) => {
  // Shared-secret gate (no-op when no token is configured).
  if (!tokenMatches(TOKEN, tokenFromRequest(req.header("x-playtest-token"), null))) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = (req.body ?? {}) as { sessionId?: string; action?: string };
  const actionInput = readBoundedText(body.action, {
    field: "Action",
    maxLength: MAX_ACTION_LENGTH,
    required: true,
  });
  if (!actionInput.ok) {
    res.status(actionInput.status).json({ error: actionInput.error });
    return;
  }
  const session = typeof body.sessionId === "string" ? soloSessions.get(body.sessionId) : undefined;
  if (session === undefined) {
    res.status(404).json({ error: "Unknown session." });
    return;
  }
  if (session.ended) {
    res.status(409).json({ error: "Session has ended." });
    return;
  }
  if (!soloActionLocks.tryAcquire(session.id)) {
    res.status(409).json({ error: "Action already in progress." });
    return;
  }
  try {
    const aiGuard = soloActAiGuard.acquire({
      sessionId: session.id,
      playerId: session.character.playerId,
      endpointKey: session.id,
    });
    if (!aiGuard.ok) {
      writeAiCostFailure(res, aiGuard);
      return;
    }
    const response = await runSoloAct(session, actionInput.value, engine.coordinator, engine.config);
    soloSessions.set(session.id, session);
    if (session.ended) sessionSlots.release(session.id);
    res.status(200).json(response);
  } finally {
    soloActionLocks.release(session.id);
  }
});

const server = createServer(app);

// ---------------------------------------------------------------------------
// Multiplayer lobby demo surface — additive. Backs the host-entry -> lobby ->
// game screen chain with an in-memory room (reusing persistence.roomStore and
// the engine). Creating a room is cheap; the AI cost is only paid on
// START_SESSION (driven over /lobby/ws). Nothing here touches /play/new or
// /solo/*.
const LOBBY_MAX_PLAYERS = 6;

/** Build a public invite link whose LAST path segment is the invite token. */
function inviteLinkFor(req: express.Request, inviteToken: string): string {
  const host = req.get("host") ?? `${HOST}:${PORT}`;
  return buildPublicInviteLink(req.protocol, host, inviteToken, TOKEN);
}

/** True when the shared-secret gate passes for this request (no-op when unset). */
function restAuthorized(req: express.Request): boolean {
  return tokenMatches(TOKEN, tokenFromRequest(req.header("x-playtest-token"), null));
}

/** Read the connection ticket from the `x-connection-ticket` header (undefined when absent/blank). */
function ticketFromRequest(req: express.Request): string | undefined {
  const header = req.header("x-connection-ticket");
  if (typeof header === "string" && header.length > 0) return header;
  return undefined;
}

/**
 * Authorize a player-acting request against its server-issued connection ticket
 * (#2): the acting identity is derived from the ticket, never from the
 * client-supplied `:playerId`. Rejection happens BEFORE any service call (no
 * state change): `no_ticket` → 401, `not_a_member`/`identity_mismatch` → 403.
 * Returns the ticket identity on success, or `null` after writing the rejection.
 */
function authorizePlayerAction(
  req: express.Request,
  res: express.Response,
  roomId: string,
  playerId: string,
): ConnectionIdentity | null {
  const auth = authorizeAction(connectionTickets, persistence.roomStore, ticketFromRequest(req), {
    roomId,
    playerId,
  });
  if (auth.ok) return auth.identity;
  if (auth.reason === "no_ticket") {
    res.status(401).json({ error: "Unauthorized" });
  } else {
    res.status(403).json({ error: "Forbidden" });
  }
  return null;
}

function writeRoomReadAuthFailure(res: express.Response, reason: "no_ticket" | "not_a_member" | "identity_mismatch" | "unknown_room" | "not_host"): void {
  if (reason === "no_ticket") {
    res.status(401).json({ error: "Unauthorized" });
  } else if (reason === "unknown_room") {
    res.status(404).json({ error: "Unknown room." });
  } else {
    res.status(403).json({ error: "Forbidden" });
  }
}

function authorizeRoomMemberRead(
  req: express.Request,
  res: express.Response,
  roomId: string,
): ConnectionIdentity | null {
  const auth = authorizeRoomMember(connectionTickets, persistence.roomStore, ticketFromRequest(req), roomId);
  if (auth.ok) return auth.identity;
  writeRoomReadAuthFailure(res, auth.reason);
  return null;
}

function authorizeRoomHostRead(
  req: express.Request,
  res: express.Response,
  roomId: string,
): ConnectionIdentity | null {
  const auth = authorizeRoomHost(connectionTickets, persistence.roomStore, ticketFromRequest(req), roomId);
  if (auth.ok) return auth.identity;
  writeRoomReadAuthFailure(res, auth.reason);
  return null;
}

function requireLobbyForCharacterMutation(res: express.Response, roomId: string): Room | null {
  const room = persistence.roomStore.getRoom(roomId);
  if (room === undefined) {
    res.status(404).json({ error: "Unknown room." });
    return null;
  }
  if (room.state !== "lobby") {
    res.status(409).json({ error: "Character setup is closed." });
    return null;
  }
  return room;
}

function writeStartGuardFailure(
  res: express.Response,
  outcome: { started: boolean; reason?: string },
): boolean {
  if (outcome.started) return false;
  if (outcome.reason === "AT_CAPACITY") {
    res.status(503).json({
      ok: false,
      started: false,
      reason: outcome.reason,
      error: "Server is at capacity; try again shortly.",
    });
    return true;
  }
  if (outcome.reason === "GLOBAL_AI_BUDGET") {
    res.status(503).json({
      ok: false,
      started: false,
      reason: outcome.reason,
      error: "Server AI budget is exhausted; try again shortly.",
    });
    return true;
  }
  if (outcome.reason === "ROOM_AI_BUDGET" || outcome.reason === "PLAYER_AI_BUDGET") {
    res.status(429).json({
      ok: false,
      started: false,
      reason: outcome.reason,
      error:
        outcome.reason === "ROOM_AI_BUDGET"
          ? "Room AI budget is exhausted; slow down."
          : "Player AI budget is exhausted; slow down.",
    });
    return true;
  }
  return false;
}

/** Create a lobby room with a host player + confirmed character (no AI yet). */
app.post("/rooms", async (req, res) => {
  if (!restAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const clientIp = req.ip ?? req.socket.remoteAddress ?? "unknown";
  if (!roomCreateRateLimiter.tryAcquire(clientIp)) {
    res.status(429).json({ error: "Too many requests; slow down." });
    return;
  }

  const body = (req.body ?? {}) as { displayName?: string; scenarioId?: string };
  const displayNameInput = readBoundedText(body.displayName, {
    field: "Display name",
    maxLength: MAX_DISPLAY_NAME_LENGTH,
  });
  if (!displayNameInput.ok) {
    res.status(displayNameInput.status).json({ error: displayNameInput.error });
    return;
  }
  const scenarioIdInput = readBoundedText(body.scenarioId, {
    field: "Scenario ID",
    maxLength: MAX_SCENARIO_ID_LENGTH,
  });
  if (!scenarioIdInput.ok) {
    res.status(scenarioIdInput.status).json({ error: scenarioIdInput.error });
    return;
  }
  const displayName = displayNameInput.value || "호스트";
  // Pick the requested scenario when it exists in the catalog, else default MVP.
  const requested =
    scenarioIdInput.value.length > 0
      ? persistence.scenarioStore.getScenario(scenarioIdInput.value)
      : undefined;
  const scenarioId = requested?.id ?? MVP_SCENARIO.id;
  const roomId = randomUUID();
  const playerId = randomUUID();
  const characterId = randomUUID();
  const inviteToken = randomUUID();

  const room: Room = {
    id: roomId,
    inviteToken,
    hostPlayerId: playerId,
    scenarioId,
    state: "lobby",
    maxPlayers: LOBBY_MAX_PLAYERS,
    createdAt: new Date().toISOString(),
  };
  const player: Player = {
    id: playerId,
    roomId,
    displayName,
    isHost: true,
    characterId,
    connectionStatus: "connected",
  };
  const character: Character = {
    id: characterId,
    playerId,
    roomId,
    name: displayName,
    concept: "용감한 모험가",
    attributes: { ...DEFAULT_ATTRS },
    confirmed: false,
  };
  if (durableRoomRepository !== undefined) {
    try {
      await durableRoomRepository.createRoomWithHost({
        room,
        host: player,
        initialCharacter: character,
        scenarioId,
      });
    } catch (error) {
      writePersistenceFailure(res, error);
      return;
    }
  }
  persistence.roomStore.saveRoom(room);
  persistence.roomStore.savePlayer(player);
  persistence.roomStore.saveCharacter(character);
  persistence.scenarioStore.setSelection(roomId, scenarioId);

  // Issue a connection ticket for the host so the browser can authenticate its
  // player-acting requests and WebSocket as THIS player without the server
  // having to trust client-supplied ids (#2).
  const connectionToken = connectionTickets.issue({ roomId, playerId });

  res.status(201).json({
    roomId,
    inviteToken,
    inviteLink: inviteLinkFor(req, inviteToken),
    hostPlayerId: playerId,
    state: "lobby",
    maxPlayers: LOBBY_MAX_PLAYERS,
    connectionToken,
  });
});

/** Return a room's invite link (the host shares it). */
app.get("/rooms/:id/invite", (req, res) => {
  const room = persistence.roomStore.getRoom(req.params.id);
  if (room === undefined) {
    res.status(404).json({ error: "Unknown room." });
    return;
  }
  if (authorizeRoomHostRead(req, res, room.id) === null) return;
  res.status(200).json({ inviteLink: inviteLinkFor(req, room.inviteToken) });
});

/** Resolve a room by its invite token: capacity + selected scenario. */
app.get("/rooms/:token", (req, res) => {
  if (!restAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const room = persistence.roomStore.getRoomByToken(req.params.token);
  if (room === undefined) {
    res.status(404).json({ error: "Unknown room." });
    return;
  }
  res.status(200).json({ maxPlayers: room.maxPlayers, scenarioId: room.scenarioId });
});

/** Serve the invite-entry SPA (`public/join/index.html`) for an invite link.
 * The client reads the invite token from `location.pathname` itself; this
 * route just serves the static file (express.static only matches real files,
 * so the `/join/:token` path needs an explicit route). */
app.get("/join/:token", (_req, res) => {
  const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
  res.sendFile(join(publicDir, "join", "index.html"));
});

/** List available scenarios for the lobby. */
app.get("/scenarios", (req, res) => {
  if (!restAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const scenarios = persistence.scenarioStore
    .listScenarios()
    .map((s) => ({
      id: s.id,
      title: s.title,
      summary: s.summary,
      genre: s.genre,
      category: s.category,
      system: s.system,
      form: s.form ?? "원샷",
    }));
  res.status(200).json({ scenarios });
});

// ---------------------------------------------------------------------------
// Character-sheet surface — additive. Backs public/character/index.html: a
// player joins a lobby room, fetches the scenario-adaptive sheet schema, gets
// an attribute proposal, then records and confirms their character. All
// in-memory; the AI cost surface (START_SESSION) is untouched. The
// CharacterService owns the real rules (name uniqueness, ladder validation,
// confirmation locking); the sheet schema adapts to the room's scenario.

/**
 * Resolve the effective scenario for a room: the explicitly-selected scenario,
 * else the room's stored scenarioId, else the MVP scenario. Used to pick the
 * scenario-adaptive sheet schema and the trait spec to validate against.
 */
function resolveScenarioForRoom(roomId: string): Scenario {
  const selected = persistence.scenarioStore.getSelection(roomId);
  const room = persistence.roomStore.getRoom(roomId);
  const scenarioId = selected ?? room?.scenarioId ?? MVP_SCENARIO.id;
  return persistence.scenarioStore.getScenario(scenarioId) ?? MVP_SCENARIO;
}

/** Clamp a value to an integer within the inclusive ladder. */
function clampToLadder(value: number, ladder: { min: number; max: number }): number {
  const n = Math.round(Number.isFinite(value) ? value : ladder.min);
  return Math.max(ladder.min, Math.min(ladder.max, n));
}

/**
 * Deterministic, concept-themed attribute proposal (no AI cost). Boosts the
 * trait whose theme keywords appear in the concept, then clamps every value to
 * the scenario's ladder. Themes both EZFudge (Might/Agility/Wits/Spirit) and
 * the geese stats (Sneaky/Fast/Tenacious); unknown keys default to the ladder
 * floor + 1 (kept within range by the clamp).
 */
function proposeAttributes(
  concept: string,
  traitKeys: readonly string[],
  ladder: { min: number; max: number },
): Record<string, number> {
  const c = String(concept ?? "").toLowerCase();
  const has = (...needles: string[]): boolean => needles.some((n) => c.includes(n));
  const baseline = ladder.min + (ladder.max > ladder.min ? 1 : 0);
  const themed: Record<string, number> = {};
  const bump = (key: string, by: number): void => {
    themed[key] = (themed[key] ?? baseline) + by;
  };
  if (has("전사", "힘", "근육", "warrior", "fighter", "strong", "barbarian", "knight")) bump("Might", 2);
  if (has("도둑", "민첩", "암살", "rogue", "thief", "agile", "nimble", "archer", "궁수")) bump("Agility", 2);
  if (has("마법", "현자", "지능", "지혜", "mage", "wizard", "scholar", "clever", "학자")) bump("Wits", 2);
  if (has("성직", "사제", "의지", "정신", "priest", "cleric", "spirit", "willful", "주술")) bump("Spirit", 2);
  // Geese stats: 은밀(Sneaky) / 재빠름·신속(Fast) / 집요·끈기(Tenacious).
  if (has("은밀", "몰래", "조용", "sneaky", "stealth")) bump("Sneaky", 2);
  if (has("빠른", "재빠", "신속", "날쌘", "fast", "quick", "swift")) bump("Fast", 2);
  if (has("집요", "끈기", "고집", "tenacious", "stubborn", "dedicated")) bump("Tenacious", 2);

  const keys = Array.isArray(traitKeys) && traitKeys.length > 0 ? traitKeys : [];
  const values: Record<string, number> = {};
  for (const key of keys) {
    const seed = themed[key] ?? baseline;
    values[key] = clampToLadder(seed, ladder);
  }
  return values;
}

/**
 * Coerce an arbitrary request body's attribute map into a numeric map keyed by
 * whatever trait keys it carries (rule-system agnostic — EZFudge, geese, or an
 * empty map for narrative-only sheets). Non-numeric values are coerced via
 * Number() and validated downstream by the CharacterService against the
 * scenario's trait spec.
 */
function readAttributes(raw: unknown): Record<string, AttributeLevel> {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, AttributeLevel> = {};
  for (const key of Object.keys(src)) {
    const v = src[key];
    out[key] = (typeof v === "number" ? v : Number(v)) as AttributeLevel;
  }
  return out;
}

function assignUniqueDisplayName(requested: string, taken: readonly string[]): string {
  const existing = new Set(taken.map(normalizeName));
  if (!existing.has(normalizeName(requested))) return requested;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${requested} (${suffix})`;
    if (!existing.has(normalizeName(candidate))) return candidate;
  }
}

/**
 * `POST /rooms/:token/join` — add an unconfirmed player to a lobby room so the
 * character-sheet screen has a real (roomId, playerId) handoff to author against.
 * Resolves the room by invite token only. Returns the new player's id.
 */
app.post("/rooms/:token/join", async (req, res) => {
  const clientIp = req.ip ?? req.socket.remoteAddress ?? "unknown";
  if (!roomJoinIpRateLimiter.tryAcquire(clientIp)) {
    res.status(429).json({ error: "Too many requests; slow down." });
    return;
  }
  const room =
    persistence.roomStore.getRoomByToken(req.params.token);
  if (room === undefined) {
    res.status(404).json({ error: "Unknown room." });
    return;
  }
  if (!roomJoinRoomRateLimiter.tryAcquire(room.id)) {
    res.status(429).json({ error: "Too many join attempts; slow down." });
    return;
  }
  const body = (req.body ?? {}) as { displayName?: string };
  const displayNameInput = readBoundedText(body.displayName, {
    field: "Display name",
    maxLength: MAX_DISPLAY_NAME_LENGTH,
  });
  if (!displayNameInput.ok) {
    res.status(displayNameInput.status).json({ error: displayNameInput.error });
    return;
  }
  const displayName = displayNameInput.value || "플레이어";
  if (durableRoomRepository !== undefined) {
    const existing = persistence.roomStore.listPlayers(room.id);
    const assignedName = assignUniqueDisplayName(
      displayName,
      existing.map((p) => p.displayName),
    );
    const joined: Player = {
      id: randomUUID(),
      roomId: room.id,
      displayName: assignedName,
      isHost: false,
      characterId: null,
      connectionStatus: "connected",
    };
    let outcome: "inserted" | "full" | "unavailable";
    try {
      outcome = await durableRoomRepository.joinPlayerIfRoomHasCapacity(joined);
    } catch (error) {
      writePersistenceFailure(res, error);
      return;
    }
    if (outcome !== "inserted") {
      res.status(outcome === "full" ? 409 : 404).json({
        error: outcome === "full" ? "This room is full." : "This room link is invalid or the session no longer exists.",
      });
      return;
    }
    persistence.roomStore.savePlayer(joined);
    const connectionToken = connectionTickets.issue({
      roomId: room.id,
      playerId: joined.id,
    });
    res.status(201).json({
      roomId: room.id,
      playerId: joined.id,
      displayName: assignedName,
      connectionToken,
    });
    return;
  }
  // Delegate to the RoomService so lobby gating, capacity, and in-room name
  // uniqueness are enforced by the shared domain rules.
  const result = roomService.joinRoom(room.inviteToken, { displayName });
  if (!result.ok) {
    // ROOM_UNAVAILABLE (left lobby / unknown) → 404; ROOM_FULL → 409.
    res.status(result.reason === "ROOM_FULL" ? 409 : 404).json({ error: result.message });
    return;
  }
  // Issue a connection ticket for the joined player so the browser can
  // authenticate its player-acting requests and WebSocket as THIS player
  // without the server having to trust client-supplied ids (#2).
  const connectionToken = connectionTickets.issue({
    roomId: result.room.id,
    playerId: result.player.id,
  });
  res.status(201).json({
    roomId: result.room.id,
    playerId: result.player.id,
    displayName: result.assignedName,
    connectionToken,
  });
});

/** `GET /rooms/:id/sheet-schema` — the scenario-adaptive Scenario_Sheet_Schema. */
app.get("/rooms/:id/sheet-schema", (req, res) => {
  if (!restAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const room = persistence.roomStore.getRoom(req.params.id);
  if (room === undefined) {
    res.status(404).json({ error: "Unknown room." });
    return;
  }
  // Resolve the room's scenario and return its scenario-adaptive sheet schema
  // (universal EZFudge for no-special-rules scenarios; a custom sheet otherwise).
  // The scenario title/summary are attached to the response (not part of the
  // strict SheetSchema) so the character screen can show which scenario is in
  // play at the top of the sheet.
  const scenario = resolveScenarioForRoom(room.id);
  res.status(200).json({
    ...sheetSchemaForScenario(scenario),
    scenarioTitle: scenario.title,
    scenarioSummary: scenario.summary,
  });
});

/**
 * `GET /rooms/:roomId/players/:playerId/cards` — the player's deterministic
 * random role-card hand for a Card_Based_Sheet. Requires the matching player's
 * connection ticket. Non-card scenarios return an empty list. The hand excludes
 * cards already confirmed by OTHER players in the room (so the requester's own
 * confirmed card stays visible to them).
 */
app.get("/rooms/:roomId/players/:playerId/cards", (req, res) => {
  const { roomId, playerId } = req.params;
  if (authorizePlayerAction(req, res, roomId, playerId) === null) return;
  const allCards = cardsForScenario(resolveScenarioForRoom(roomId));
  if (allCards === undefined || allCards.length === 0) {
    res.status(200).json({ cards: [] });
    return;
  }
  // Exclude cards confirmed by a DIFFERENT player (the requester's own confirmed
  // card is not excluded from their own view). Filter out blank/undefined ids.
  const takenIds = persistence.roomStore
    .listCharactersByRoom(roomId)
    .filter(
      (character) =>
        character.confirmed === true &&
        character.playerId !== playerId &&
        typeof character.selectedCardId === "string" &&
        character.selectedCardId.trim().length > 0,
    )
    .map((character) => character.selectedCardId as string);

  const seed = `${roomId}:${playerId}`;
  res.status(200).json({ cards: dealCardHand(allCards, seed, takenIds, 3) });
});

/**
 * `GET /rooms/:roomId/sheet-views` — viewer-scoped living character sheets for
 * the in-game roster. The connection ticket identifies the viewer; private
 * narrative fields are omitted server-side for every non-owner.
 */
app.get("/rooms/:roomId/sheet-views", (req, res) => {
  const { roomId } = req.params;
  const identity = authorizeRoomMemberRead(req, res, roomId);
  if (identity === null) return;
  const room = persistence.roomStore.getRoom(roomId);
  if (room === undefined) {
    res.status(404).json({ error: "Unknown room." });
    return;
  }
  const schema = sheetSchemaForScenario(resolveScenarioForRoom(roomId));
  const views = persistence.roomStore
    .listCharactersByRoom(roomId)
    .filter((character) => character.confirmed === true)
    .map((character) => ({
      playerId: character.playerId,
      characterId: character.id,
      view: projectSheetForViewer(character, schema, identity.playerId === character.playerId),
    }));
  res.status(200).json({ views });
});

/**
 * `POST /rooms/:roomId/allocation-roll` — server-side stat roll for a
 * `DICE_ROLL` allocation schema. The server rolls the scenario's dice formula
 * once per rated trait (clamped into each trait's ladder) and returns
 * `{ values }`; the client never produces a random value. Character setup is
 * lobby-only, and non-DICE_ROLL scenarios reject the roll (409).
 */
app.post("/rooms/:roomId/allocation-roll", (req, res) => {
  if (!restAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const room = requireLobbyForCharacterMutation(res, req.params.roomId);
  if (room === null) return;
  // Body hygiene: when a playerId is supplied it must belong to the room.
  const body = (req.body ?? {}) as { playerId?: unknown };
  if (typeof body.playerId === "string" && body.playerId.trim().length > 0) {
    const known = persistence.roomStore
      .listPlayers(room.id)
      .some((player) => player.id === body.playerId);
    if (!known) {
      res.status(404).json({ error: "Unknown player." });
      return;
    }
  }
  const schema = sheetSchemaForScenario(resolveScenarioForRoom(room.id));
  const values = rollAllocationValues(schema);
  if (values === null) {
    res.status(409).json({ error: "This scenario does not use dice-roll allocation." });
    return;
  }
  res.status(200).json({ values });
});

/** The EZFudge attribute key set the AI coordinator's proposeAttributes returns. */
const EZFUDGE_KEYS: readonly string[] = ["Might", "Agility", "Wits", "Spirit"];

/** True when a trait-key set is exactly the four EZFudge attributes (any order). */
function isEzfudgeKeys(keys: readonly string[]): boolean {
  return keys.length === EZFUDGE_KEYS.length && EZFUDGE_KEYS.every((k) => keys.includes(k));
}

/** `POST /rooms/:roomId/players/:playerId/proposal` — AI attribute proposal. */
app.post("/rooms/:roomId/players/:playerId/proposal", async (req, res) => {
  if (!restAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Derive the acting identity from the connection ticket (#2): enforce the gate
  // before producing any proposal. The proposal body keys off roomId/scenario.
  const identity = authorizePlayerAction(req, res, req.params.roomId, req.params.playerId);
  if (identity === null) return;
  const body = (req.body ?? {}) as { concept?: string; traitKeys?: unknown };
  const conceptInput = readBoundedText(body.concept, {
    field: "Concept",
    maxLength: MAX_CONCEPT_LENGTH,
  });
  if (!conceptInput.ok) {
    res.status(conceptInput.status).json({ error: conceptInput.error });
    return;
  }
  const concept = conceptInput.value;
  const scenario = resolveScenarioForRoom(req.params.roomId);
  const spec = expectedTraitSpecForScenario(scenario);
  // Honor the requested trait keys (the screen sends the active schema's keys);
  // fall back to the scenario's own keys.
  const traitKeys = Array.isArray(body.traitKeys)
    ? body.traitKeys.filter((k): k is string => typeof k === "string")
    : spec.keys;

  // For universal (EZFudge) scenarios, ask the REAL AI GM for a complete
  // attribute set. The coordinator's proposeAttributes is EZFudge-specific, so
  // custom-stat (geese) and narrative-only (sinks) sheets use the deterministic
  // heuristic. Budget exhaustion returns an explicit throttle; other AI failures
  // fall back to the heuristic so the screen still gets a usable proposal.
  if (isEzfudgeKeys(traitKeys)) {
    const aiGuard = proposalAiGuard.acquire({
      roomId: identity.roomId,
      playerId: identity.playerId,
      endpointKey: `${identity.roomId}:${identity.playerId}`,
    });
    if (!aiGuard.ok) {
      writeAiCostFailure(res, aiGuard);
      return;
    }
    try {
      const result = await engine.coordinator.proposeAttributes(concept, scenario);
      if (result.ok) {
        res.status(200).json({ values: result.value });
        return;
      }
    } catch {
      // fall through to the deterministic proposal
    }
  }

  const values = proposeAttributes(concept, traitKeys, spec.ladder);
  res.status(200).json({ values });
});

/** `POST /rooms/:roomId/players/:playerId/narrative-draft` — AI narrative field drafts. */
app.post("/rooms/:roomId/players/:playerId/narrative-draft", async (req, res) => {
  if (!restAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const identity = authorizePlayerAction(req, res, req.params.roomId, req.params.playerId);
  if (identity === null) return;
  const body = (req.body ?? {}) as { concept?: string; selectedCardId?: unknown };
  const conceptInput = readBoundedText(body.concept, {
    field: "Concept",
    maxLength: MAX_CONCEPT_LENGTH,
  });
  if (!conceptInput.ok) {
    res.status(conceptInput.status).json({ error: conceptInput.error });
    return;
  }
  const scenario = resolveScenarioForRoom(identity.roomId);
  const schema = sheetSchemaForScenario(scenario);
  const selectedCardId =
    typeof body.selectedCardId === "string" && body.selectedCardId.trim().length > 0
      ? body.selectedCardId.trim()
      : undefined;
  const prompt = buildNarrativeDraftPrompt({
    scenario,
    schema,
    concept: conceptInput.value,
    ...(selectedCardId !== undefined ? { selectedCardId } : {}),
  });
  const aiGuard = proposalAiGuard.acquire({
    roomId: identity.roomId,
    playerId: identity.playerId,
    endpointKey: `narrative:${identity.roomId}:${identity.playerId}`,
  });
  if (!aiGuard.ok) {
    res.status(aiGuard.status).json({ error: aiGuard.error, reason: aiGuard.reason });
    return;
  }
  try {
    const response = await aiClient.complete({ tier: "fast", prompt, budget: 700 });
    const parsed = parseNarrativeDraftResponse(response.text, schema);
    if (!parsed.ok) {
      res.status(502).json({ error: "AI narrative draft failed." });
      return;
    }
    res.status(200).json({ drafts: parsed.drafts });
  } catch {
    res.status(502).json({ error: "AI narrative draft failed." });
  } finally {
    aiGuard.release();
  }
});

/** `POST /rooms/:roomId/players/:playerId/character` — record (save) the character. */
app.post("/rooms/:roomId/players/:playerId/character", async (req, res) => {
  if (!restAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Derive the acting identity from the connection ticket (#2): reject before any
  // service call so a forged/cross-player request never records a character.
  const identity = authorizePlayerAction(req, res, req.params.roomId, req.params.playerId);
  if (identity === null) return;
  if (requireLobbyForCharacterMutation(res, identity.roomId) === null) return;
  const body = (req.body ?? {}) as {
    name?: string;
    narrative?: Record<string, unknown>;
    attributes?: unknown;
    selectedCardId?: unknown;
  };
  const nameInput = readBoundedText(body.name, {
    field: "Character name",
    maxLength: MAX_DISPLAY_NAME_LENGTH,
  });
  if (!nameInput.ok) {
    res.status(nameInput.status).json({ error: nameInput.error });
    return;
  }
  const rawConcept =
    body.narrative && typeof body.narrative.concept === "string" ? body.narrative.concept : "";
  const conceptInput = readBoundedText(rawConcept, {
    field: "Concept",
    maxLength: MAX_CONCEPT_LENGTH,
  });
  if (!conceptInput.ok) {
    res.status(conceptInput.status).json({ error: conceptInput.error });
    return;
  }
  const name = nameInput.value;
  const concept = conceptInput.value;
  // Preserve ALL string narrative fields the sheet collected (disposition,
  // goal, card answers, …) — not just concept — so ruleset-specific sheet data
  // survives the backend round-trip and can ground the AI GM (sheetData).
  const narrativeFields: Record<string, string> = {};
  if (body.narrative !== undefined) {
    for (const [key, value] of Object.entries(body.narrative)) {
      if (typeof value === "string") {
        const narrativeInput = readBoundedText(value, {
          field: "Narrative field",
          maxLength: MAX_CONCEPT_LENGTH,
        });
        if (!narrativeInput.ok) {
          res.status(narrativeInput.status).json({ error: narrativeInput.error });
          return;
        }
        narrativeFields[key] = narrativeInput.value;
      }
    }
  }
  const scenario = resolveScenarioForRoom(req.params.roomId);
  // Validate attributes against the room's scenario trait spec (EZFudge keys for
  // universal scenarios, custom keys/ladder for special-rules scenarios, or an
  // empty key set for narrative-only sheets — which skips attribute validation).
  const spec = expectedTraitSpecForScenario(scenario);
  // Card_Based_Sheet: validate + persist the selected role card server-side so
  // the selection round-trips (and CARD_TAKEN dedup can work at confirm time).
  const scenarioCards = cardsForScenario(scenario);
  const selectedCardId =
    typeof body.selectedCardId === "string" && body.selectedCardId.trim().length > 0
      ? body.selectedCardId.trim()
      : undefined;
  const result = characterService.recordCharacter(
    identity.playerId,
    {
      name,
      concept,
      attributes: readAttributes(body.attributes),
      ...(Object.keys(narrativeFields).length > 0 ? { sheetData: { narrativeFields } } : {}),
    },
    {
      traitKeys: spec.keys,
      ladder: spec.ladder,
      ...(scenarioCards !== undefined && scenarioCards.length > 0
        ? { characterCards: [...scenarioCards] }
        : {}),
      ...(selectedCardId !== undefined ? { selectedCardId } : {}),
    },
  );
  // Business outcomes (success or known rejection reason) are returned as 200
  // with a discriminated body so the screen classifies on `reason`; auth/server
  // failures use non-2xx (handled by the auth gate / Express defaults).
  if (result.ok) {
    if (durableRoomRepository !== undefined) {
      const player = persistence.roomStore.getPlayer(identity.playerId);
      if (player === undefined) {
        writePersistenceFailure(res, new Error(`Unknown player id: ${identity.playerId}`));
        return;
      }
      try {
        await durableRoomRepository.saveCharacterForPlayer(result.character, player);
      } catch (error) {
        writePersistenceFailure(res, error);
        return;
      }
    }
    res.status(200).json({ ok: true, character: result.character });
    return;
  }
  res.status(200).json({ ok: false, reason: result.reason, message: result.message });
});

/** `POST /rooms/:roomId/players/:playerId/character/confirm` — confirm (lock) it. */
app.post("/rooms/:roomId/players/:playerId/character/confirm", async (req, res) => {
  if (!restAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Derive the acting identity from the connection ticket (#2): reject before any
  // service call so a forged/cross-player request never confirms a character.
  const identity = authorizePlayerAction(req, res, req.params.roomId, req.params.playerId);
  if (identity === null) return;
  if (requireLobbyForCharacterMutation(res, identity.roomId) === null) return;
  const result = characterService.confirmCharacter(identity.playerId);
  if (result.ok) {
    if (durableRoomRepository !== undefined) {
      const player = persistence.roomStore.getPlayer(identity.playerId);
      if (player === undefined) {
        writePersistenceFailure(res, new Error(`Unknown player id: ${identity.playerId}`));
        return;
      }
      try {
        await durableRoomRepository.saveCharacterForPlayer(result.character, player);
      } catch (error) {
        writePersistenceFailure(res, error);
        return;
      }
    }
    // The session is no longer auto-started here. Confirming only locks the
    // character; the session starts exclusively via the explicit host start
    // endpoint (`POST /rooms/:roomId/players/:playerId/start`).
    res.status(200).json({ ok: true, character: result.character });
    return;
  }
  res.status(200).json({ ok: false, reason: result.reason, message: result.message });
});

/**
 * `GET /rooms/:id/readiness` — readiness snapshot for the room used by the
 * character/lobby screens to decide whether the host may start. Gated by the
 * shared-secret only (no rate limiter). Returns counts of players and confirmed
 * characters, whether all have confirmed, whether the session has started, and
 * the host player id.
 */
app.get("/rooms/:id/readiness", (req, res) => {
  const room = persistence.roomStore.getRoom(req.params.id);
  if (room === undefined) {
    res.status(404).json({ error: "Unknown room." });
    return;
  }
  const roomId = req.params.id;
  if (authorizeRoomMemberRead(req, res, roomId) === null) return;
  const players = persistence.roomStore.listPlayers(roomId);
  const playerIds = new Set(players.map((p) => p.id));
  // Count distinct players whose recorded character is confirmed AND who are
  // still players in the room.
  const confirmedPlayerIds = new Set(
    persistence.roomStore
      .listCharactersByRoom(roomId)
      .filter((c) => c.confirmed)
      .map((c) => c.playerId)
      .filter((pid) => playerIds.has(pid)),
  );
  res.status(200).json({
    total: players.length,
    confirmed: confirmedPlayerIds.size,
    allConfirmed: characterService.canStart(roomId),
    started: startedRooms.has(roomId) || room.state !== "lobby",
    hostPlayerId: room.hostPlayerId,
    // Host asked everyone to return to the lobby (character screen pollers act on this).
    returnToLobby: lobbyReturnRooms.has(roomId),
  });
});

/**
 * `POST /rooms/:roomId/players/:playerId/start` — explicit, host-triggered
 * session start. Gated by the shared-secret only (no rate limiter). Business
 * outcomes use 200 with a discriminated body (the screen classifies on the
 * body); only the auth gate uses a non-2xx status.
 */
app.post("/rooms/:roomId/players/:playerId/start", async (req, res) => {
  if (!restAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Derive the acting identity from the connection ticket (#2): reject before any
  // business logic so a forged/cross-player request never starts a session.
  const identity = authorizePlayerAction(req, res, req.params.roomId, req.params.playerId);
  if (identity === null) return;
  const room = persistence.roomStore.getRoom(req.params.roomId);
  if (room === undefined) {
    res.status(404).json({ error: "Unknown room." });
    return;
  }
  // Only the host may start the session.
  if (identity.playerId !== room.hostPlayerId) {
    res.status(200).json({ ok: false, reason: "NOT_HOST" });
    return;
  }
  // Every player must have confirmed a character first.
  if (!characterService.canStart(req.params.roomId)) {
    res.status(200).json({ ok: false, reason: "NOT_ALL_CONFIRMED" });
    return;
  }
  // Start the session (idempotent: an already-started room is treated as
  // started too). maybeStartSession guards against double-dispatch and reports
  // whether the session is actually active so the host can be told when a start
  // could not proceed (e.g. the global AI-cost slot cap is reached).
  let outcome: { started: boolean; reason?: string };
  try {
    outcome = await maybeStartSession(req.params.roomId);
  } catch (error) {
    writePersistenceFailure(res, error);
    return;
  }
  if (outcome.started) {
    res.status(200).json({ ok: true, started: true });
    return;
  }
  if (isStartFailureHttpError(outcome)) {
    res.status(503).json({
      ok: false,
      started: false,
      reason: "START_FAILED",
      error: "Session start failed; try again.",
    });
    return;
  }
  if (writeStartGuardFailure(res, outcome)) return;
  res.status(200).json({ ok: false, started: false, reason: outcome.reason ?? "START_FAILED" });
});

/**
 * `POST /rooms/:roomId/players/:playerId/return-to-lobby` — host-only. Flags the
 * room so every player polling readiness on the character screen returns to the
 * lobby together (e.g. so the host can change the scenario). Gated by the
 * shared-secret + connection ticket; business outcomes use 200 with a
 * discriminated body (only the auth gate uses a non-2xx status).
 */
app.post("/rooms/:roomId/players/:playerId/return-to-lobby", (req, res) => {
  if (!restAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const identity = authorizePlayerAction(req, res, req.params.roomId, req.params.playerId);
  if (identity === null) return;
  const room = persistence.roomStore.getRoom(req.params.roomId);
  if (room === undefined) {
    res.status(404).json({ error: "Unknown room." });
    return;
  }
  // Only the host may send everyone back to the lobby.
  if (identity.playerId !== room.hostPlayerId) {
    res.status(200).json({ ok: false, reason: "NOT_HOST" });
    return;
  }
  // Only meaningful during character setup (before the session starts).
  if (room.state !== "lobby") {
    res.status(200).json({ ok: false, reason: "NOT_LOBBY" });
    return;
  }
  // Unconfirm everyone so previously confirmed players can revise against the
  // (possibly new) scenario after returning — otherwise they would be locked.
  characterService.unconfirmRoom(req.params.roomId);
  lobbyReturnRooms.add(req.params.roomId);
  res.status(200).json({ ok: true });
});

/**
 * Start the room's session exactly once when every player has confirmed a
 * character. Guards against double-start via {@link startedRooms} and only
 * fires while the room is still in `lobby`. Acquires an AI-cost session slot;
 * if none is available the start is skipped and the caller is told the room is
 * AT_CAPACITY (the confirm still succeeds, the host can retry later). Returns
 * `{ started }` so the explicit start endpoint can report the truthful outcome.
 */
async function maybeStartSession(roomId: string): Promise<{ started: boolean; reason?: string }> {
  return startMultiplayerSession({
    roomId,
    characterGate: characterService,
    roomStore: persistence.roomStore,
    ...(durableRoomRepository !== undefined ? { durableRoomRepository } : {}),
    startedRooms,
    aiGuard: multiplayerStartAiGuard,
    orchestrator,
    broadcastToRoom,
    logFailure: (message) => process.stderr.write(`\n[playtest] ${message}\n`),
  });
}

const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD_BYTES }); // game / solo play socket
const lobbyWss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD_BYTES }); // lobby waiting-room socket
// Route WebSocket upgrades by path so the lobby and the game share one HTTP
// server. Unknown paths are rejected.
server.on("upgrade", (request, socket, head) => {
  const { pathname } = new URL(request.url ?? "", `http://localhost:${PORT}`);
  if (pathname === "/ws") {
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  } else if (pathname === "/lobby/ws") {
    lobbyWss.handleUpgrade(request, socket, head, (ws) => lobbyWss.emit("connection", ws, request));
  } else {
    socket.destroy();
  }
});

/**
 * Resolve the player identity for a game `/ws` socket strictly from a
 * server-issued connection ticket. The `ticket` query param is authorized via
 * {@link authorizeConnection} (ticket resolution + room-membership re-check)
 * and the resulting Ticket_Identity is the only identity ever returned. There
 * is no client-supplied `roomId`/`playerId` fallback: when the ticket is absent
 * or invalid this returns `null` and the caller closes the socket as
 * unauthorized. This closes the "ws ticket gap" where knowing a room/player
 * UUID let anyone connect as the host or any room member. The shared-secret
 * gate is enforced separately by the caller.
 */
function resolveSocketIdentity(
  params: URLSearchParams,
): { roomId: string; playerId: string } | null {
  const ticket = params.get("ticket");
  if (ticket === null || ticket.length === 0) return null;
  const auth = authorizeConnection(connectionTickets, persistence.roomStore, ticket);
  return auth.ok ? auth.identity : null;
}

wss.on("connection", (socket, request) => {
  const params = new URL(request.url ?? "", `http://localhost:${PORT}`).searchParams;

  // Identity from a server-issued connection ticket.
  const identity = resolveSocketIdentity(params);
  if (identity === null) {
    socket.close(1008, "unauthorized");
    return;
  }
  const { roomId, playerId } = identity;

  // Register with the gateway so this socket receives Turn_State + narration.
  const connection = new WsConnection({ id: randomUUID(), roomId, playerId }, socket);
  gateway.connect(connection);
  sessionLogger.log("ws_connect", { roomId, playerId });
  const messageRateKey = `ws:${roomId}:${playerId}:${connection.id}`;

  // Map inbound client messages to orchestrator commands.
  socket.on("message", (raw: unknown) => {
    if (!wsMessageRateLimiter.tryAcquire(messageRateKey)) {
      socket.close(1008, "rate-limit");
      return;
    }
    let msg: { type?: string; text?: string; action?: string };
    try {
      msg = JSON.parse(String(raw)) as typeof msg;
    } catch {
      return; // ignore non-JSON (e.g. heartbeat) frames
    }
    const command = toCommand(playerId, msg);
    if (command !== null) {
      sessionLogger.log("ws_command", {
        roomId,
        playerId,
        type: command.type,
        ...(command.type === "SEND_CHAT" ? { text: command.text } : {}),
        ...(command.type === "CONFIRM_ACTION" ? { action: command.action } : {}),
        ...(command.type === "REVISE" && command.action !== null ? { action: command.action } : {}),
        ...(command.type === "ROLL_CHECK" ? { checkId: command.checkId } : {}),
      });
      void orchestrator.dispatch(roomId, command);
    }
  });

  socket.on("close", () => sessionLogger.log("ws_close", { roomId, playerId }));
});

// Lobby waiting-room socket: seeds the roster + scenario, and on START_SESSION
// kicks off the real engine session (AI opening) and tells the lobby to hand
// off to the game screen.
lobbyWss.on("connection", (socket, request) => {
  const params = new URL(request.url ?? "", `http://localhost:${PORT}`).searchParams;
  // Identity is derived STRICTLY from the server-issued connection ticket
  // (auth-hardening, backend-server-qa P1-1): the same rule the game `/ws`
  // uses. No client-supplied `playerId` is trusted and there is NO host
  // fallback, so a joined non-host can no longer impersonate the host to send
  // SET_SCENARIO / START_SESSION. A missing/invalid ticket closes the socket.
  const identity = resolveSocketIdentity(params);
  if (identity === null) {
    socket.close(1008, "unauthorized");
    return;
  }
  const room = persistence.roomStore.getRoom(identity.roomId);
  if (room === undefined) {
    socket.close(1008, "unknown-room");
    return;
  }
  const viewerId = identity.playerId;
  const lobbyMessageRateKey = `lobby:${room.id}:${viewerId}:${randomUUID()}`;

  // Register this socket into the room's broadcast set.
  let roomSet = lobbySockets.get(room.id);
  if (roomSet === undefined) {
    roomSet = new Set();
    lobbySockets.set(room.id, roomSet);
  }
  roomSet.add(socket);

  /** Broadcast the current roster to every lobby socket in the room. */
  const broadcastRoster = (): void => {
    const players = persistence.roomStore.listPlayers(room.id).map((p) => ({
      id: p.id,
      displayName: p.displayName,
      isHost: p.isHost,
    }));
    broadcastToRoom(room.id, { type: "player_list_updated", players });
  };

  // Broadcast the roster to everyone now that this socket has connected.
  broadcastRoster();

  /** Send a `scenario_set` for the room's currently-selected scenario. */
  const currentScenario = (): { id: string; title: string; summary: string } => {
    const id = persistence.scenarioStore.getSelection(room.id) ?? room.scenarioId ?? MVP_SCENARIO.id;
    const scenario = persistence.scenarioStore.getScenario(id) ?? MVP_SCENARIO;
    return { id: scenario.id, title: scenario.title, summary: scenario.summary };
  };
  // Seed the scenario for the connecting socket only (as today).
  const scenario = currentScenario();
  socket.send(
    JSON.stringify({
      type: "scenario_set",
      scenarioId: scenario.id,
      title: scenario.title,
      summary: scenario.summary,
    }),
  );

  socket.on("message", (raw: unknown) => {
    if (!wsMessageRateLimiter.tryAcquire(lobbyMessageRateKey)) {
      socket.close(1008, "rate-limit");
      return;
    }
    let msg: { type?: string; scenarioId?: string };
    try {
      msg = JSON.parse(String(raw)) as typeof msg;
    } catch {
      return;
    }
    // Host picks a scenario from the lobby combobox before starting. Only the
    // host may change the selection; ignore SET_SCENARIO from any other identity.
    if (msg.type === "SET_SCENARIO") {
      if (viewerId !== room.hostPlayerId) return;
      const scenarioId = readBoundedText(msg.scenarioId, {
        field: "Scenario ID",
        maxLength: MAX_SCENARIO_ID_LENGTH,
        required: true,
      });
      if (!scenarioId.ok) return;
      const picked =
        persistence.scenarioStore.getScenario(scenarioId.value);
      if (picked !== undefined) {
        persistence.scenarioStore.setSelection(room.id, picked.id);
        // Persist the choice on the room so START_SESSION resolves it.
        persistence.roomStore.saveRoom({ ...room, scenarioId: picked.id });
        // Broadcast so every lobby member sees the selected scenario.
        broadcastToRoom(room.id, {
          type: "scenario_set",
          scenarioId: picked.id,
          title: picked.title,
          summary: picked.summary,
        });
      }
      return;
    }
    if (msg.type === "START_SESSION") {
      // Host-only: ignore a START_SESSION from any non-host identity.
      if (viewerId !== room.hostPlayerId) return;
      // A fresh character-setup round clears any pending "return to lobby" flag
      // so players are not bounced straight back after re-entering the sheet.
      lobbyReturnRooms.delete(room.id);
      // The lobby "start" only signals everyone to move to character setup; it
      // does NOT start the session (that is the all-confirmed gate's job). No
      // session slot is acquired and no orchestrator START_SESSION runs here.
      broadcastToRoom(room.id, { type: "character_setup" });
    }
  });

  socket.on("close", () => {
    const set = lobbySockets.get(room.id);
    if (set !== undefined) {
      set.delete(socket);
      if (set.size === 0) lobbySockets.delete(room.id);
    }
    // Broadcast the updated roster to the remaining lobby members.
    broadcastRoster();
  });
});


/** Translate a browser message into an {@link OrchestratorCommand}. */
function toCommand(
  playerId: string,
  msg: { type?: string; text?: string; action?: string; checkId?: string },
): OrchestratorCommand | null {
  switch (msg.type) {
    case "chat":
      if (typeof msg.text !== "string") return null;
      {
        const text = readBoundedText(msg.text, {
          field: "Chat message",
          maxLength: MAX_CHAT_LENGTH,
          required: true,
        });
        return text.ok ? { type: "SEND_CHAT", from: playerId, text: text.value } : null;
      }
    case "confirm":
      if (typeof msg.action !== "string") return null;
      {
        const action = readBoundedText(msg.action, {
          field: "Action",
          maxLength: MAX_ACTION_LENGTH,
          required: true,
        });
        return action.ok ? { type: "CONFIRM_ACTION", from: playerId, action: action.value } : null;
      }
    case "pass":
      return { type: "PASS", from: playerId };
    case "revise":
      if (typeof msg.action !== "string") return { type: "REVISE", from: playerId, action: null };
      {
        const action = readBoundedText(msg.action, {
          field: "Action",
          maxLength: MAX_ACTION_LENGTH,
        });
        return action.ok ? { type: "REVISE", from: playerId, action: action.value || null } : null;
      }
    case "roll_check":
      if (typeof msg.checkId !== "string") return null;
      {
        const checkId = readBoundedText(msg.checkId, {
          field: "Check id",
          maxLength: MAX_CHECK_ID_LENGTH,
          required: true,
        });
        return checkId.ok ? { type: "ROLL_CHECK", from: playerId, checkId: checkId.value } : null;
      }
    default:
      return null;
  }
}

server.listen(PORT, HOST, () => {
  process.stdout.write(`\nTRPG playtest server: http://${HOST}:${PORT}\n`);
});
