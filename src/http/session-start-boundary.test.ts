import { describe, expect, it, vi } from "vitest";
import {
  isStartFailureHttpError,
  startMultiplayerSession,
  type SessionStartRoomStore,
} from "./session-start-boundary.js";
import type { Room } from "../services/types.js";

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: "room-1",
    inviteToken: "invite-1",
    hostPlayerId: "host-1",
    scenarioId: "scenario-1",
    state: "lobby",
    maxPlayers: 6,
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRoomStore(room: Room): SessionStartRoomStore & { current(): Room } {
  let current = room;
  return {
    getRoom(roomId) {
      return current.id === roomId ? current : undefined;
    },
    saveRoom(next) {
      current = next;
    },
    current() {
      return current;
    },
  };
}

describe("startMultiplayerSession", () => {
  it("rolls back room state, started guard, and session slot on START_SESSION rejection", async () => {
    const store = makeRoomStore(makeRoom());
    const startedRooms = new Set<string>();
    const release = vi.fn();
    const broadcastToRoom = vi.fn();

    const outcome = await startMultiplayerSession({
      roomId: "room-1",
      characterGate: { canStart: () => true },
      roomStore: store,
      startedRooms,
      aiGuard: { acquire: () => ({ ok: true, release }) },
      orchestrator: {
        dispatch: vi.fn(async () => {
          throw new Error("model unavailable");
        }),
      },
      broadcastToRoom,
    });

    expect(outcome).toEqual({ started: false, reason: "START_FAILED" });
    expect(isStartFailureHttpError(outcome)).toBe(true);
    expect(store.current().state).toBe("lobby");
    expect(startedRooms.has("room-1")).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
    expect(broadcastToRoom).not.toHaveBeenCalled();
  });

  it("keeps the room in session and broadcasts only after dispatch succeeds", async () => {
    const store = makeRoomStore(makeRoom());
    const startedRooms = new Set<string>();
    const release = vi.fn();
    const broadcastToRoom = vi.fn();

    const outcome = await startMultiplayerSession({
      roomId: "room-1",
      characterGate: { canStart: () => true },
      roomStore: store,
      startedRooms,
      aiGuard: { acquire: () => ({ ok: true, release }) },
      orchestrator: { dispatch: vi.fn(async () => undefined) },
      broadcastToRoom,
    });

    expect(outcome).toEqual({ started: true });
    expect(isStartFailureHttpError(outcome)).toBe(false);
    expect(store.current().state).toBe("in_session");
    expect(startedRooms.has("room-1")).toBe(true);
    expect(release).not.toHaveBeenCalled();
    expect(broadcastToRoom).toHaveBeenCalledWith("room-1", {
      type: "turn_state",
      state: { roundNumber: 1, roomState: "in_session" },
    });
  });
});
