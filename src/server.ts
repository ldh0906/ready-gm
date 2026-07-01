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
import { fileURLToPath, URL } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import { WebSocketServer } from "ws";
import { createEngine } from "./realtime/engine.js";
import { createSessionLogger } from "./observability/session-log.js";
import { WsConnection } from "./realtime/ws-connection.js";
import type { OrchestratorCommand } from "./realtime/room-orchestrator.js";
import { createCliAiGmClient } from "./ai/cli-client-factory.js";
import { MVP_SCENARIO, DEMO_SCENARIO_CATALOG } from "./services/scenario-service.js";
import { CharacterService } from "./services/character-service.js";
import { RoomService } from "./services/room-service.js";
import {
  sheetSchemaForScenario,
  expectedTraitSpecForScenario,
  cardsForScenario,
} from "./services/sheet-schema.js";
import type { Scenario } from "./services/scenario-service.js";
import { dealCardHand } from "./services/card-dealing.js";
import { toContext } from "./services/turn-state-context.js";
import {
  createSoloSessionStore,
  makeSoloCharacter,
  runSoloAct,
} from "./http/solo-play.js";
import type { AttributeKey, AttributeLevel } from "./core/types.js";
import {
  FixedWindowRateLimiter,
  SessionSlotLimiter,
  checkStartupSafety,
  playtestToken,
  resolveBinding,
  tokenMatches,
} from "./server-security.js";
import { ConnectionTicketStore, authorizeConnection, authorizeAction } from "./realtime/connection-tickets.js";
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
const sessionSlots = new SessionSlotLimiter(MAX_CONCURRENT_SESSIONS, SESSION_SLOT_TTL_MS);

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

// Force in-memory persistence for a friction-free local playtest (no DB writes),
// regardless of any DATABASE_URL in the environment. The AI GM brain is chosen
// by `AI_GM_CLI` (`codex` default, or `claude` for the Claude Code CLI).
const engine = createEngine({
  aiClient: createCliAiGmClient(process.env),
  env: {},
  scenarioCatalog: DEMO_SCENARIO_CATALOG,
  // Best-effort local session trace for debugging (default on; SESSION_LOG=0 to
  // disable, SESSION_LOG_FILE to relocate). Captures inbound commands, the AI
  // raw output + parse result, round flow, and narration delivery.
  sessionLogger: createSessionLogger(process.env, join(process.cwd(), "logs", "session.jsonl")),
});
const { orchestrator, gateway, persistence, sessionLogger } = engine;
if (sessionLogger.enabled) sessionLogger.log("server_start", { host: HOST, port: PORT });

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
    if (priorState === "in_session") sessionSlots.release();
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

// Lobby socket registry: room id -> set of open lobby WebSockets in that room.
// Used to broadcast roster / scenario / character_setup events to every lobby
// member (not just the connecting socket).
const lobbySockets = new Map<string, Set<import("ws").WebSocket>>();

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
// Behind a tunnel/reverse proxy (cloudflared, ngrok) every request reaches the
// loopback origin from 127.0.0.1, which would (a) collapse the per-IP rate limit
// into ONE shared bucket for all players and (b) make req.protocol "http" so
// generated invite links use http. Trusting the proxy makes req.ip the real
// client IP (from X-Forwarded-For) and req.protocol honor X-Forwarded-Proto, so
// links come out https. Safe here: the server binds to loopback by default, so
// only the local tunnel connects to it; a direct LAN client (HOST=0.0.0.0) sends
// no X-Forwarded-* and is unaffected.
app.set("trust proxy", true);
// Cap request bodies: `/play/new` only needs a tiny JSON payload, so a small
// limit removes a cheap memory-pressure lever.
app.use(express.json({ limit: "16kb" }));
app.use(express.static(join(dirname(fileURLToPath(import.meta.url)), "..", "public")));

