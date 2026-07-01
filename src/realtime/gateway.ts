/**
 * RealtimeGateway — the WebSocket gateway's transport-agnostic core (the
 * Realtime_Channel). It owns per-room connection lifecycle, convergent state
 * fan-out, reliable chat delivery, heartbeat-driven re-establishment, and
 * buffering of narration produced while a room is empty.
 *
 * The gateway depends only on the {@link Connection} port and a function that
 * reads the room's current Turn_State, so all of its behavior is unit-testable
 * with a fake in-memory connection (no real sockets). The production binding
 * wraps a `ws` WebSocket into a {@link Connection} (`ws-connection.ts`).
 *
 * Behavior (all per-room):
 *  - **connect / reconnect** — register the connection and immediately deliver
 *    the current Turn_State so the client view matches room state; reconnect is
 *    just a fresh connect for the same player (Requirements 13.1, 13.2, 13.5).
 *  - **broadcast** — push Turn_State (and scenario/player/readiness) changes to
 *    every connected member (Requirements 13.1, 13.3).
 *  - **chat delivery failure** — when a send throws, notify the affected player
 *    with a `delivery_failed` event and retry delivery (Requirements 6.5, 13.4).
 *  - **heartbeat** — a periodic sweep pings live connections and closes ones
 *    that did not answer the previous probe (stale-but-"connected"), forcing
 *    client-side re-establishment (Requirements 13.3, 13.4).
 *  - **narration buffering** — narration produced while NO players are connected
 *    is retained and flushed to the next player that connects (Requirements
 *    10.7, 13.5).
 *
 * Requirements: 6.5, 10.7, 13.1, 13.2, 13.3, 13.4, 13.5.
 */
import type { TurnState } from "../core/turn-state.js";
import type { Connection, NarrationPayload, ServerEvent } from "./connection.js";

/** A tracked connection plus its heartbeat liveness flag. */
interface ConnectionRecord {
  connection: Connection;
  /**
   * Set whenever inbound traffic is seen; cleared each heartbeat sweep. A
   * connection still cleared on the next sweep is considered stale (R13.4).
   */
  alive: boolean;
}

/** Construction dependencies for {@link RealtimeGateway}. */
export interface RealtimeGatewayDeps {
  /**
   * Read the room's current Turn_State (live store). Returns `undefined` when
   * the room has no Turn_State yet (e.g. still in lobby).
   */
  getTurnState: (roomId: string) => TurnState | undefined;
  /**
   * Optional fan-out decorator applied to the Turn_State just before it is sent
   * to clients (both broadcast and on-(re)connect resync). Used to enrich the
   * readiness roster with display-only player/character names without polluting
   * the canonical persisted state. Identity by default.
   */
  decorateState?: (roomId: string, state: TurnState) => TurnState;
  /**
   * Additional delivery retries after the first failed attempt. Default `2`
   * (3 total attempts), mirroring the engine's retry convention (R6.5).
   */
  maxSendRetries?: number;
}

/**
 * The transport-agnostic realtime gateway. One instance fans out to every room;
 * connections are grouped by `roomId`.
 */
export class RealtimeGateway {
  /** roomId → (connectionId → record). */
  private readonly rooms = new Map<string, Map<string, ConnectionRecord>>();
  /** roomId → narration buffered while the room had no connections (R10.7). */
  private readonly narrationBuffer = new Map<string, NarrationPayload[]>();
  private readonly getTurnState: (roomId: string) => TurnState | undefined;
  private readonly decorateState: (roomId: string, state: TurnState) => TurnState;
  private readonly maxSendRetries: number;

  constructor(deps: RealtimeGatewayDeps) {
    this.getTurnState = deps.getTurnState;
    this.decorateState = deps.decorateState ?? ((_roomId, state) => state);
    this.maxSendRetries = Math.max(0, deps.maxSendRetries ?? 2);
  }

