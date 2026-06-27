import { describe, it, expect } from "vitest";
import {
  RoomService,
  DEFAULT_INVITE_BASE_URL,
  ROOM_UNAVAILABLE_MESSAGE,
  ROOM_FULL_MESSAGE,
} from "./room-service.js";
import { InMemoryRoomStore } from "./room-store.js";
import { isRoomUnavailable } from "./types.js";

describe("RoomService.createRoom", () => {
  it("creates a room and designates the requester as host (R1.1)", () => {
    const service = new RoomService();
    const room = service.createRoom({ displayName: "Aria" });

    expect(room.id).toBeTruthy();
    expect(room.state).toBe("lobby");
    expect(room.scenarioId).toBeNull();
    expect(room.hostPlayerId).toBeTruthy();
    // createdAt is a valid ISO timestamp.
    expect(Number.isNaN(Date.parse(room.createdAt))).toBe(false);
  });

  it("generates a unique room id and invite token per room (R1.1, R1.2)", () => {
    const service = new RoomService();
    const a = service.createRoom({ displayName: "Aria" });
    const b = service.createRoom({ displayName: "Borin" });

    expect(a.id).not.toBe(b.id);
    expect(a.inviteToken).not.toBe(b.inviteToken);
  });

  it("produces an unguessable, high-entropy invite token (R1.2)", () => {
    const service = new RoomService();
    const room = service.createRoom({ displayName: "Aria" });

    // Default token is 24 random bytes base64url-encoded (32 chars, URL-safe).
    expect(room.inviteToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("uses the configured max players capacity (R1.4)", () => {
    const service = new RoomService();
    const room = service.createRoom({ displayName: "Aria" });
    expect(room.maxPlayers).toBe(6);
  });
});

describe("RoomService.getInviteLink", () => {
  it("returns the invite link for an existing room (R1.3)", () => {
    const service = new RoomService();
    const room = service.createRoom({ displayName: "Aria" });

    const link = service.getInviteLink(room.id);
    expect(link).toBe(`${DEFAULT_INVITE_BASE_URL}${room.inviteToken}`);
  });

  it("honors a custom invite base URL", () => {
    const service = new RoomService({ inviteBaseUrl: "https://example.test/join/" });
    const room = service.createRoom({ displayName: "Aria" });

    expect(service.getInviteLink(room.id)).toBe(
      `https://example.test/join/${room.inviteToken}`,
    );
  });

  it("throws for an unknown room id", () => {
    const service = new RoomService();
    expect(() => service.getInviteLink("does-not-exist")).toThrow();
  });
});

describe("RoomService.resolveInvite", () => {
  it("maps a valid token 1:1 back to its room (R2.1)", () => {
    const service = new RoomService();
    const room = service.createRoom({ displayName: "Aria" });

    const resolved = service.resolveInvite(room.inviteToken);
    expect(isRoomUnavailable(resolved)).toBe(false);
    if (!isRoomUnavailable(resolved)) {
      expect(resolved.id).toBe(room.id);
    }
  });

  it("returns a 'Room unavailable' result for an invalid token (R2.2)", () => {
    const service = new RoomService();
    const resolved = service.resolveInvite("not-a-real-token");

    expect(isRoomUnavailable(resolved)).toBe(true);
    if (isRoomUnavailable(resolved)) {
      expect(resolved.reason).toBe("ROOM_UNAVAILABLE");
      expect(resolved.message).toBe(ROOM_UNAVAILABLE_MESSAGE);
    }
  });

  it("round-trips: getInviteLink token resolves to the same room (R1.3, R2.1)", () => {
    const service = new RoomService();
    const room = service.createRoom({ displayName: "Aria" });

    const link = service.getInviteLink(room.id);
    const token = link.slice(DEFAULT_INVITE_BASE_URL.length);
    const resolved = service.resolveInvite(token);

    expect(isRoomUnavailable(resolved)).toBe(false);
    if (!isRoomUnavailable(resolved)) {
      expect(resolved.id).toBe(room.id);
    }
  });
});

describe("RoomService.joinRoom", () => {
  it("adds a player to the room for a valid token (R2.1)", () => {
    const service = new RoomService();
    const room = service.createRoom({ displayName: "Aria" });

    const result = service.joinRoom(room.inviteToken, { displayName: "Borin" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.room.id).toBe(room.id);
      expect(result.player.roomId).toBe(room.id);
      expect(result.player.isHost).toBe(false);
      expect(result.assignedName).toBe("Borin");
    }
  });

  it("returns ROOM_UNAVAILABLE for an unknown token (R2.2)", () => {
    const service = new RoomService();
    const result = service.joinRoom("not-a-real-token", { displayName: "Borin" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("ROOM_UNAVAILABLE");
      expect(result.message).toBe(ROOM_UNAVAILABLE_MESSAGE);
    }
  });

  it("rejects joins once the room has left the lobby (R1.5)", () => {
    // Use a deterministic store so we can flip the room out of `lobby`.
    const store = new InMemoryRoomStore();
    const service = new RoomService({ store });
    const room = service.createRoom({ displayName: "Aria" });

    store.saveRoom({ ...room, state: "in_session" });

    const result = service.joinRoom(room.inviteToken, { displayName: "Borin" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("ROOM_UNAVAILABLE");
    }
  });

  it("checks capacity before adding and rejects a 7th player with ROOM_FULL (R1.4, R2.3, R2.4)", () => {
    const store = new InMemoryRoomStore();
    const service = new RoomService({ store });
    const room = service.createRoom({ displayName: "Host" });

    // Host counts as player 1; fill the remaining 5 seats (total 6).
    for (let i = 0; i < 5; i += 1) {
      const r = service.joinRoom(room.inviteToken, { displayName: `P${i}` });
      expect(r.ok).toBe(true);
    }
    expect(store.listPlayers(room.id)).toHaveLength(6);

    const overflow = service.joinRoom(room.inviteToken, { displayName: "Late" });
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) {
      expect(overflow.reason).toBe("ROOM_FULL");
      expect(overflow.message).toBe(ROOM_FULL_MESSAGE);
    }
    // The full room is left unchanged: still exactly 6 players (R2.3, R2.4).
    expect(store.listPlayers(room.id)).toHaveLength(6);
  });

  it("assigns a display name unique within the room on collision (R2.6)", () => {
    const store = new InMemoryRoomStore();
    const service = new RoomService({ store });
    const room = service.createRoom({ displayName: "Aria" });

    const first = service.joinRoom(room.inviteToken, { displayName: "Aria" });
    const second = service.joinRoom(room.inviteToken, { displayName: "Aria" });

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.assignedName).toBe("Aria (2)");
      expect(second.assignedName).toBe("Aria (3)");
    }

    const names = store.listPlayers(room.id).map((p) => p.displayName);
    expect(new Set(names).size).toBe(names.length);
  });
});
