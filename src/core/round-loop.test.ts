import { describe, it, expect } from "vitest";
import {
  createInitialTurnState,
  reduce,
  reduceMany,
  type Command,
} from "./round-loop.js";
import type { CheckRecord, TurnState } from "./turn-state.js";

const ROOM = "room-1";
const HOST = "p-host";
const P2 = "p-2";
const P3 = "p-3";

/** A started, free-chat Round 1 with the given roster. */
function started(roster: string[] = [HOST, P2]): TurnState {
  return reduce(createInitialTurnState(ROOM), {
    type: "START_SESSION",
    by: HOST,
    hostId: HOST,
    activePlayers: roster,
  });
}

/** Find a player's readiness row. */
function readinessOf(state: TurnState, playerId: string) {
  return state.readiness.find((entry) => entry.playerId === playerId);
}

const sampleCheck: CheckRecord = {
  characterId: "char-host",
  attribute: "Might",
  difficulty: "Average",
  roll: 1,
  outcome: "Success",
};

describe("START_SESSION (Task 7.1, R5.4)", () => {
  it("initializes roundNumber=1 and phase=free_chat", () => {
    const state = started([HOST, P2]);
    expect(state.roundNumber).toBe(1);
    expect(state.phase).toBe("free_chat");
  });

  it("seeds one not-ready readiness entry per active player", () => {
    const state = started([HOST, P2, P3]);
    expect(state.readiness).toHaveLength(3);
    expect(state.readiness.every((e) => e.status === "not_ready")).toBe(true);
    expect(state.readiness.every((e) => e.actionKind === null)).toBe(true);
  });

  it("clears any stale per-round fields on start", () => {
    const dirty = createInitialTurnState(ROOM, {
      chatLog: [{ playerId: HOST, characterName: "Old", text: "hi", ts: "t" }],
      resolutionRequested: true,
      readyCheckDeadline: "2020-01-01T00:00:00Z",
    });
    const state = reduce(dirty, { type: "START_SESSION", by: HOST, hostId: HOST, activePlayers: [HOST] });
    expect(state.chatLog).toEqual([]);
    expect(state.resolutionRequested).toBe(false);
    expect(state.readyCheckDeadline).toBeNull();
  });

  it("rejects a non-host start, leaving the Turn_State unchanged (R5.2)", () => {
    const pre = createInitialTurnState(ROOM);
    const next = reduce(pre, { type: "START_SESSION", by: P2, hostId: HOST, activePlayers: [HOST, P2] });
    expect(next).toEqual(pre);
    expect(next.roundNumber).toBe(0);
    expect(next.readiness).toEqual([]);
  });
});

describe("SEND_CHAT (Task 7.3, R6.1/6.3/6.4)", () => {
  it("appends member messages to chatLog in send order, attributed to character", () => {
    let state = started([HOST, P2]);
    state = reduce(state, {
      type: "SEND_CHAT",
      from: HOST,
      characterName: "Aria",
      text: "first",
      ts: "t1",
    });
    state = reduce(state, {
      type: "SEND_CHAT",
      from: P2,
      characterName: "Borin",
      text: "second",
      ts: "t2",
    });
    expect(state.chatLog.map((c) => c.text)).toEqual(["first", "second"]);
    expect(state.chatLog[0].characterName).toBe("Aria");
    expect(state.chatLog[1].characterName).toBe("Borin");
  });

  it("rejects messages from non-members (no-op)", () => {
    const state = started([HOST, P2]);
    const next = reduce(state, {
      type: "SEND_CHAT",
      from: "stranger",
      characterName: "X",
      text: "hi",
      ts: "t",
    });
    expect(next).toEqual(state);
  });

  it("rejects chat outside the free-chat phase (no-op)", () => {
    let state = started([HOST]);
    state = reduce(state, { type: "CONFIRM_ACTION", from: HOST, action: "swing", deadline: null });
    expect(state.phase).toBe("resolving");
    const next = reduce(state, {
      type: "SEND_CHAT",
      from: HOST,
      characterName: "Aria",
      text: "late",
      ts: "t",
    });
    expect(next).toEqual(state);
  });
});

