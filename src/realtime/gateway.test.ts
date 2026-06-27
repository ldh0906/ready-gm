import { describe, it, expect } from "vitest";
import type { TurnState } from "../core/turn-state.js";
import type { Connection, ServerEvent } from "./connection.js";
import { RealtimeGateway } from "./gateway.js";

/**
 * A fully in-memory {@link Connection} for testing the gateway without any real
 * socket. Records everything sent, supports targeted send-failure injection,
 * and exposes helpers to simulate inbound traffic (pong) and transport close.
 */
class FakeConnection implements Connection {
  readonly sent: ServerEvent[] = [];
  pingCount = 0;
  closed = false;

  /** When > 0, the next N `chat_message` sends throw (then succeed). */
  chatFailuresRemaining = 0;
  /** When true, every send throws (simulates a dead transport). */
  failAll = false;

  private messageHandler: ((raw: string) => void) | undefined;
  private closeHandler: (() => void) | undefined;

  constructor(
    readonly id: string,
    readonly roomId: string,
    readonly playerId: string,
  ) {}

  send(event: ServerEvent): void {
    if (this.failAll) {
      throw new Error("transport dead");
    }
    if (event.type === "chat_message" && this.chatFailuresRemaining > 0) {
      this.chatFailuresRemaining--;
      throw new Error("chat send failed");
    }
    this.sent.push(event);
  }

  ping(): void {
    this.pingCount++;
  }

  close(): void {
    this.closed = true;
    this.closeHandler?.();
  }

