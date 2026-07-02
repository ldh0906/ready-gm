/**
 * Connection tickets — server-issued, unguessable handles that authenticate a
 * WebSocket as a specific `(roomId, playerId)` without trusting client-supplied
 * identity.
 *
 * The playtest entry flow (`POST /play/new`) seeds a room + player and issues a
 * ticket for that player. The browser presents the ticket on the `/ws` upgrade,
 * and the server derives the room/player identity FROM THE TICKET rather than
 * from query params. This closes the impersonation/eavesdrop hole where anyone
 * who learned a room/player UUID pair could connect as that player: a caller
 * with no ticket (or another player's ticket) cannot act as, or receive the
 * fan-out for, a player they were not issued.
 *
 * Tickets carry high entropy (24 random bytes, base64url) — the same convention
 * the invite tokens use — so they are not enumerable. The store is in-memory
 * (single-process playtest scope); tickets are short-lived, can be explicitly
 * revoked, and reissuing a player ticket invalidates that player's older ticket.
 */
import { randomBytes } from "node:crypto";

/** The room/player a ticket authenticates. */
export interface ConnectionIdentity {
  readonly roomId: string;
  readonly playerId: string;
}

/** Options for {@link ConnectionTicketStore} (injectable generator for tests). */
export interface ConnectionTicketStoreOptions {
  /** Token generator; defaults to 24 random bytes as base64url. */
  generateToken?: () => string;
  /** Clock for tests; defaults to `Date.now`. */
  now?: () => number;
  /** Ticket TTL in milliseconds. Defaults to {@link DEFAULT_CONNECTION_TICKET_TTL_MS}. */
  ttlMs?: number;
  /** Whether issuing a new ticket for the same room/player revokes the old one. */
  rotatePerPlayer?: boolean;
}

/** Default connection-ticket lifetime: enough for playtests, not process-long. */
export const DEFAULT_CONNECTION_TICKET_TTL_MS = 2 * 60 * 60_000;

interface TicketRecord {
  readonly identity: ConnectionIdentity;
  readonly expiresAt: number;
}

/**
 * An in-memory issuer/resolver of connection tickets. One instance backs the
 * playtest server; `issue` is called per session start and `resolve` per `/ws`
 * upgrade.
 */
export class ConnectionTicketStore {
  private readonly tickets = new Map<string, TicketRecord>();
  /**
   * Reverse index from `roomId` to the set of tokens issued for that room. Kept
   * in lock-step with {@link tickets} so a room's tickets can be revoked en
   * masse (e.g. on session end / room teardown) without scanning every token.
   *
   * Invariant: every token in `byRoom` exists in `tickets`, and every token in
   * `tickets` appears exactly once under its identity's `roomId` in `byRoom`.
   */
  private readonly byRoom = new Map<string, Set<string>>();
  private readonly byPlayer = new Map<string, string>();
  private readonly generateToken: () => string;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly rotatePerPlayer: boolean;

  constructor(options: ConnectionTicketStoreOptions = {}) {
    this.generateToken =
      options.generateToken ?? (() => randomBytes(24).toString("base64url"));
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DEFAULT_CONNECTION_TICKET_TTL_MS;
    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) {
      throw new RangeError(`ttlMs must be a positive number, got ${this.ttlMs}`);
    }
    this.rotatePerPlayer = options.rotatePerPlayer ?? true;
  }

  /** Issue a fresh ticket for the given identity and return its opaque token. */
  issue(identity: ConnectionIdentity): string {
    if (this.rotatePerPlayer) {
      const prior = this.byPlayer.get(this.playerKey(identity));
      if (prior !== undefined) this.remove(prior);
    }
    const token = this.generateToken();
    this.tickets.set(token, {
      identity: { roomId: identity.roomId, playerId: identity.playerId },
      expiresAt: this.now() + this.ttlMs,
    });
    let roomTokens = this.byRoom.get(identity.roomId);
    if (roomTokens === undefined) {
      roomTokens = new Set<string>();
      this.byRoom.set(identity.roomId, roomTokens);
    }
    roomTokens.add(token);
    this.byPlayer.set(this.playerKey(identity), token);
    return token;
  }

  /** Resolve a token to its identity, or `undefined` when unknown/blank. */
  resolve(token: string | null | undefined): ConnectionIdentity | undefined {
    if (typeof token !== "string" || token.length === 0) return undefined;
    const record = this.tickets.get(token);
    if (record === undefined) return undefined;
    if (this.now() >= record.expiresAt) {
      this.remove(token);
      return undefined;
    }
    return record.identity;
  }

  /** Invalidate a ticket (e.g. when a session ends). Idempotent for unknown tokens. */
  revoke(token: string): void {
    this.remove(token);
  }

  private remove(token: string): void {
    const record = this.tickets.get(token);
    if (record === undefined) return;
    const { identity } = record;
    this.tickets.delete(token);
    const roomTokens = this.byRoom.get(identity.roomId);
    if (roomTokens !== undefined) {
      roomTokens.delete(token);
      if (roomTokens.size === 0) this.byRoom.delete(identity.roomId);
    }
    const key = this.playerKey(identity);
    if (this.byPlayer.get(key) === token) this.byPlayer.delete(key);
  }

  /**
   * Revoke every ticket bound to the given room (e.g. on session end / room
   * teardown) and return the number of tickets revoked. Tickets for other rooms
   * are left untouched. Returns 0 when the room has no live tickets.
   */
  revokeRoom(roomId: string): number {
    const roomTokens = this.byRoom.get(roomId);
    if (roomTokens === undefined) return 0;
    const revoked = roomTokens.size;
    for (const token of [...roomTokens]) {
      this.remove(token);
    }
    return revoked;
  }

  /** Number of live tickets (for tests / introspection). */
  get size(): number {
    this.pruneExpired();
    return this.tickets.size;
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [token, record] of this.tickets) {
      if (now >= record.expiresAt) this.remove(token);
    }
  }

  private playerKey(identity: ConnectionIdentity): string {
    return `${identity.roomId}\u0000${identity.playerId}`;
  }
}

