import { describe, it, expect } from "vitest";
import {
  ConnectionTicketStore,
  authorizeConnection,
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
