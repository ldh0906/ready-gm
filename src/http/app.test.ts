import { describe, it, expect } from "vitest";
import {
  createRoomHttpHandlers,
  createApp,
  ROOM_UNAVAILABLE_ERROR,
  ROOM_NOT_FOUND_ERROR,
  SUMMARY_NOT_FOUND_ERROR,
  INVALID_DISPLAY_NAME_ERROR,
  type HandlerRequest,
  type HandlerResponse,
  type HttpDependencies,
} from "./app.js";
import { InMemorySummaryReader, type SessionSummaryView } from "./summary-reader.js";
import { RoomService } from "../services/room-service.js";
import { ScenarioService } from "../services/scenario-service.js";

/** Records the status/body a handler writes for assertions. */
interface CapturedResponse extends HandlerResponse {
  statusCode: number | undefined;
  body: unknown;
}

/** A fake chainable response capturing the final status and JSON body. */
function fakeResponse(): CapturedResponse {
  const res: CapturedResponse = {
    statusCode: undefined,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

/** Build a request with the given params/body. */
function fakeRequest(params: Record<string, string> = {}, body: unknown = undefined): HandlerRequest {
  return { params, body };
}

/** Assemble handlers over fresh in-memory services for each test. */
function setup(initialSummaries: readonly SessionSummaryView[] = []): {
  handlers: ReturnType<typeof createRoomHttpHandlers>;
  deps: HttpDependencies;
  summaryReader: InMemorySummaryReader;
} {
  const summaryReader = new InMemorySummaryReader(initialSummaries);
  const deps: HttpDependencies = {
    roomService: new RoomService(),
    scenarioService: new ScenarioService(),
    summaryReader,
  };
  return { handlers: createRoomHttpHandlers(deps), deps, summaryReader };
}

describe("POST /rooms", () => {
  it("creates a room and returns 201 with id + invite token/link (R1.1, R1.2)", () => {
    const { handlers } = setup();
    const res = fakeResponse();

    handlers.createRoom(fakeRequest({}, { displayName: "Aria" }), res);

    expect(res.statusCode).toBe(201);
    const body = res.body as { roomId: string; inviteToken: string; inviteLink: string };
    expect(body.roomId).toBeTruthy();
    expect(body.inviteToken).toBeTruthy();
    expect(body.inviteLink).toContain(body.inviteToken);
  });

  it("rejects a missing or blank display name with 400 (input validation)", () => {
    const { handlers } = setup();

    const missing = fakeResponse();
    handlers.createRoom(fakeRequest({}, {}), missing);
    expect(missing.statusCode).toBe(400);
    expect((missing.body as { error: string }).error).toBe(INVALID_DISPLAY_NAME_ERROR);

    const blank = fakeResponse();
    handlers.createRoom(fakeRequest({}, { displayName: "   " }), blank);
    expect(blank.statusCode).toBe(400);
  });
});

describe("GET /rooms/:token", () => {
  it("resolves a valid token to room info with 200 (R2.1)", () => {
    const { handlers, deps } = setup();
    const room = deps.roomService.createRoom({ displayName: "Aria" });

    const res = fakeResponse();
    handlers.resolveInvite(fakeRequest({ token: room.inviteToken }), res);

    expect(res.statusCode).toBe(200);
    expect((res.body as { roomId: string }).roomId).toBe(room.id);
  });

  it("returns 404 'Room unavailable' for an invalid token (R2.2)", () => {
    const { handlers } = setup();
    const res = fakeResponse();

    handlers.resolveInvite(fakeRequest({ token: "not-a-real-token" }), res);

    expect(res.statusCode).toBe(404);
    expect((res.body as { error: string }).error).toBe(ROOM_UNAVAILABLE_ERROR);
  });
});

describe("GET /rooms/:id/invite", () => {
  it("returns the invite link for an existing room with 200 (R1.3)", () => {
    const { handlers, deps } = setup();
    const room = deps.roomService.createRoom({ displayName: "Aria" });

    const res = fakeResponse();
    handlers.getInviteLink(fakeRequest({ id: room.id }), res);

    expect(res.statusCode).toBe(200);
    expect((res.body as { inviteLink: string }).inviteLink).toContain(room.inviteToken);
  });

  it("returns 404 for an unknown room id", () => {
    const { handlers } = setup();
    const res = fakeResponse();

    handlers.getInviteLink(fakeRequest({ id: "does-not-exist" }), res);

    expect(res.statusCode).toBe(404);
    expect((res.body as { error: string }).error).toBe(ROOM_NOT_FOUND_ERROR);
  });
});

describe("GET /scenarios", () => {
  it("lists the available scenarios with 200 (R3.1)", () => {
    const { handlers } = setup();
    const res = fakeResponse();

    handlers.listScenarios(fakeRequest(), res);

    expect(res.statusCode).toBe(200);
    const body = res.body as { scenarios: Array<{ id: string }> };
    expect(body.scenarios.length).toBeGreaterThanOrEqual(1);
    expect(body.scenarios[0].id).toBe("the-sunless-crypt");
  });
});

describe("GET /rooms/:id/summary", () => {
  const summary: SessionSummaryView = {
    roomId: "room-1",
    closingNarration: "막을 내립니다.",
    summaryText: "용감한 모험가들이 아이들을 구했다.",
    createdAt: new Date("2024-01-01T00:00:00.000Z").toISOString(),
  };

  it("returns the persisted summary with 200 when present (R15.3)", () => {
    const { handlers } = setup([summary]);
    const res = fakeResponse();

    handlers.getSummary(fakeRequest({ id: "room-1" }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(summary);
  });

  it("returns 404 when no summary exists for the room", () => {
    const { handlers } = setup([summary]);
    const res = fakeResponse();

    handlers.getSummary(fakeRequest({ id: "no-such-room" }), res);

    expect(res.statusCode).toBe(404);
    expect((res.body as { error: string }).error).toBe(SUMMARY_NOT_FOUND_ERROR);
  });
});

describe("createApp", () => {
  it("builds a configured Express app exposing the REST routes", () => {
    const app = createApp({
      roomService: new RoomService(),
      scenarioService: new ScenarioService(),
      summaryReader: new InMemorySummaryReader(),
    });

    // The returned value is an Express app: callable as a request handler and
    // exposing the routing methods used to mount the surface.
    expect(typeof app).toBe("function");
    expect(typeof app.get).toBe("function");
    expect(typeof app.post).toBe("function");
  });
});
