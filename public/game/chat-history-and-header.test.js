// @ts-nocheck
/**
 * Reducer tests for F8 (chat-history rehydration on reconnect) and
 * F7 (hold the round/phase header until the result narration arrives).
 * Feature: game-play
 */
import { describe, it, expect } from "vitest";
import { reduce, createInitialState, Phase } from "./logic.js";

const handoff = { roomId: "r1", hostPlayerId: "h1", token: "t1" };

const ts = (state) => ({ type: "TURN_STATE", state });

describe("chat history rehydration (F8)", () => {
  it("seeds chatEntries from chatHistory on a fresh (reconnect) turn_state, then current chatLog", () => {
    let state = createInitialState(handoff);
    state = reduce(
      state,
      ts({
        roundNumber: 3,
        phase: "free_chat",
        readiness: [],
        chatHistory: [{ playerId: "p1", characterName: "Aria", text: "지난 잡담", ts: "t1" }],
        chatLog: [{ playerId: "p2", characterName: "Borin", text: "이번 잡담", ts: "t2" }],
      }),
    );
    expect(state.chatEntries.map((c) => c.text)).toEqual(["지난 잡담", "이번 잡담"]);
  });

  it("does not re-seed chatHistory once chat is already shown (no duplication on round advance)", () => {
    let state = createInitialState(handoff);
    // Live chat accumulated locally while connected.
    state = reduce(state, {
      type: "CHAT_MESSAGE",
      message: { playerId: "p1", characterName: "Aria", text: "이번 잡담", ts: "t2" },
    });
    // Round advances: server carries it into chatHistory and clears chatLog.
    state = reduce(
      state,
      ts({
        roundNumber: 2,
        phase: "free_chat",
        readiness: [],
        chatHistory: [{ playerId: "p1", characterName: "Aria", text: "이번 잡담", ts: "t2" }],
        chatLog: [],
      }),
    );
    expect(state.chatEntries.map((c) => c.text)).toEqual(["이번 잡담"]);
  });

  it("is a no-op when there is no chatHistory (round 1 / legacy)", () => {
    let state = createInitialState(handoff);
    state = reduce(state, ts({ roundNumber: 1, phase: "free_chat", readiness: [], chatLog: [] }));
    expect(state.chatEntries).toEqual([]);
  });
});

describe("header transition hold (F7)", () => {
  it("holds the round/phase header after a resolution advance until narration arrives", () => {
    let state = createInitialState(handoff);
    state = reduce(state, ts({ roundNumber: 1, phase: Phase.RESOLVING, readiness: [], chatLog: [] }));
    expect(state.headerRound).toBe(1);
    expect(state.headerPhase).toBe(Phase.RESOLVING);

    // Resolution done: turn_state advances to round 2 free_chat BEFORE narration.
    state = reduce(state, ts({ roundNumber: 2, phase: Phase.FREE_CHAT, readiness: [], chatLog: [] }));
    expect(state.roundNumber).toBe(2); // real state advanced
    expect(state.headerRound).toBe(1); // header held
    expect(state.headerPhase).toBe(Phase.RESOLVING);
    expect(state.pendingHeaderAdvance).toBe(true);

    // Narration arrives → header syncs to the new round/phase.
    state = reduce(state, { type: "NARRATION", kind: "resolution", roundNumber: 1, text: "결과 서사" });
    expect(state.headerRound).toBe(2);
    expect(state.headerPhase).toBe(Phase.FREE_CHAT);
    expect(state.pendingHeaderAdvance).toBe(false);
  });

  it("does not hold the header for a normal (non-resolution) transition", () => {
    let state = createInitialState(handoff);
    state = reduce(state, ts({ roundNumber: 1, phase: Phase.FREE_CHAT, readiness: [], chatLog: [] }));
    state = reduce(state, ts({ roundNumber: 1, phase: Phase.READY_CHECK, readiness: [], chatLog: [] }));
    expect(state.headerPhase).toBe(Phase.READY_CHECK);
    expect(state.pendingHeaderAdvance).toBe(false);
  });

  it("holds the header on an ending advance until the closing narration arrives", () => {
    let state = createInitialState(handoff);
    state = reduce(state, ts({ roundNumber: 2, phase: Phase.ROLLING, readiness: [], chatLog: [] }));
    state = reduce(state, ts({ roundNumber: 2, phase: Phase.ENDED, readiness: [], chatLog: [] }));
    expect(state.headerPhase).toBe(Phase.ROLLING); // held
    expect(state.pendingHeaderAdvance).toBe(true);
    state = reduce(state, { type: "NARRATION", kind: "closing", roundNumber: 2, text: "마무리" });
    expect(state.headerPhase).toBe(Phase.ENDED);
    expect(state.pendingHeaderAdvance).toBe(false);
  });
});
