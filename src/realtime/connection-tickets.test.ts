import { describe, it, expect } from "vitest";
import {
  ConnectionTicketStore,
  authorizeRoomHost,
  authorizeRoomMember,
  authorizeConnection,
  type RoomAccessReader,
  type RoomMembershipReader,
} from "./connection-tickets.js";

/** A fake membership reader backed by a simple player→room map. */
function members(map: Record<string, string>): RoomMembershipReader {
  return {
    getPlayer(playerId) {
      const roomId = map[playerId];
      return roomId === undefined ? undefined : { roomId };
    },
  };
}

function roomAccess(
  playerRooms: Record<string, string>,
  roomHosts: Record<string, string>,
): RoomAccessReader {
  return {
    getPlayer(playerId) {
      const roomId = playerRooms[playerId];
      return roomId === undefined ? undefined : { roomId };
    },
    getRoom(roomId) {
      const hostPlayerId = roomHosts[roomId];
      return hostPlayerId === undefined ? undefined : { id: roomId, hostPlayerId };
    },
  };
}

describe("ConnectionTicketStore", () => {
  it("issues a token that resolves back to the issued identity", () => {
    const store = new ConnectionTicketStore();
    const token = store.issue({ roomId: "room-1", playerId: "p1" });

    expect(token).toBeTruthy();
    expect(store.resolve(token)).toEqual({ roomId: "room-1", playerId: "p1" });
  });

  it("issues distinct tokens for distinct identities", () => {
    const store = new ConnectionTicketStore();
    const a = store.issue({ roomId: "room-1", playerId: "p1" });
    const b = store.issue({ roomId: "room-2", playerId: "p2" });
    expect(a).not.toBe(b);
    expect(store.size).toBe(2);
  });

  it("returns undefined for unknown, blank, or null tokens", () => {
    const store = new ConnectionTicketStore();
    expect(store.resolve("nope")).toBeUndefined();
    expect(store.resolve("")).toBeUndefined();
    expect(store.resolve(null)).toBeUndefined();
    expect(store.resolve(undefined)).toBeUndefined();
  });

  it("revokes a ticket so it no longer resolves", () => {
    const store = new ConnectionTicketStore({ generateToken: () => "fixed" });
    const token = store.issue({ roomId: "room-1", playerId: "p1" });
    store.revoke(token);
    expect(store.resolve(token)).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it("expires tickets after their TTL", () => {
    let now = 1000;
    const store = new ConnectionTicketStore({
      generateToken: () => "fixed",
      now: () => now,
      ttlMs: 500,
    });
    const token = store.issue({ roomId: "room-1", playerId: "p1" });

    expect(store.resolve(token)).toEqual({ roomId: "room-1", playerId: "p1" });
    now = 1499;
    expect(store.resolve(token)).toEqual({ roomId: "room-1", playerId: "p1" });
    now = 1500;
    expect(store.resolve(token)).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it("reissuing a player ticket revokes that player's older ticket", () => {
    let next = 0;
    const store = new ConnectionTicketStore({ generateToken: () => `ticket-${++next}` });
    const first = store.issue({ roomId: "room-1", playerId: "p1" });
    const second = store.issue({ roomId: "room-1", playerId: "p1" });

    expect(first).not.toBe(second);
    expect(store.resolve(first)).toBeUndefined();
    expect(store.resolve(second)).toEqual({ roomId: "room-1", playerId: "p1" });
    expect(store.size).toBe(1);
  });
});

describe("authorizeConnection", () => {
  it("authorizes a valid ticket for a player that belongs to the room", () => {
    const tickets = new ConnectionTicketStore();
    const token = tickets.issue({ roomId: "room-1", playerId: "p1" });

    const result = authorizeConnection(tickets, members({ p1: "room-1" }), token);

    expect(result).toEqual({ ok: true, identity: { roomId: "room-1", playerId: "p1" } });
  });

  it("rejects a missing or unknown ticket", () => {
    const tickets = new ConnectionTicketStore();
    const reader = members({ p1: "room-1" });

    expect(authorizeConnection(tickets, reader, null).ok).toBe(false);
    expect(authorizeConnection(tickets, reader, "forged-token").ok).toBe(false);
  });

  it("rejects a ticket whose player is no longer a member of the room", () => {
    const tickets = new ConnectionTicketStore();
    const token = tickets.issue({ roomId: "room-1", playerId: "p1" });

    // Player not in any room.
    expect(authorizeConnection(tickets, members({}), token).ok).toBe(false);
    // Player now belongs to a different room than the ticket claims.
    expect(authorizeConnection(tickets, members({ p1: "room-2" }), token).ok).toBe(false);
  });

  it("derives identity from the ticket, not from caller input", () => {
    // Even though the membership reader knows p1, a caller without p1's ticket
    // cannot authenticate as p1 — only the issued token grants the identity.
    const tickets = new ConnectionTicketStore();
    const victimToken = tickets.issue({ roomId: "room-1", playerId: "victim" });
    const attackerToken = tickets.issue({ roomId: "room-1", playerId: "attacker" });

    const result = authorizeConnection(
      tickets,
      members({ victim: "room-1", attacker: "room-1" }),
      attackerToken,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.identity.playerId).toBe("attacker");
    // The attacker's token never resolves to the victim's identity.
    expect(tickets.resolve(attackerToken)?.playerId).not.toBe("victim");
    expect(victimToken).not.toBe(attackerToken);
  });
});

describe("authorizeRoomMember", () => {
  it("authorizes a ticket only for its own room", () => {
    const tickets = new ConnectionTicketStore();
    const token = tickets.issue({ roomId: "room-1", playerId: "p1" });

    expect(authorizeRoomMember(tickets, members({ p1: "room-1" }), token, "room-1")).toEqual({
      ok: true,
      identity: { roomId: "room-1", playerId: "p1" },
    });
    expect(authorizeRoomMember(tickets, members({ p1: "room-1" }), token, "room-2")).toEqual({
      ok: false,
      reason: "identity_mismatch",
    });
  });

  it("rejects missing tickets before any room-specific read is allowed", () => {
    expect(authorizeRoomMember(new ConnectionTicketStore(), members({ p1: "room-1" }), "", "room-1")).toEqual({
      ok: false,
      reason: "no_ticket",
    });
  });
});

describe("authorizeRoomHost", () => {
  it("requires a host ticket for host-only room reads", () => {
    let n = 0;
    const tickets = new ConnectionTicketStore({ generateToken: () => `t-${++n}` });
    const hostToken = tickets.issue({ roomId: "room-1", playerId: "host" });
    const guestToken = tickets.issue({ roomId: "room-1", playerId: "guest" });
    const reader = roomAccess({ host: "room-1", guest: "room-1" }, { "room-1": "host" });

    expect(authorizeRoomHost(tickets, reader, hostToken, "room-1")).toEqual({
      ok: true,
      identity: { roomId: "room-1", playerId: "host" },
    });
    expect(authorizeRoomHost(tickets, reader, guestToken, "room-1")).toEqual({
      ok: false,
      reason: "not_host",
    });
  });

  it("returns unknown_room when the target room no longer exists", () => {
    const tickets = new ConnectionTicketStore({ generateToken: () => "t-1" });
    const token = tickets.issue({ roomId: "room-1", playerId: "host" });

    expect(authorizeRoomHost(tickets, roomAccess({ host: "room-1" }, {}), token, "room-1")).toEqual({
      ok: false,
      reason: "unknown_room",
    });
  });
});