  onMessage(handler: (raw: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  /** Simulate the client answering a heartbeat (or any inbound traffic). */
  receivePong(): void {
    this.messageHandler?.("__pong__");
  }

  /** Events of a given type that reached this connection. */
  ofType<T extends ServerEvent["type"]>(type: T): Array<Extract<ServerEvent, { type: T }>> {
    return this.sent.filter((e): e is Extract<ServerEvent, { type: T }> => e.type === type);
  }
}

/** Build a minimal valid Turn_State for a room. */
function makeTurnState(roomId: string, roundNumber = 1): TurnState {
  return {
    roomId,
    roundNumber,
    phase: "free_chat",
    readiness: [],
    chatLog: [],
    checks: [],
    narrativeContext: [],
    readyCheckDeadline: null,
    readyCheckTimeoutMs: 90000,
    resolutionRequested: false,
  };
}

describe("RealtimeGateway — connect / resync", () => {
  it("delivers the current Turn_State immediately on connect (R13.2)", () => {
    const states = new Map<string, TurnState>([["room-1", makeTurnState("room-1", 3)]]);
    const gw = new RealtimeGateway({ getTurnState: (id) => states.get(id) });

    const conn = new FakeConnection("c1", "room-1", "p1");
    gw.connect(conn);

    const stateEvents = conn.ofType("turn_state");
    expect(stateEvents).toHaveLength(1);
    expect(stateEvents[0]?.state.roundNumber).toBe(3);
  });

  it("sends nothing on connect when the room has no Turn_State yet", () => {
    const gw = new RealtimeGateway({ getTurnState: () => undefined });
    const conn = new FakeConnection("c1", "room-1", "p1");
    gw.connect(conn);
    expect(conn.sent).toHaveLength(0);
  });

  it("resyncs current Turn_State on reconnect so the view matches (R13.5)", () => {
    const states = new Map<string, TurnState>([["room-1", makeTurnState("room-1", 1)]]);
    const gw = new RealtimeGateway({ getTurnState: (id) => states.get(id) });

    const first = new FakeConnection("c1", "room-1", "p1");
    gw.connect(first);
    // Connection drops, room state advances, player reconnects with a new socket.
    first.close();
    states.set("room-1", makeTurnState("room-1", 4));

    const reconnected = new FakeConnection("c2", "room-1", "p1");
    gw.connect(reconnected);

    const stateEvents = reconnected.ofType("turn_state");
    expect(stateEvents).toHaveLength(1);
    expect(stateEvents[0]?.state.roundNumber).toBe(4);
  });
});

describe("RealtimeGateway — broadcast (R13.1, R13.3)", () => {
  it("broadcasts an event to every connected member of the room", () => {
    const gw = new RealtimeGateway({ getTurnState: () => undefined });
    const a = new FakeConnection("a", "room-1", "p1");
    const b = new FakeConnection("b", "room-1", "p2");
    const other = new FakeConnection("c", "room-2", "p3");
    gw.connect(a);
    gw.connect(b);
    gw.connect(other);

    gw.broadcast("room-1", {
      type: "readiness_updated",
      roomId: "room-1",
      readiness: [],
    });

    expect(a.ofType("readiness_updated")).toHaveLength(1);
    expect(b.ofType("readiness_updated")).toHaveLength(1);
    expect(other.ofType("readiness_updated")).toHaveLength(0);
  });

  it("broadcastTurnState reads the current state and pushes it to all members", () => {
    const states = new Map<string, TurnState>([["room-1", makeTurnState("room-1", 2)]]);
    const gw = new RealtimeGateway({ getTurnState: (id) => states.get(id) });
    const a = new FakeConnection("a", "room-1", "p1");
    const b = new FakeConnection("b", "room-1", "p2");
    gw.connect(a);
    gw.connect(b);

    states.set("room-1", makeTurnState("room-1", 5));
    gw.broadcastTurnState("room-1");

    // Each member: one on connect (round 2) + one from the broadcast (round 5).
    expect(a.ofType("turn_state").map((e) => e.state.roundNumber)).toEqual([2, 5]);
    expect(b.ofType("turn_state").map((e) => e.state.roundNumber)).toEqual([2, 5]);
  });
});

describe("RealtimeGateway — chat delivery failure (R6.5)", () => {
  it("notifies the affected player and retries until the chat is delivered", () => {
    const gw = new RealtimeGateway({ getTurnState: () => undefined });
    const conn = new FakeConnection("c1", "room-1", "p1");
    conn.chatFailuresRemaining = 1; // fail once, succeed on retry
    gw.connect(conn);

    gw.broadcast("room-1", {
      type: "chat_message",
      roomId: "room-1",
      message: { playerId: "p2", characterName: "Borin", text: "hello", ts: "2024-01-01T00:00:00.000Z" },
    });

    // The player was notified of the failure...
    const failures = conn.ofType("delivery_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]?.failedType).toBe("chat_message");
    // ...and the retry delivered the chat message.
    expect(conn.ofType("chat_message")).toHaveLength(1);
  });

  it("retries up to the configured bound and gives up on a dead transport", () => {
    const gw = new RealtimeGateway({ getTurnState: () => undefined, maxSendRetries: 2 });
    const conn = new FakeConnection("c1", "room-1", "p1");
    gw.connect(conn);
    conn.failAll = true;

    // Should not throw even though every attempt (and the notice) fails.
    expect(() =>
      gw.broadcast("room-1", {
        type: "chat_message",
        roomId: "room-1",
        message: { playerId: "p2", characterName: "Borin", text: "hi", ts: "t" },
      }),
    ).not.toThrow();
    expect(conn.ofType("chat_message")).toHaveLength(0);
  });
});

describe("RealtimeGateway — narration buffering (R10.7, R13.5)", () => {
  it("buffers narration when no players are connected and flushes on connect", () => {
    const gw = new RealtimeGateway({ getTurnState: () => undefined });

    // No connections: narration must be retained, not lost.
    gw.deliverNarration("room-1", { kind: "resolution", roundNumber: 1, text: "결과 서술" });
    expect(gw.hasConnections("room-1")).toBe(false);

    const conn = new FakeConnection("c1", "room-1", "p1");
    gw.connect(conn);

    const narration = conn.ofType("narration");
    expect(narration).toHaveLength(1);
    expect(narration[0]?.narration.text).toBe("결과 서술");
  });

  it("broadcasts narration live (does not buffer) when players are connected", () => {
    const gw = new RealtimeGateway({ getTurnState: () => undefined });
    const conn = new FakeConnection("c1", "room-1", "p1");
    gw.connect(conn);

    gw.deliverNarration("room-1", { kind: "opening", roundNumber: 1, text: "도입부" });

    expect(conn.ofType("narration")).toHaveLength(1);
  });

  it("does not re-deliver buffered narration after it has been flushed", () => {
    const gw = new RealtimeGateway({ getTurnState: () => undefined });
    gw.deliverNarration("room-1", { kind: "resolution", roundNumber: 1, text: "한 번" });

    const first = new FakeConnection("c1", "room-1", "p1");
    gw.connect(first);
    expect(first.ofType("narration")).toHaveLength(1);

    // A later joiner does not receive the already-flushed buffer again.
    const second = new FakeConnection("c2", "room-1", "p2");
    gw.connect(second);
    expect(second.ofType("narration")).toHaveLength(0);
  });
});

describe("RealtimeGateway — heartbeat re-establishment (R13.3, R13.4)", () => {
  it("pings live connections and reaps ones that did not answer the prior probe", () => {
    const gw = new RealtimeGateway({ getTurnState: () => undefined });
    const responsive = new FakeConnection("c1", "room-1", "p1");
    const stale = new FakeConnection("c2", "room-1", "p2");
    gw.connect(responsive);
    gw.connect(stale);

    // First sweep: both were alive on connect, so both get probed and reset.
    gw.heartbeat();
    expect(responsive.pingCount).toBe(1);
    expect(stale.pingCount).toBe(1);
    expect(gw.connectionCount("room-1")).toBe(2);

    // Only the responsive connection answers the probe.
    responsive.receivePong();

    // Second sweep: stale did not answer → closed and removed (re-establish).
    gw.heartbeat();
    expect(stale.closed).toBe(true);
    expect(gw.connectionCount("room-1")).toBe(1);
    expect(responsive.pingCount).toBe(2);
  });
});