describe("CONFIRM_ACTION / PASS (Task 7.5, R7.1/7.2)", () => {
  it("CONFIRM_ACTION marks ready with confirmed_action and stores text", () => {
    let state = started([HOST, P2]);
    state = reduce(state, { type: "CONFIRM_ACTION", from: HOST, action: "open door", deadline: null });
    const row = readinessOf(state, HOST);
    expect(row?.status).toBe("ready");
    expect(row?.actionKind).toBe("confirmed_action");
    expect(row?.actionText).toBe("open door");
  });

  it("PASS marks ready with actionKind=pass and no text", () => {
    let state = started([HOST, P2]);
    state = reduce(state, { type: "PASS", from: HOST, deadline: null });
    const row = readinessOf(state, HOST);
    expect(row?.status).toBe("ready");
    expect(row?.actionKind).toBe("pass");
    expect(row?.actionText).toBeNull();
  });

  it("opens the ready-check gate on first submission and arms the deadline", () => {
    let state = started([HOST, P2]);
    expect(state.phase).toBe("free_chat");
    state = reduce(state, {
      type: "CONFIRM_ACTION",
      from: HOST,
      action: "scout",
      deadline: "2030-01-01T00:00:00Z",
    });
    expect(state.phase).toBe("ready_check");
    expect(state.readyCheckDeadline).toBe("2030-01-01T00:00:00Z");
  });

  it("ignores submissions from non-members", () => {
    const state = started([HOST, P2]);
    const next = reduce(state, { type: "PASS", from: "ghost", deadline: null });
    expect(next).toEqual(state);
  });
});

describe("resolution gating (Task 8.1, R7.4/7.5/7.7)", () => {
  it("withholds resolving while any active player is not ready", () => {
    let state = started([HOST, P2]);
    state = reduce(state, { type: "CONFIRM_ACTION", from: HOST, action: "go", deadline: null });
    expect(state.phase).toBe("ready_check");
    expect(state.resolutionRequested).toBe(false);
  });

  it("enters resolving once every active player is ready", () => {
    let state = started([HOST, P2]);
    state = reduce(state, { type: "CONFIRM_ACTION", from: HOST, action: "go", deadline: null });
    state = reduce(state, { type: "PASS", from: P2, deadline: null });
    expect(state.phase).toBe("resolving");
    expect(state.resolutionRequested).toBe(true);
    expect(state.readyCheckDeadline).toBeNull();
  });
});

describe("REVISE before/during resolution (Task 8.3, R7.6/7.8)", () => {
  it("accepts a revise while in ready_check", () => {
    let state = started([HOST, P2]);
    state = reduce(state, { type: "CONFIRM_ACTION", from: HOST, action: "first", deadline: null });
    state = reduce(state, { type: "REVISE", from: HOST, action: "second" });
    expect(readinessOf(state, HOST)?.actionText).toBe("second");
    expect(state.phase).toBe("ready_check");
  });

  it("rejects an action edit once resolving (controls locked, no-op)", () => {
    let state = started([HOST]);
    state = reduce(state, { type: "CONFIRM_ACTION", from: HOST, action: "locked", deadline: null });
    expect(state.phase).toBe("resolving");
    const next = reduce(state, { type: "REVISE", from: HOST, action: "sneaky edit" });
    expect(next).toEqual(state);
    expect(readinessOf(next, HOST)?.actionText).toBe("locked");
  });
});

describe("mid-resolution revert halt (Task 8.5, R7.9)", () => {
  it("reverting to not-ready during resolving clears the guard and returns to ready_check", () => {
    let state = started([HOST, P2]);
    state = reduce(state, { type: "CONFIRM_ACTION", from: HOST, action: "go", deadline: null });
    state = reduce(state, { type: "PASS", from: P2, deadline: null });
    expect(state.phase).toBe("resolving");

    const halted = reduce(state, { type: "REVISE", from: P2, action: null });
    expect(halted.phase).toBe("ready_check");
    expect(halted.resolutionRequested).toBe(false);
    expect(readinessOf(halted, P2)?.status).toBe("not_ready");
  });

  it("a stale RESOLUTION_READY after a halt is ignored", () => {
    let state = started([HOST]);
    state = reduce(state, { type: "CONFIRM_ACTION", from: HOST, action: "go", deadline: null });
    const halted = reduce(state, { type: "REVISE", from: HOST, action: null });
    expect(halted.phase).toBe("ready_check");
    const next = reduce(halted, {
      type: "RESOLUTION_READY",
      narration: "stale",
      checks: [],
      endingReached: false,
    });
    expect(next).toEqual(halted);
  });
});

describe("timeout auto-pass (Task 9.1, R8.1/8.2/8.5)", () => {
  it("applies an auto_pass distinguishable from a manual pass", () => {
    let state = started([HOST, P2]);
    state = reduce(state, { type: "CONFIRM_ACTION", from: HOST, action: "go", deadline: "d" });
    state = reduce(state, { type: "TIMEOUT_EXPIRED", player: P2 });
    const row = readinessOf(state, P2);
    expect(row?.status).toBe("ready");
    expect(row?.actionKind).toBe("auto_pass");
    expect(state.phase).toBe("resolving"); // both now ready -> gate trips
  });

  it("is a no-op outside ready_check", () => {
    const state = started([HOST, P2]); // still free_chat
    const next = reduce(state, { type: "TIMEOUT_EXPIRED", player: P2 });
    expect(next).toEqual(state);
  });

  it("does not overwrite an already-ready player's submission", () => {
    let state = started([HOST, P2]);
    state = reduce(state, { type: "CONFIRM_ACTION", from: HOST, action: "go", deadline: "d" });
    const next = reduce(state, { type: "TIMEOUT_EXPIRED", player: HOST });
    expect(readinessOf(next, HOST)?.actionKind).toBe("confirmed_action");
  });
});

