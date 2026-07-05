// @ts-nocheck
import { describe, expect, it } from "vitest";
import { actionHistoryModel, createInitialState, reduce } from "./logic.js";

const handoff = { roomId: "r1", hostPlayerId: "h1", token: "" };

describe("game-play action history", () => {
  it("hydrates actionHistory from TURN_STATE and defaults missing payloads to []", () => {
    const s0 = createInitialState(handoff);
    const s1 = reduce(s0, {
      type: "TURN_STATE",
      state: {
        roomId: "r1",
        roundNumber: 2,
        phase: "free_chat",
        readiness: [],
        actionHistory: [{ round: 1, playerId: "h1", kind: "pass", text: null }],
      },
    });
    expect(s1.actionHistory).toEqual([{ round: 1, playerId: "h1", kind: "pass", text: null }]);

    const s2 = reduce(s1, { type: "TURN_STATE", state: { roundNumber: 3, phase: "free_chat" } });
    expect(s2.actionHistory).toEqual([]);
  });

  it("merges persisted history with current round readiness and applies name fallbacks", () => {
    const model = actionHistoryModel({
      roundNumber: 3,
      actionHistory: [
        {
          round: 1,
          playerId: "h1",
          kind: "confirmed_action",
          text: "파이를 엎는다",
          characterName: "알렉스",
          displayName: "라면",
        },
        { round: 2, playerId: "p2", kind: "auto_pass", text: null },
      ],
      readiness: [
        {
          playerId: "p3",
          status: "ready",
          actionKind: "confirmed_action",
          actionText: "울타리를 넘는다",
        },
      ],
      chatLog: [
        { playerId: "p2", characterName: "브리", displayName: "국수", text: "꽥", ts: "t1" },
        { playerId: "p3", characterName: "초록깃", displayName: "만두", text: "간다", ts: "t2" },
      ],
    });

    expect(model).toEqual([
      {
        round: 1,
        playerId: "h1",
        characterName: "알렉스",
        displayName: "라면",
        kind: "confirm",
        text: "파이를 엎는다",
        auto: false,
      },
      {
        round: 2,
        playerId: "p2",
        characterName: "브리",
        displayName: "국수",
        kind: "pass",
        text: null,
        auto: true,
      },
      {
        round: 3,
        playerId: "p3",
        characterName: "초록깃",
        displayName: "만두",
        kind: "confirm",
        text: "울타리를 넘는다",
        auto: false,
      },
    ]);
  });
});

  it("includes check_result history and live rolled checks", () => {
    const model = actionHistoryModel({
      roundNumber: 4,
      actionHistory: [
        { round: 3, playerId: "p1", kind: "check_result", text: null, attribute: "Wits", difficulty: "Average", roll: 2, outcome: "Success", characterName: "아리아" },
      ],
      readiness: [{ playerId: "p2", characterName: "보린", displayName: "면", status: "ready", actionKind: null, actionText: null }],
      rollingChecks: [
        { checkId: "c1", characterId: "char-p2", characterName: "보린", playerId: "p2", attribute: "Might", difficulty: "Hard", status: "rolled", roll: -1, outcome: "Partial Success" },
      ],
      chatLog: [],
    });

    expect(model).toContainEqual({
      round: 3,
      playerId: "p1",
      characterName: "아리아",
      displayName: "",
      kind: "check",
      attribute: "Wits",
      difficulty: "Average",
      roll: 2,
      outcome: "Success",
    });
    expect(model).toContainEqual({
      round: 4,
      playerId: "p2",
      characterName: "보린",
      displayName: "면",
      kind: "check",
      attribute: "Might",
      difficulty: "Hard",
      roll: -1,
      outcome: "Partial Success",
    });
  });
