import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { RoomService } from "./room-service.js";
import { InMemoryRoomStore } from "./room-store.js";
import { isRoomUnavailable, type RoomState } from "./types.js";

/**
 * Property-based tests for the Room Service.
 * Feature: trpg-session-engine
 */

describe("Room Service — property tests", () => {
  it("Property 1: Unique room identity and host designation", () => {
    // Feature: trpg-session-engine, Property 1: Unique room identity and host designation
    fc.assert(
      fc.property(fc.array(fc.string(), { minLength: 1, maxLength: 30 }), (names) => {
        const store = new InMemoryRoomStore();
        const svc = new RoomService({ store });
        const ids = new Set<string>();
        const tokens = new Set<string>();
        for (const name of names) {
          const room = svc.createRoom({ displayName: name });
          expect(ids.has(room.id)).toBe(false);
          expect(tokens.has(room.inviteToken)).toBe(false);
          ids.add(room.id);
          tokens.add(room.inviteToken);
          const host = store.getPlayer(room.hostPlayerId);
          expect(host?.isHost).toBe(true);
          expect(host?.roomId).toBe(room.id);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("Property 2: Invite link round-trip", () => {
    // Feature: trpg-session-engine, Property 2: Invite link round-trip
    fc.assert(
      fc.property(fc.string(), (name) => {
        const svc = new RoomService();
        const room = svc.createRoom({ displayName: name });
        expect(svc.getInviteLink(room.id).endsWith(room.inviteToken)).toBe(true);
        const resolved = svc.resolveInvite(room.inviteToken);
        expect(isRoomUnavailable(resolved)).toBe(false);
        if (!isRoomUnavailable(resolved)) expect(resolved.id).toBe(room.id);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 3: Room capacity is never exceeded", () => {
    // Feature: trpg-session-engine, Property 3: Room capacity is never exceeded
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 12 }), (names) => {
        const store = new InMemoryRoomStore();
        const svc = new RoomService({ store });
        const room = svc.createRoom({ displayName: "host" });
        for (const name of names) {
          const before = store.listPlayers(room.id).length;
          const res = svc.joinRoom(room.inviteToken, { displayName: name || "p" });
          const after = store.listPlayers(room.id).length;
          expect(after).toBeLessThanOrEqual(room.maxPlayers);
          if (before >= room.maxPlayers) {
            expect(res.ok).toBe(false);
            if (!res.ok) expect(res.reason).toBe("ROOM_FULL");
            // A rejected join leaves the room unchanged.
            expect(after).toBe(before);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("Property 4: Joins allowed only before session start", () => {
    // Feature: trpg-session-engine, Property 4: Joins allowed only before session start
    fc.assert(
      fc.property(fc.constantFrom<RoomState>("lobby", "in_session", "ended"), fc.string(), (state, name) => {
        const store = new InMemoryRoomStore();
        const svc = new RoomService({ store });
        const room = svc.createRoom({ displayName: "host" });
        store.saveRoom({ ...room, state });
        const before = store.listPlayers(room.id).length;
        const belowCapacity = before < room.maxPlayers;
        const res = svc.joinRoom(room.inviteToken, { displayName: name || "p" });
        // A join is admitted iff the room is in lobby and below capacity.
        expect(res.ok).toBe(state === "lobby" && belowCapacity);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 5: Display names are unique within a room", () => {
    // Feature: trpg-session-engine, Property 5: Display names are unique within a room
    fc.assert(
      fc.property(fc.array(fc.string(), { minLength: 1, maxLength: 5 }), (names) => {
        const store = new InMemoryRoomStore();
        const svc = new RoomService({ store });
        const room = svc.createRoom({ displayName: "host" });
        for (const name of names) {
          svc.joinRoom(room.inviteToken, { displayName: name });
        }
        const assigned = store.listPlayers(room.id).map((p) => p.displayName.trim().toLowerCase());
        // No two players in the room share a (normalized) display name.
        expect(new Set(assigned).size).toBe(assigned.length);
      }),
      { numRuns: 100 },
    );
  });
});