describe("force-proceed (Task 9.3, R9.2/9.3/9.4)", () => {
  it("host force-proceed auto-passes unready players and triggers resolution once", () => {
    let state = started([HOST, P2, P3]);
    state = reduce(state, { type: "CONFIRM_ACTION", from: HOST, action: "go", deadline: "d" });
    state = reduce(state, { type: "FORCE_PROCEED", by: HOST, hostId: HOST });
    expect(state.phase).toBe("resolving");
    expect(state.resolutionRequested).toBe(true);
    expect(readinessOf(state, P2)?.actionKind).toBe("auto_pass");
    expect(readinessOf(state, P3)?.actionKind).toBe("auto_pass");
    // The host's confirmed action is preserved, not overwritten.
    expect(readinessOf(state, HOST)?.actionKind).toBe("confirmed_action");
  });

  it("rejects a non-host invocation leaving Turn_State unchanged", () => {
    let state = started([HOST, P2]);
    state = reduce(state, { type: "CONFIRM_ACTION", from: HOST, action: "go", deadline: "d" });
    const next = reduce(state, { type: "FORCE_PROCEED", by: P2, hostId: HOST });
    expect(next).toEqual(state);
  });

  it("aborts with no partial state when an auto-pass failed externally", () => {
    let state = started([HOST, P2]);
    state = reduce(state, { type: "CONFIRM_ACTION", from: HOST, action: "go", deadline: "d" });
    const next = reduce(state, {
      type: "FORCE_PROCEED",
      by: HOST,
      hostId: HOST,
      failedAutoPasses: [P2],
    });
    expect(next).toEqual(state);
    expect(next.phase).toBe("ready_check");
    expect(readinessOf(next, P2)?.status).toBe("not_ready");
  });

  it("is a no-op while in free_chat with nobody ready (F4: needs >=1 ready)", () => {
    const state = started([HOST, P2]); // free_chat, no submissions yet
    const next = reduce(state, { type: "FORCE_PROCEED", by: HOST, hostId: HOST });
    expect(next).toEqual(state);
    expect(next.phase).toBe("free_chat");
  });

  it("proceeds once at least one player is ready, auto-passing the rest (F4)", () => {
    let state = started([HOST, P2, P3]);
    // A single confirmation opens ready_check and satisfies the >=1-ready gate.
    state = reduce(state, { type: "CONFIRM_ACTION", from: HOST, action: "go", deadline: "d" });
    const next = reduce(state, { type: "FORCE_PROCEED", by: HOST, hostId: HOST });
    expect(next.phase).toBe("resolving");
    expect(readinessOf(next, P2)?.actionKind).toBe("auto_pass");
    expect(readinessOf(next, P3)?.actionKind).toBe("auto_pass");
  });
});

describe("at-most-once resolution and round advancement (Task 9.6, R10.3/10.5/11.5/16.1)", () => {
  it("a force-proceed after all-ready does not re-trigger resolution", () => {
    let state = started([HOST, P2]);
    state = reduce(state, { type: "CONFIRM_ACTION", from: HOST, action: "go", deadline: "d" });
    state = reduce(state, { type: "PASS", from: P2, deadline: "d" });
    expect(state.phase).toBe("resolving");
    const next = reduce(state, { type: "FORCE_PROCEED", by: HOST, hostId: HOST });
    expect(next).toEqual(state); // guard already set
  });

  it("RESOLUTION_READY advances to roundNumber+1 / free_chat and clears this round's checks", () => {
    let state = started([HOST]);
    state = reduce(state, { type: "CONFIRM_ACTION", from: HOST, action: "go", deadline: null });
    expect(state.phase).toBe("resolving");
    const before = state.roundNumber;
    state = reduce(state, {
      type: "RESOLUTION_READY",
      narration: "The door creaks open.",
      checks: [sampleCheck],
      endingReached: false,
    });
    expect(state.roundNumber).toBe(before + 1);
    expect(state.phase).toBe("free_chat");
    expect(state.resolutionRequested).toBe(false);
    // Per-round checks are cleared on advance so the prior round's rolls do not
    // leak into the next round's AI GM context (F1); the resolution is captured
    // in narrativeContext instead.
    expect(state.checks).toEqual([]);
    expect(state.narrativeContext.at(-1)).toEqual({ round: before, text: "The door creaks open." });
    // Readiness reset for the new round.
    expect(state.readiness.every((e) => e.status === "not_ready")).toBe(true);
    expect(state.chatLog).toEqual([]);
  });

  it("ignores RESOLUTION_READY when not resolving", () => {
    const state = started([HOST, P2]); // free_chat
    const next = reduce(state, {
      type: "RESOLUTION_READY",
      narration: "n",
      checks: [],
      endingReached: false,
    });
    expect(next).toEqual(state);
  });
});

