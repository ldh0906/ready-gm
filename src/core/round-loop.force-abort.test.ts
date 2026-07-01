import { describe, it, expect } from "vitest";
import { reduce, createInitialTurnState } from "./round-loop.js";
import type { TurnState } from "./turn-state.js";

/**
 * Unit test for force-proceed auto-pass failure abort (Requirement 9.3, task 9.5).
 */

function started(players: string[]): TurnState {
  return reduce(createInitialTurnState("room-1"), {
    type: "START_SESSION",
    by: players[0],
    hostId: players[0],
    activePlayers: players,
  });
}

describe("round-loop — force-proceed auto-pass failure abort (R9.3)", () => {
  it("withholds resolution and leaves readiness intact when an auto-pass failed externally", () => {
    const players = ["host", "p1", "p2"];
    // host is ready; p1/p2 are not.
    const state = reduce(started(players), { type: "CONFIRM_ACTION", from: "host", action: "go", deadline: null });
    expect(state.phase).toBe("ready_check");

    const aborted = reduce(state, {
      type: "FORCE_PROCEED",
      by: "host",
      hostId: "host",
      failedAutoPasses: ["p1"],
    });

    // No partial state change: identical to the pre-force state.
    expect(aborted).toStrictEqual(state);
    expect(aborted.phase).toBe("ready_check");
    expect(aborted.resolutionRequested).toBe(false);
    // p1/p2 remain not-ready (readiness intact).
    expect(aborted.readiness.find((e) => e.playerId === "p1")!.status).toBe("not_ready");
    expect(aborted.readiness.find((e) => e.playerId === "p2")!.status).toBe("not_ready");
  });

  it("proceeds normally when no auto-pass failures are reported", () => {
    const players = ["host", "p1"];
    const state = reduce(started(players), { type: "CONFIRM_ACTION", from: "host", action: "go", deadline: null });
    const forced = reduce(state, { type: "FORCE_PROCEED", by: "host", hostId: "host" });
    expect(forced.phase).toBe("resolving");
    expect(forced.resolutionRequested).toBe(true);
    expect(forced.readiness.find((e) => e.playerId === "p1")!.actionKind).toBe("auto_pass");
  });
});
