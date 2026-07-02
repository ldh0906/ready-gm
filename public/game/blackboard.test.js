// @ts-nocheck
import { describe, expect, it } from "vitest";
import { createInitialState, describeBlackboard, eventToAction, reduce } from "./logic.js";

const handoff = { roomId: "r1", hostPlayerId: "h1", token: "" };

describe("game-play blackboard projection", () => {
  it("normalizes only visible clues, NPCs, threats, and flags", () => {
    const projection = describeBlackboard({
      clues: [
        { id: "c1", conclusion: "봉인은 안쪽에서 깨졌다.", redundantPathGroup: "seal" },
        { id: "bad", truth: "hidden secret", conclusion: "" },
      ],
      npcs: [{ npcId: "n1", name: "사제", role: "목격자", location: "예배당", knownSecretIds: ["s1"] }],
      activeThreats: [{ id: "t1", name: "차가운 안개", status: "pressing" }],
      worldFlags: [{ key: "alarm", value: true }],
      secrets: [{ id: "s1", truth: "must not render" }],
    });

    expect(projection.clues).toEqual([{ id: "c1", conclusion: "봉인은 안쪽에서 깨졌다.", redundantPathGroup: "seal" }]);
    expect(JSON.stringify(projection)).not.toContain("hidden secret");
    expect(JSON.stringify(projection)).not.toContain("knownSecretIds");
  });

  it("stores blackboard from reconnect turn_state and narration payload updates", () => {
    const s0 = createInitialState(handoff);
    const s1 = reduce(s0, {
      type: "TURN_STATE",
      state: {
        roomId: "r1",
        roundNumber: 1,
        phase: "free_chat",
        readiness: [],
        chatLog: [],
        narrativeContext: [],
        checks: [],
        readyCheckDeadline: null,
        resolutionRequested: false,
        blackboard: { clues: [{ id: "c1", conclusion: "단서" }], npcs: [], activeThreats: [], worldFlags: [] },
      },
    });
    expect(s1.blackboard.clues[0].conclusion).toBe("단서");

    const action = eventToAction({
      type: "narration",
      narration: {
        kind: "resolution",
        roundNumber: 1,
        text: "진행",
        blackboard: { clues: [{ id: "c2", conclusion: "새 단서" }], npcs: [], activeThreats: [], worldFlags: [] },
      },
    });
    const s2 = reduce(s1, action);
    expect(s2.blackboard.clues[0].conclusion).toBe("새 단서");
  });
});
