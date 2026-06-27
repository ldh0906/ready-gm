/**
 * Non-realtime REST surface for the entry flows (room creation, invite
 * resolution, scenario listing, end-of-session summary). All in-session
 * interactions use the Realtime_Channel rather than REST.
 *
 * Endpoints (design.md "HTTP/REST Surface"):
 * - `POST   /rooms`            create a room, return id + invite token/link (R1.1, R1.2)
 * - `GET    /rooms/:token`     resolve an invite token to room info (R2.1, R2.2)
 * - `GET    /rooms/:id/invite` fetch the invite link for a room (R1.3)
 * - `GET    /scenarios`        list the available scenarios (R3.1)
 * - `GET    /rooms/:id/summary` fetch the persisted Session_Summary (R15.3)
 *
 * SECURITY NOTE (MVP): these endpoints are intentionally UNAUTHENTICATED for the
 * MVP. There is no caller identity, host verification, or access control — any
 * client that can reach the server can create rooms, read room info by token,
 * and read summaries by room id. Authentication and authorization (e.g. host
 * session tokens, rate limiting, and per-room access checks) MUST be added
 * before this surface is exposed in production.
 *
 * Handlers are factored as plain `(req, res)` functions over narrow request/
 * response ports so they can be unit-tested directly without a running HTTP
 * server, and are also mounted on an Express app via {@link createApp}.
 *
 * Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 15.3
 */
import express from "express";
import type { RoomService } from "../services/room-service.js";
import type { ScenarioService } from "../services/scenario-service.js";
import { isRoomUnavailable } from "../services/types.js";
import type { SummaryReader } from "./summary-reader.js";

/** Message body returned for an invalid/unknown invite token (Requirement 2.2). */
export const ROOM_UNAVAILABLE_ERROR = "Room unavailable";

/** Message body returned when an invite link is requested for an unknown room. */
export const ROOM_NOT_FOUND_ERROR = "Room not found";

/** Message body returned when no Session_Summary exists for a room yet. */
export const SUMMARY_NOT_FOUND_ERROR = "Summary unavailable";

/** Message body returned when a room creation request is missing a display name. */
export const INVALID_DISPLAY_NAME_ERROR = "A non-empty display name is required";

/** Collaborators the REST surface is built over. */
export interface HttpDependencies {
  roomService: RoomService;
  scenarioService: ScenarioService;
  summaryReader: SummaryReader;
}

/**
 * Minimal request port the handlers depend on. Express's `Request` structurally
 * satisfies this (it has `params` and `body`), so handlers mount directly while
 * staying trivially unit-testable with plain fakes.
 */
export interface HandlerRequest {
  params: Record<string, string>;
  body: unknown;
}

/** Minimal chainable response port; Express's `Response` structurally satisfies it. */
export interface HandlerResponse {
  status(code: number): HandlerResponse;
  json(body: unknown): HandlerResponse;
}

/** A REST handler over the narrow ports above. */
export type Handler = (req: HandlerRequest, res: HandlerResponse) => void;

/** The set of handlers backing the REST surface, one per route. */
export interface RoomHttpHandlers {
  createRoom: Handler;
  resolveInvite: Handler;
  getInviteLink: Handler;
  listScenarios: Handler;
  getSummary: Handler;
}

/** Extract a trimmed `displayName` string from an unknown request body. */
function readDisplayName(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const value = (body as { displayName?: unknown }).displayName;
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Build the REST handlers over the given dependencies. Exposed separately from
 * {@link createApp} so each handler can be exercised directly in unit tests.
 */
export function createRoomHttpHandlers(deps: HttpDependencies): RoomHttpHandlers {
  const { roomService, scenarioService, summaryReader } = deps;

  return {
    /** `POST /rooms` — create a room and designate the caller as host (R1.1, R1.2). */
    createRoom(req, res) {
      const displayName = readDisplayName(req.body);
      if (displayName === undefined) {
        res.status(400).json({ error: INVALID_DISPLAY_NAME_ERROR });
        return;
      }
      const room = roomService.createRoom({ displayName });
      res.status(201).json({
        roomId: room.id,
        inviteToken: room.inviteToken,
        inviteLink: roomService.getInviteLink(room.id),
        hostPlayerId: room.hostPlayerId,
        state: room.state,
        maxPlayers: room.maxPlayers,
      });
    },

    /** `GET /rooms/:token` — resolve an invite token to room info (R2.1, R2.2). */
    resolveInvite(req, res) {
      const result = roomService.resolveInvite(req.params.token);
      if (isRoomUnavailable(result)) {
        res.status(404).json({ error: ROOM_UNAVAILABLE_ERROR, message: result.message });
        return;
      }
      res.status(200).json({
        roomId: result.id,
        state: result.state,
        maxPlayers: result.maxPlayers,
        scenarioId: result.scenarioId,
      });
    },

    /** `GET /rooms/:id/invite` — return the invite link for a room (R1.3). */
    getInviteLink(req, res) {
      try {
        const inviteLink = roomService.getInviteLink(req.params.id);
        res.status(200).json({ inviteLink });
      } catch {
        // getInviteLink throws for an unknown room id.
        res.status(404).json({ error: ROOM_NOT_FOUND_ERROR });
      }
    },

    /** `GET /scenarios` — list the available scenarios for the MVP (R3.1). */
    listScenarios(_req, res) {
      res.status(200).json({ scenarios: scenarioService.listScenarios() });
    },

    /** `GET /rooms/:id/summary` — return the persisted Session_Summary (R15.3). */
    getSummary(req, res) {
      const summary = summaryReader.getSummary(req.params.id);
      if (summary === undefined) {
        res.status(404).json({ error: SUMMARY_NOT_FOUND_ERROR });
        return;
      }
      res.status(200).json(summary);
    },
  };
}

/**
 * Build the configured Express application exposing the non-realtime REST
 * surface over the Room Service, Scenario service, and summary reader.
 *
 * NOTE: unauthenticated for the MVP — see the security note at the top of this
 * file. Add authentication/authorization before production use.
 */
export function createApp(deps: HttpDependencies): express.Express {
  const app = express();
  app.use(express.json());

  const handlers = createRoomHttpHandlers(deps);

  app.post("/rooms", (req, res) => handlers.createRoom(req, res));
  app.get("/scenarios", (req, res) => handlers.listScenarios(req, res));
  app.get("/rooms/:id/invite", (req, res) => handlers.getInviteLink(req, res));
  app.get("/rooms/:id/summary", (req, res) => handlers.getSummary(req, res));
  // Registered last: a single path segment after /rooms is treated as a token.
  app.get("/rooms/:token", (req, res) => handlers.resolveInvite(req, res));

  return app;
}