/** Minimal membership lookup the authorizer needs (RoomStore satisfies it). */
export interface RoomMembershipReader {
  getPlayer(playerId: string): { readonly roomId: string } | undefined;
}

/** Room lookup needed by host-only read authorizers. */
export interface RoomAccessReader extends RoomMembershipReader {
  getRoom(roomId: string): { readonly id: string; readonly hostPlayerId: string } | undefined;
}

/** Outcome of authorizing a `/ws` connection. */
export type ConnectionAuthResult =
  | { readonly ok: true; readonly identity: ConnectionIdentity }
  | { readonly ok: false; readonly reason: string };

/**
 * Authorize a WebSocket connection from a presented ticket. The identity comes
 * from the ticket (never from the client), and is then re-checked against the
 * room store so a ticket for a player that no longer belongs to the room is
 * rejected (defence in depth). Returns the authenticated identity on success.
 */
export function authorizeConnection(
  tickets: ConnectionTicketStore,
  members: RoomMembershipReader,
  token: string | null | undefined,
): ConnectionAuthResult {
  const identity = tickets.resolve(token);
  if (identity === undefined) {
    return { ok: false, reason: "invalid or missing connection ticket" };
  }
  const player = members.getPlayer(identity.playerId);
  if (player === undefined || player.roomId !== identity.roomId) {
    return { ok: false, reason: "player is not a member of the room" };
  }
  return { ok: true, identity };
}

/**
 * Outcome of authorizing a player-acting REST request against a Targeted_Identity.
 * The narrow reason union lets the server map rejections to status codes:
 * `no_ticket` → 401, `not_a_member`/`identity_mismatch` → 403.
 */
export type ActionAuthResult =
  | { readonly ok: true; readonly identity: ConnectionIdentity }
  | {
      readonly ok: false;
      readonly reason: "no_ticket" | "not_a_member" | "identity_mismatch";
    };

/**
 * Authorize a player-acting request from a presented ticket against the
 * Targeted_Identity carried by the request's path (`:roomId`/`:playerId`).
 *
 * Steps 1–2 (resolve the ticket + re-check room membership) are delegated to
 * {@link authorizeConnection} so the membership decision is shared with the
 * connection path. An `authorizeConnection` failure is classified into the
 * narrow union by inspecting whether the token resolved at all: an unresolved
 * token is `no_ticket`, otherwise the failure was the membership re-check and is
 * `not_a_member`. Step 3 then rejects when the ticket's identity does not match
 * the target on either `roomId` or `playerId` (`identity_mismatch`).
 *
 * The identity returned on success is ALWAYS the ticket's identity — never any
 * client-supplied `playerId`; `target` is used only for the match check. The
 * function is pure and does not mutate the ticket store.
 */
export function authorizeAction(
  tickets: ConnectionTicketStore,
  members: RoomMembershipReader,
  token: string | null | undefined,
  target: { roomId: string; playerId: string },
): ActionAuthResult {
  const connection = authorizeConnection(tickets, members, token);
  if (!connection.ok) {
    // Classify the shared membership decision into the narrow reason union.
    const reason =
      tickets.resolve(token) === undefined ? "no_ticket" : "not_a_member";
    return { ok: false, reason };
  }
  const { identity } = connection;
  if (identity.roomId !== target.roomId || identity.playerId !== target.playerId) {
    return { ok: false, reason: "identity_mismatch" };
  }
  return { ok: true, identity };
}

export type RoomReadAuthResult =
  | { readonly ok: true; readonly identity: ConnectionIdentity }
  | {
      readonly ok: false;
      readonly reason: "no_ticket" | "not_a_member" | "identity_mismatch" | "unknown_room" | "not_host";
    };

/** Authorize a room-specific read for any member of the target room. */
export function authorizeRoomMember(
  tickets: ConnectionTicketStore,
  members: RoomMembershipReader,
  token: string | null | undefined,
  roomId: string,
): RoomReadAuthResult {
  const connection = authorizeConnection(tickets, members, token);
  if (!connection.ok) {
    const reason =
      tickets.resolve(token) === undefined ? "no_ticket" : "not_a_member";
    return { ok: false, reason };
  }
  if (connection.identity.roomId !== roomId) {
    return { ok: false, reason: "identity_mismatch" };
  }
  return { ok: true, identity: connection.identity };
}

/** Authorize a room-specific read that only the room host may perform. */
export function authorizeRoomHost(
  tickets: ConnectionTicketStore,
  rooms: RoomAccessReader,
  token: string | null | undefined,
  roomId: string,
): RoomReadAuthResult {
  const member = authorizeRoomMember(tickets, rooms, token, roomId);
  if (!member.ok) return member;
  const room = rooms.getRoom(roomId);
  if (room === undefined) return { ok: false, reason: "unknown_room" };
  if (member.identity.playerId !== room.hostPlayerId) {
    return { ok: false, reason: "not_host" };
  }
  return member;
}
