/**
 * Production binding: wrap a `ws` WebSocket into the transport-agnostic
 * {@link Connection} the {@link RealtimeGateway} consumes.
 *
 * This is intentionally thin — all gateway logic lives behind the
 * {@link Connection} port so it stays unit-testable with a fake. This adapter
 * only translates the port onto the `ws` API:
 *  - {@link WsConnection.send} serializes the {@link ServerEvent} to JSON and
 *    throws synchronously when the socket is not OPEN, so the gateway's
 *    notify-and-retry policy can engage (Requirement 6.5).
 *  - inbound `message` AND `pong` frames are surfaced through `onMessage` so the
 *    gateway's heartbeat sweep treats either as a liveness signal (R13.4).
 *
 * Requirements: 6.5, 13.2, 13.3, 13.4, 13.5.
 */
import { WebSocket } from "ws";
import type { Connection, ServerEvent } from "./connection.js";

/** Identity for a wrapped socket (assigned by the connecting layer). */
export interface WsConnectionIdentity {
  /** Stable per-socket id. */
  id: string;
  /** The room this socket belongs to. */
  roomId: string;
  /** The authenticated player behind this socket. */
  playerId: string;
}

/** A {@link Connection} backed by a single `ws` WebSocket. */
export class WsConnection implements Connection {
  readonly id: string;
  readonly roomId: string;
  readonly playerId: string;
  private readonly socket: WebSocket;

  constructor(identity: WsConnectionIdentity, socket: WebSocket) {
    this.id = identity.id;
    this.roomId = identity.roomId;
    this.playerId = identity.playerId;
    this.socket = socket;
  }

  send(event: ServerEvent): void {
    if (this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(
        `cannot send '${event.type}': socket not open (readyState=${this.socket.readyState})`,
      );
    }
    // Throws synchronously if the frame cannot be enqueued, which the gateway
    // treats as a delivery failure (Requirement 6.5).
    this.socket.send(JSON.stringify(event));
  }

  ping(): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.ping();
    }
  }

  close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }

  onMessage(handler: (raw: string) => void): void {
    // Data frames and pong frames both count as inbound liveness signals.
    this.socket.on("message", (data: unknown) => handler(String(data)));
    this.socket.on("pong", () => handler("__pong__"));
  }

  onClose(handler: () => void): void {
    this.socket.on("close", () => handler());
  }
}

/** Functional helper mirroring {@link WsConnection} for call sites that prefer it. */
export function wrapWebSocket(identity: WsConnectionIdentity, socket: WebSocket): Connection {
  return new WsConnection(identity, socket);
}
