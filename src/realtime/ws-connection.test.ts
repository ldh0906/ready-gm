import { describe, it, expect, vi } from "vitest";
import { WebSocket } from "ws";
import type { ServerEvent } from "./connection.js";
import { WsConnection, wrapWebSocket } from "./ws-connection.js";

/**
 * A minimal stub matching the slice of the `ws` WebSocket API the adapter uses,
 * so the adapter is verified without opening a real socket.
 */
class StubSocket {
  readyState: number = WebSocket.OPEN;
  readonly outbound: string[] = [];
  pings = 0;
  private readonly handlers = new Map<string, (arg?: unknown) => void>();

  send(data: string): void {
    if (this.readyState !== WebSocket.OPEN) {
      throw new Error("not open");
    }
    this.outbound.push(data);
  }

  ping(): void {
    this.pings++;
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.handlers.get("close")?.();
  }

  on(event: string, handler: (arg?: unknown) => void): this {
    this.handlers.set(event, handler);
    return this;
  }

  emit(event: string, arg?: unknown): void {
    this.handlers.get(event)?.(arg);
  }
}

const identity = { id: "c1", roomId: "room-1", playerId: "p1" };
const sampleEvent: ServerEvent = {
  type: "narration",
  roomId: "room-1",
  narration: { kind: "opening", roundNumber: 1, text: "도입부" },
};

describe("WsConnection adapter", () => {
  it("serializes events to JSON and writes them to the socket", () => {
    const socket = new StubSocket();
    const conn = new WsConnection(identity, socket as unknown as WebSocket);

    conn.send(sampleEvent);

    expect(socket.outbound).toHaveLength(1);
    expect(JSON.parse(socket.outbound[0] ?? "")).toEqual(sampleEvent);
  });

  it("throws synchronously when the socket is not open (drives gateway retry)", () => {
    const socket = new StubSocket();
    socket.readyState = WebSocket.CLOSING;
    const conn = wrapWebSocket(identity, socket as unknown as WebSocket);

    expect(() => conn.send(sampleEvent)).toThrow();
  });

  it("surfaces both message and pong frames as liveness signals", () => {
    const socket = new StubSocket();
    const conn = new WsConnection(identity, socket as unknown as WebSocket);
    const onMessage = vi.fn();
    conn.onMessage(onMessage);

    socket.emit("message", "hi");
    socket.emit("pong");

    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(onMessage).toHaveBeenNthCalledWith(1, "hi");
    expect(onMessage).toHaveBeenNthCalledWith(2, "__pong__");
  });

  it("invokes the close handler when the socket closes", () => {
    const socket = new StubSocket();
    const conn = new WsConnection(identity, socket as unknown as WebSocket);
    const onClose = vi.fn();
    conn.onClose(onClose);

    conn.close();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });
});
