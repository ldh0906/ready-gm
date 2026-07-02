import { describe, expect, it } from "vitest";
import { createInitialTurnState } from "../core/round-loop.js";
import {
  applyBlackboardDeltas,
  createEmptyBlackboard,
  toVisibleBlackboard,
} from "../core/scenario-blackboard.js";
import { InMemoryBlackboardStore } from "../services/blackboard-store.js";
import { RealtimeGateway } from "./gateway.js";
import type { Connection, ServerEvent } from "./connection.js";

class FakeConnection implements Connection {
  readonly sent: ServerEvent[] = [];
  private onCloseHandler: () => void = () => undefined;

  constructor(
    readonly id: string,
    readonly roomId: string,
    readonly playerId: string,
  ) {}

  send(event: ServerEvent): void {
    this.sent.push(event);
  }
  ping(): void {}
  close(): void {
    this.onCloseHandler();
  }
  onMessage(handler: (raw: string) => void): void {
    void handler;
  }
  onClose(handler: () => void): void {
    this.onCloseHandler = handler;
  }
}

describe("blackboard reconnect projection", () => {
  it("sends discovered clues but never hidden secrets in reconnect turn_state payloads", () => {
    const store = new InMemoryBlackboardStore();
    const seeded = {
      ...createEmptyBlackboard("room-1", "the-sunless-crypt"),
      clues: [
        {
          id: "clue-1",
          conclusion: "The altar was moved recently.",
          discoveryCondition: { kind: "explicit_gm_trigger", triggerId: "altar" } as const,
          visibility: "undiscovered" as const,
        },
      ],
      secrets: [
        {
          id: "secret-1",
          truth: "The priest staged the abduction.",
          sensitivity: "high",
          revealState: "hidden" as const,
          relatedClueIds: ["clue-1"],
        },
      ],
    };
    store.save("room-1", applyBlackboardDeltas(seeded, [{ type: "reveal_clue", clueId: "clue-1", reason: "found" }]).blackboard);

    const gateway = new RealtimeGateway({
      getTurnState: () => createInitialTurnState("room-1"),
      decorateState: (_roomId, state) => ({ ...state, blackboard: toVisibleBlackboard(store.get("room-1")!) }),
    });
    const conn = new FakeConnection("conn-1", "room-1", "player-1");

    gateway.connect(conn);

    const event = conn.sent.find((e) => e.type === "turn_state");
    expect(event?.type).toBe("turn_state");
    if (event?.type !== "turn_state") return;
    expect(JSON.stringify(event.state)).toContain("The altar was moved recently.");
    expect(JSON.stringify(event.state)).not.toContain("The priest staged the abduction.");
  });
});