  /**
   * Register a connection to its room and immediately resync it.
   *
   * Used for both first connect and reconnect — a reconnecting player opens a
   * fresh {@link Connection} and the gateway delivers the current Turn_State so
   * the player's view matches the room (Requirements 13.2, 13.5). Any narration
   * buffered while the room was empty is flushed to this connection (R10.7).
   */
  connect(connection: Connection): void {
    const room = this.roomFor(connection.roomId);
    const record: ConnectionRecord = { connection, alive: true };
    // Register the fresh connection FIRST so closing any stale one below cannot
    // prune the (briefly empty) room map out from under us.
    room.set(connection.id, record);

    // Drop any prior connection for the SAME player in this room: a reconnect
    // opens a fresh socket, and leaving the stale record would keep fanning out
    // to a dead transport until the heartbeat reaps it (S8).
    for (const [existingId, existing] of [...room.entries()]) {
      if (existingId !== connection.id && existing.connection.playerId === connection.playerId) {
        room.delete(existingId);
        try {
          existing.connection.close();
        } catch {
          // Closing a broken transport is best-effort.
        }
      }
    }

    // Any inbound traffic (data or pong) marks the connection alive (R13.4).
    connection.onMessage(() => {
      record.alive = true;
    });
    // Drop the connection from its room when the transport closes.
    connection.onClose(() => {
      this.remove(connection.roomId, connection.id);
    });

    // R13.2 / R13.5: deliver the current Turn_State on (re)connect.
    const state = this.getTurnState(connection.roomId);
    if (state !== undefined) {
      this.deliver(record, {
        type: "turn_state",
        roomId: connection.roomId,
        state: this.decorateState(connection.roomId, state),
      });
    }

    // R10.7 / R13.5: flush narration produced while the room had no players.
    this.flushNarrationBuffer(connection.roomId, record);
  }

  /** Explicitly drop a connection (e.g. on a clean client disconnect). */
  disconnect(roomId: string, connectionId: string): void {
    this.remove(roomId, connectionId);
  }

  /**
   * Broadcast an event to every connection in a room, applying the notify+retry
   * delivery policy per recipient (Requirements 6.5, 13.1, 13.3). Unknown rooms
   * are a no-op.
   */
  broadcast(roomId: string, event: ServerEvent): void {
    const room = this.rooms.get(roomId);
    if (room === undefined) return;
    for (const record of [...room.values()]) {
      this.deliver(record, event);
    }
  }

  /**
   * Convenience: read the room's current Turn_State and broadcast it to all
   * members (Requirements 13.1, 13.3). No-op when there is no Turn_State yet.
   */
  broadcastTurnState(roomId: string): void {
    const state = this.getTurnState(roomId);
    if (state === undefined) return;
    this.broadcast(roomId, { type: "turn_state", roomId, state: this.decorateState(roomId, state) });
  }

  /**
   * Deliver GM narration to a room. When the room has at least one connection
   * the narration is broadcast immediately; otherwise it is buffered and
   * flushed to the next player that connects (Requirements 10.7, 13.5).
   */
  deliverNarration(roomId: string, narration: NarrationPayload): void {
    const room = this.rooms.get(roomId);
    if (room !== undefined && room.size > 0) {
      this.broadcast(roomId, { type: "narration", roomId, narration });
      return;
    }
    const buffered = this.narrationBuffer.get(roomId) ?? [];
    buffered.push(narration);
    this.narrationBuffer.set(roomId, buffered);
  }

  /**
   * Periodic liveness sweep (Requirements 13.3, 13.4). A connection that has
   * not produced any inbound traffic since the previous sweep is treated as
   * stale-but-"connected" and is closed so the client re-establishes; a
   * connection that answered is re-probed and its liveness flag reset.
   */
  heartbeat(): void {
    for (const [roomId, room] of [...this.rooms.entries()]) {
      for (const [connId, record] of [...room.entries()]) {
        if (!record.alive) {
          // Stale: no traffic since the last probe — force re-establishment.
          room.delete(connId);
          try {
            record.connection.close();
          } catch {
            // Closing a broken transport is best-effort.
          }
          continue;
        }
        // Responsive last sweep: reset and probe again.
        record.alive = false;
        try {
          record.connection.ping();
        } catch {
          // A failed probe simply leaves the connection to be reaped next sweep.
        }
      }
      if (room.size === 0) {
        this.rooms.delete(roomId);
      }
    }
  }