describe("sequential convergence (Task 10.1, R13.6)", () => {
  // P3 never readies, so the round stays in ready_check (the gate never trips)
  // and every readiness revision is applied — isolating the convergence property
  // from the locking that begins once resolution is triggered.
  it("reflects each player's final submission regardless of interleaving", () => {
    const base = started([HOST, P2, P3]);
    const commands: Command[] = [
      { type: "CONFIRM_ACTION", from: HOST, action: "draft", deadline: "d" },
      { type: "PASS", from: P2, deadline: "d" },
      { type: "REVISE", from: P2, action: null },
      { type: "CONFIRM_ACTION", from: P2, action: "final-2", deadline: "d" },
      { type: "REVISE", from: HOST, action: "final-host" },
    ];

    const result = reduceMany(base, commands);
    expect(result.phase).toBe("ready_check");
    expect(readinessOf(result, HOST)?.actionText).toBe("final-host");
    expect(readinessOf(result, P2)?.actionText).toBe("final-2");
    expect(readinessOf(result, P3)?.status).toBe("not_ready");
  });

  it("a different interleaving converges to the same final submissions", () => {
    const base = started([HOST, P2, P3]);
    const reordered: Command[] = [
      { type: "PASS", from: P2, deadline: "d" },
      { type: "CONFIRM_ACTION", from: HOST, action: "draft", deadline: "d" },
      { type: "REVISE", from: HOST, action: "final-host" },
      { type: "REVISE", from: P2, action: null },
      { type: "CONFIRM_ACTION", from: P2, action: "final-2", deadline: "d" },
    ];
    const result = reduceMany(base, reordered);
    expect(result.phase).toBe("ready_check");
    expect(readinessOf(result, HOST)?.actionText).toBe("final-host");
    expect(readinessOf(result, P2)?.actionText).toBe("final-2");
  });

  it("once all players ready, the convergent state trips the resolution gate", () => {
    const base = started([HOST, P2]);
    const result = reduceMany(base, [
      { type: "CONFIRM_ACTION", from: HOST, action: "a", deadline: "d" },
      { type: "PASS", from: P2, deadline: "d" },
    ]);
    expect(result.phase).toBe("resolving");
    expect(result.resolutionRequested).toBe(true);
  });
});

describe("ended / terminal state (Task 10.3, R15.4/15.6/15.7)", () => {
  it("an ending condition during resolution sets phase=ended", () => {
    let state = started([HOST]);
    state = reduce(state, { type: "CONFIRM_ACTION", from: HOST, action: "final blow", deadline: null });
    expect(state.phase).toBe("resolving");
    state = reduce(state, {
      type: "RESOLUTION_READY",
      narration: "And so the tale ends.",
      checks: [sampleCheck],
      endingReached: true,
    });
    expect(state.phase).toBe("ended");
    expect(state.roundNumber).toBe(1); // no new round
    expect(state.checks).toEqual([sampleCheck]);
  });

  it("rejects START_SESSION (restart) on an ended state", () => {
    const ended = createInitialTurnState(ROOM, { phase: "ended", roundNumber: 5 });
    const next = reduce(ended, { type: "START_SESSION", by: HOST, hostId: HOST, activePlayers: [HOST, P2] });
    expect(next).toEqual(ended);
  });

  it("rejects further round-loop commands on an ended state", () => {
    const ended = createInitialTurnState(ROOM, {
      phase: "ended",
      roundNumber: 5,
      readiness: [{ playerId: HOST, status: "ready", actionKind: "pass", actionText: null }],
    });
    expect(reduce(ended, { type: "CONFIRM_ACTION", from: HOST, action: "x", deadline: null })).toEqual(ended);
    expect(reduce(ended, { type: "PASS", from: HOST, deadline: null })).toEqual(ended);
    expect(reduce(ended, { type: "REVISE", from: HOST, action: "x" })).toEqual(ended);
    expect(reduce(ended, { type: "FORCE_PROCEED", by: HOST, hostId: HOST })).toEqual(ended);
  });
});

describe("purity", () => {
  it("does not mutate the input state", () => {
    const state = started([HOST, P2]);
    const snapshot = JSON.parse(JSON.stringify(state));
    reduce(state, { type: "CONFIRM_ACTION", from: HOST, action: "go", deadline: "d" });
    expect(state).toEqual(snapshot);
  });
});