/** Seed a solo room and start the session. Returns ids for the WebSocket. */
app.post("/play/new", (req, res) => {
  // Shared-secret gate (no-op when no token is configured).
  if (!tokenMatches(TOKEN, tokenFromRequest(req.header("x-playtest-token"), null))) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Per-IP rate limit to bound burst abuse of the AI-cost surface.
  const clientIp = req.ip ?? req.socket.remoteAddress ?? "unknown";
  if (!newSessionRateLimiter.tryAcquire(clientIp)) {
    res.status(429).json({ error: "Too many requests; slow down." });
    return;
  }

  // Global cap on concurrent session starts to bound total AI generation cost.
  if (!sessionSlots.tryAcquire()) {
    res.status(503).json({ error: "Server is at capacity; try again shortly." });
    return;
  }

  const body = (req.body ?? {}) as { displayName?: string; concept?: string };
  const displayName = (body.displayName ?? "모험가").trim() || "모험가";
  const concept = (body.concept ?? "용감한 모험가").trim() || "용감한 모험가";

  const roomId = randomUUID();
  const playerId = randomUUID();
  const characterId = randomUUID();

  persistence.roomStore.saveRoom({
    id: roomId,
    inviteToken: randomUUID(),
    hostPlayerId: playerId,
    scenarioId: MVP_SCENARIO.id,
    state: "in_session",
    maxPlayers: 6,
    createdAt: new Date().toISOString(),
  });
  persistence.roomStore.savePlayer({
    id: playerId,
    roomId,
    displayName,
    isHost: true,
    characterId,
    connectionStatus: "connected",
  });
  persistence.roomStore.saveCharacter({
    id: characterId,
    playerId,
    roomId,
    name: displayName,
    concept,
    attributes: { ...DEFAULT_ATTRS },
    confirmed: true,
  });
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

  // Per-IP rate limit + global concurrent-session cap on the AI-cost surface.
  const clientIp = req.ip ?? req.socket.remoteAddress ?? "unknown";
  if (!newSessionRateLimiter.tryAcquire(clientIp)) {
    res.status(429).json({ error: "Too many requests; slow down." });
    return;
  }
  if (!sessionSlots.tryAcquire()) {
    res.status(503).json({ error: "Server is at capacity; try again shortly." });
    return;
  }

  const body = (req.body ?? {}) as { displayName?: string; concept?: string };
  const sessionId = randomUUID();
  const character = makeSoloCharacter(
    { displayName: body.displayName, concept: body.concept },
    { playerId: randomUUID(), characterId: randomUUID(), roomId: sessionId },
  );
  const session = soloSessions.create(character, MVP_SCENARIO);

  // Build a free_chat context and ask the real LLM for the opening narration.
  const ctx = toContext(
    {
      roomId: sessionId,
      roundNumber: 1,
      phase: "free_chat",
      readiness: [],
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
  const action = (body.action ?? "").trim();
  if (action.length === 0) {
    res.status(400).json({ error: "Action is required." });
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

  const response = await runSoloAct(session, action, engine.coordinator, engine.config);
  soloSessions.set(session.id, session);
  res.status(200).json(response);
});

const server = createServer(app);

// ---------------------------------------------------------------------------
// Multiplayer lobby demo surface — additive. Backs the host-entry -> lobby ->
// game screen chain with an in-memory room (reusing persistence.roomStore and
// the engine). Creating a room is cheap; the AI cost is only paid on
// START_SESSION (driven over /lobby/ws). Nothing here touches /play/new or
// /solo/*.
const LOBBY_MAX_PLAYERS = 6;

/** Build a public invite link whose LAST path segment is the invite token
 * (the lobby extracts that segment to resolve the room). When a PLAYTEST_TOKEN
 * shared secret is configured, append it as `?token=` so the link works on a
 * token-gated public/tunnel deploy: the join page reads `?token=` and sends it
 * as `x-playtest-token`, so without it an invited friend's join would 401. The
 * token is a per-link shared secret (handed out with the link by design), not a
 * per-user credential, so embedding it here is intended. */
function inviteLinkFor(req: express.Request, inviteToken: string): string {
  const host = req.get("host") ?? `${HOST}:${PORT}`;
  const base = `${req.protocol}://${host}/join/${encodeURIComponent(inviteToken)}`;
  return TOKEN ? `${base}?token=${encodeURIComponent(TOKEN)}` : base;
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

/** Create a lobby room with a host player + confirmed character (no AI yet). */
app.post("/rooms", (req, res) => {
  if (!restAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const clientIp = req.ip ?? req.socket.remoteAddress ?? "unknown";
  if (!newSessionRateLimiter.tryAcquire(clientIp)) {
    res.status(429).json({ error: "Too many requests; slow down." });
    return;
  }

  const body = (req.body ?? {}) as { displayName?: string; scenarioId?: string };
  const displayName = (body.displayName ?? "").trim() || "호스트";
  // Pick the requested scenario when it exists in the catalog, else default MVP.
  const requested =
    typeof body.scenarioId === "string"
      ? persistence.scenarioStore.getScenario(body.scenarioId)
      : undefined;
  const scenarioId = requested?.id ?? MVP_SCENARIO.id;
  const roomId = randomUUID();
  const playerId = randomUUID();
  const characterId = randomUUID();
  const inviteToken = randomUUID();

  persistence.roomStore.saveRoom({
    id: roomId,
    inviteToken,
    hostPlayerId: playerId,
    scenarioId,
    state: "lobby",
    maxPlayers: LOBBY_MAX_PLAYERS,
    createdAt: new Date().toISOString(),
  });
  persistence.roomStore.savePlayer({
    id: playerId,
    roomId,
    displayName,
    isHost: true,
    characterId,
    connectionStatus: "connected",
  });
  persistence.roomStore.saveCharacter({
    id: characterId,
    playerId,
    roomId,
    name: displayName,
    concept: "용감한 모험가",
    attributes: { ...DEFAULT_ATTRS },
    confirmed: false,
  });
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
  if (!restAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const room = persistence.roomStore.getRoom(req.params.id);
  if (room === undefined) {
    res.status(404).json({ error: "Unknown room." });
    return;
  }
  res.status(200).json({ inviteLink: inviteLinkFor(req, room.inviteToken) });
});

/** Resolve a room by its invite token (or id): capacity + selected scenario. */
app.get("/rooms/:token", (req, res) => {
  if (!restAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const room =
    persistence.roomStore.getRoomByToken(req.params.token) ??
    persistence.roomStore.getRoom(req.params.token);
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

/**
 * `POST /rooms/:token/join` — add an unconfirmed player to a lobby room so the
 * character-sheet screen has a real (roomId, playerId) handoff to author against.
 * Resolves the room by invite token OR id. Returns the new player's id.
 */
app.post("/rooms/:token/join", (req, res) => {
  if (!restAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const clientIp = req.ip ?? req.socket.remoteAddress ?? "unknown";
  if (!newSessionRateLimiter.tryAcquire(clientIp)) {
    res.status(429).json({ error: "Too many requests; slow down." });
    return;
  }
  const room =
    persistence.roomStore.getRoomByToken(req.params.token) ??
    persistence.roomStore.getRoom(req.params.token);
  if (room === undefined) {
    res.status(404).json({ error: "Unknown room." });
    return;
  }
  const body = (req.body ?? {}) as { displayName?: string };
  const displayName = (body.displayName ?? "").trim() || "플레이어";
  // Delegate to the RoomService so lobby gating, capacity, and in-room name
  // uniqueness are enforced by the shared domain rules (resolve id→token first
  // so callers may pass either the invite token or the room id).
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
 * random role-card hand for a Card_Based_Sheet. Loopback-gated only (parallel
 * to `GET /rooms/:id/sheet-schema`; no ticket auth). Non-card scenarios return
 * an empty list. The hand excludes cards already confirmed by OTHER players in
 * the room (so the requester's own confirmed card stays visible to them).
 */
app.get("/rooms/:roomId/players/:playerId/cards", (req, res) => {
  if (!restAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const { roomId, playerId } = req.params;
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
  const concept = String(body.concept ?? "");
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
  // heuristic. Any AI failure (CLI unavailable, timeout, malformed output)
  // falls back to the heuristic so the screen always gets a usable proposal.
  if (isEzfudgeKeys(traitKeys)) {
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

/** `POST /rooms/:roomId/players/:playerId/character` — record (save) the character. */
app.post("/rooms/:roomId/players/:playerId/character", (req, res) => {
  if (!restAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Derive the acting identity from the connection ticket (#2): reject before any
  // service call so a forged/cross-player request never records a character.
  const identity = authorizePlayerAction(req, res, req.params.roomId, req.params.playerId);
  if (identity === null) return;
  const body = (req.body ?? {}) as {
    name?: string;
    narrative?: Record<string, unknown>;
    attributes?: unknown;
  };
  const name = typeof body.name === "string" ? body.name : "";
  const concept =
    body.narrative && typeof body.narrative.concept === "string" ? body.narrative.concept : "";
  // Validate attributes against the room's scenario trait spec (EZFudge keys for
  // universal scenarios, custom keys/ladder for special-rules scenarios, or an
  // empty key set for narrative-only sheets — which skips attribute validation).
  const spec = expectedTraitSpecForScenario(resolveScenarioForRoom(req.params.roomId));
  const result = characterService.recordCharacter(
    identity.playerId,
    { name, concept, attributes: readAttributes(body.attributes) },
    { traitKeys: spec.keys, ladder: spec.ladder },
  );
  // Business outcomes (success or known rejection reason) are returned as 200
  // with a discriminated body so the screen classifies on `reason`; auth/server
  // failures use non-2xx (handled by the auth gate / Express defaults).
  if (result.ok) {
    res.status(200).json({ ok: true, character: result.character });
    return;
  }
  res.status(200).json({ ok: false, reason: result.reason, message: result.message });
});

/** `POST /rooms/:roomId/players/:playerId/character/confirm` — confirm (lock) it. */
app.post("/rooms/:roomId/players/:playerId/character/confirm", (req, res) => {
  if (!restAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Derive the acting identity from the connection ticket (#2): reject before any
  // service call so a forged/cross-player request never confirms a character.
  const identity = authorizePlayerAction(req, res, req.params.roomId, req.params.playerId);
  if (identity === null) return;
  const result = characterService.confirmCharacter(identity.playerId);
  if (result.ok) {
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
  if (!restAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const room = persistence.roomStore.getRoom(req.params.id);
  if (room === undefined) {
    res.status(404).json({ error: "Unknown room." });
    return;
  }
  const roomId = req.params.id;
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
app.post("/rooms/:roomId/players/:playerId/start", (req, res) => {
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
  const outcome = maybeStartSession(req.params.roomId);
  if (outcome.started) {
    res.status(200).json({ ok: true, started: true });
    return;
  }
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
function maybeStartSession(roomId: string): { started: boolean; reason?: string } {
  if (!characterService.canStart(roomId)) return { started: false, reason: "NOT_ALL_CONFIRMED" };
  // Already started (this call or a prior one) — treat as success/idempotent.
  if (startedRooms.has(roomId)) return { started: true };
  const room = persistence.roomStore.getRoom(roomId);
  if (room === undefined) return { started: false, reason: "UNKNOWN_ROOM" };
  if (room.state !== "lobby") {
    // An already-running session counts as started; anything else (ended) cannot start.
    return room.state === "in_session"
      ? { started: true }
      : { started: false, reason: "NOT_LOBBY" };
  }
  // Bound AI cost with the same global slot cap as /play/new.
  if (!sessionSlots.tryAcquire()) return { started: false, reason: "AT_CAPACITY" };
  startedRooms.add(roomId);
  // Persist the lifecycle transition so the room reflects the started session
  // and further joins are refused (mirrors /play/new seeding state first).
  persistence.roomStore.saveRoom({ ...room, state: "in_session" });
  // Kick the engine: generate + deliver the opening narration and start the
  // round loop (the gateway streams Turn_State + narration to the game sockets).
  void orchestrator.dispatch(roomId, { type: "START_SESSION", by: room.hostPlayerId });
  // Tell every lobby socket the session is active so any client still on the
  // lobby (rather than the character screen) hands off to the game screen.
  broadcastToRoom(roomId, { type: "turn_state", state: { roundNumber: 1, roomState: "in_session" } });
  return { started: true };
}

const wss = new WebSocketServer({ noServer: true }); // game / solo play socket
const lobbyWss = new WebSocketServer({ noServer: true }); // lobby waiting-room socket
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

  // Shared-secret gate on the WebSocket entry point too (no-op when unset).
  const headerToken = request.headers["x-playtest-token"];
  if (!tokenMatches(TOKEN, tokenFromRequest(headerToken, params.get("token")))) {
    socket.close(1008, "unauthorized");
    return;
  }

  // Identity from a ticket (#2) or, for lobby-created rooms, from the room store.
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

  // Map inbound client messages to orchestrator commands.
  socket.on("message", (raw: unknown) => {
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
        ...(typeof msg.text === "string" ? { text: msg.text } : {}),
        ...(typeof msg.action === "string" ? { action: msg.action } : {}),
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
  const headerToken = request.headers["x-playtest-token"];
  if (!tokenMatches(TOKEN, tokenFromRequest(headerToken, params.get("token")))) {
    socket.close(1008, "unauthorized");
    return;
  }
  const roomId = params.get("roomId");
  const room = roomId !== null ? persistence.roomStore.getRoom(roomId) : undefined;
  if (room === undefined) {
    socket.close(1008, "unknown-room");
    return;
  }

  // The connecting viewer identity: an explicit `playerId` query param (a joined
  // player arriving with their own identity), else the host (back-compat for a
  // host arriving without an explicit playerId).
  const queryPlayerId = params.get("playerId");
  const viewerId = queryPlayerId !== null && queryPlayerId.length > 0
    ? queryPlayerId
    : room.hostPlayerId;

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
      const picked =
        typeof msg.scenarioId === "string"
          ? persistence.scenarioStore.getScenario(msg.scenarioId)
          : undefined;
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
  msg: { type?: string; text?: string; action?: string },
): OrchestratorCommand | null {
  switch (msg.type) {
    case "chat":
      return typeof msg.text === "string" && msg.text.trim().length > 0
        ? { type: "SEND_CHAT", from: playerId, text: msg.text }
        : null;
    case "confirm":
      return typeof msg.action === "string" && msg.action.trim().length > 0
        ? { type: "CONFIRM_ACTION", from: playerId, action: msg.action }
        : null;
    case "pass":
      return { type: "PASS", from: playerId };
    case "revise":
      return { type: "REVISE", from: playerId, action: msg.action ?? null };
    default:
      return null;
  }
}

server.listen(PORT, HOST, () => {
  process.stdout.write(`\nTRPG playtest server: http://${HOST}:${PORT}\n`);
});
