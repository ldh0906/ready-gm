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
 * (single-process playtest scope); a ticket lives for the process lifetime and
 * can be explicitly revoked.
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
}

/**
 * An in-memory issuer/resolver of connection tickets. One instance backs the
 * playtest server; `issue` is called per session start and `resolve` per `/ws`
 * upgrade.
 */
export class ConnectionTicketStore {
  private readonly tickets = new Map<string, ConnectionIdentity>();
  /**
   * Reverse index from `roomId` to the set of tokens issued for that room. Kept
   * in lock-step with {@link tickets} so a room's tickets can be revoked en
   * masse (e.g. on session end / room teardown) without scanning every token.
   *
   * Invariant: every token in `byRoom` exists in `tickets`, and every token in
   * `tickets` appears exactly once under its identity's `roomId` in `byRoom`.
   */
  private readonly byRoom = new Map<string, Set<string>>();
  private readonly generateToken: () => string;

  constructor(options: ConnectionTicketStoreOptions = {}) {
    this.generateToken =
      options.generateToken ?? (() => randomBytes(24).toString("base64url"));
  }

  /** Issue a fresh ticket for the given identity and return its opaque token. */
  issue(identity: ConnectionIdentity): string {
    const token = this.generateToken();
    this.tickets.set(token, { roomId: identity.roomId, playerId: identity.playerId });
    let roomTokens = this.byRoom.get(identity.roomId);
    if (roomTokens === undefined) {
      roomTokens = new Set<string>();
      this.byRoom.set(identity.roomId, roomTokens);
    }
    roomTokens.add(token);
    return token;
  }

  /** Resolve a token to its identity, or `undefined` when unknown/blank. */
  resolve(token: string | null | undefined): ConnectionIdentity | undefined {
    if (typeof token !== "string" || token.length === 0) return undefined;
    return this.tickets.get(token);
  }

  /** Invalidate a ticket (e.g. when a session ends). Idempotent for unknown tokens. */
  revoke(token: string): void {
    const identity = this.tickets.get(token);
    if (identity === undefined) return;
    this.tickets.delete(token);
    const roomTokens = this.byRoom.get(identity.roomId);
    if (roomTokens !== undefined) {
      roomTokens.delete(token);
      if (roomTokens.size === 0) this.byRoom.delete(identity.roomId);
    }
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
    for (const token of roomTokens) {
      this.tickets.delete(token);
    }
    this.byRoom.delete(roomId);
    return revoked;
  }

  /** Number of live tickets (for tests / introspection). */
  get size(): number {
    return this.tickets.size;
  }
}

/** Minimal membership lookup the authorizer needs (RoomStore satisfies it). */
export interface RoomMembershipReader {
  getPlayer(playerId: string): { readonly roomId: string } | undefined;
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