  /** Number of connections currently registered for a room. */
  connectionCount(roomId: string): number {
    return this.rooms.get(roomId)?.size ?? 0;
  }

  /**
   * Schedule the periodic {@link heartbeat} sweep on an interval and return a
   * disposer that stops it (S4). The composition root / server entrypoint owns
   * the lifecycle, but exposing this here means the sweep cannot be forgotten:
   * call once after wiring the gateway and call the returned function on
   * shutdown. The timer is `unref`'d so it never keeps the process alive on its
   * own (Requirements 13.3, 13.4).
   *
   * @param intervalMs sweep period in milliseconds (must be > 0).
   */
  startHeartbeat(intervalMs: number): () => void {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new RangeError(`heartbeat intervalMs must be a positive number, got ${intervalMs}`);
    }
    const timer = globalThis.setInterval(() => this.heartbeat(), intervalMs);
    // Don't let the heartbeat alone keep the Node process alive.
    (timer as { unref?: () => void }).unref?.();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      globalThis.clearInterval(timer);
    };
  }

  /** Whether a room has any connected players (drives narration buffering). */
  hasConnections(roomId: string): boolean {
    return this.connectionCount(roomId) > 0;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Get (or lazily create) the connection map for a room. */
  private roomFor(roomId: string): Map<string, ConnectionRecord> {
    let room = this.rooms.get(roomId);
    if (room === undefined) {
      room = new Map<string, ConnectionRecord>();
      this.rooms.set(roomId, room);
    }
    return room;
  }

  /** Remove a connection and prune the room map when it becomes empty. */
  private remove(roomId: string, connectionId: string): void {
    const room = this.rooms.get(roomId);
    if (room === undefined) return;
    room.delete(connectionId);
    if (room.size === 0) {
      this.rooms.delete(roomId);
    }
  }

  /**
   * Deliver one event to one connection with the failure policy: attempt once;
   * on failure notify the affected player with a `delivery_failed` event and
   * retry up to {@link maxSendRetries} more times (Requirement 6.5). Returns
   * whether delivery ultimately succeeded.
   */
  private deliver(record: ConnectionRecord, event: ServerEvent): boolean {
    if (this.attemptSend(record.connection, event)) {
      return true;
    }
    // First attempt failed: notify the affected player, then retry delivery.
    this.notifyDeliveryFailure(record.connection, event);
    for (let retry = 0; retry < this.maxSendRetries; retry++) {
      if (this.attemptSend(record.connection, event)) {
        return true;
      }
    }
    return false;
  }

  /** Attempt a single send, swallowing transport errors into a boolean. */
  private attemptSend(connection: Connection, event: ServerEvent): boolean {
    try {
      connection.send(event);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Best-effort notification to the affected player that a message failed to be
   * delivered (Requirement 6.5). Sent directly (not through {@link deliver}) so
   * a failing notice never recurses; a `delivery_failed` event is itself not
   * re-notified.
   */
  private notifyDeliveryFailure(connection: Connection, failed: ServerEvent): void {
    if (failed.type === "delivery_failed") return;
    try {
      connection.send({
        type: "delivery_failed",
        roomId: connection.roomId,
        failedType: failed.type,
        detail: `delivery of '${failed.type}' failed; retrying`,
      });
    } catch {
      // The player is likely unreachable; the heartbeat sweep will reap them.
    }
  }

  /** Flush narration buffered while the room was empty to a connection (R10.7). */
  private flushNarrationBuffer(roomId: string, record: ConnectionRecord): void {
    const buffered = this.narrationBuffer.get(roomId);
    if (buffered === undefined || buffered.length === 0) return;
    for (const narration of buffered) {
      this.deliver(record, { type: "narration", roomId, narration });
    }
    // Delivered to the (re)connecting player; subsequent narration broadcasts
    // live, and any later joiner resyncs via the Turn_State narrativeContext.
    this.narrationBuffer.delete(roomId);
  }
}
