// @ts-nocheck
import { describe, expect, it } from "vitest";
import { createInitialState, eventToAction, Phase, reduce } from "./logic.js";

const handoff = {
  roomId: "room-1",
  hostPlayerId: "p-host",
  playerId: "p-host",
  token: "",
  ticket: "ticket-1",
};

const pendingCheck = {
  checkId: "round-1-check-1",
  characterId: "c-1",
  characterName: "Ada",
  playerId: "p-host",
  attribute: "Wits",
  difficulty: "Average",
  advantage: "none",
  visibility: "player",
  status: "pending",
};

describe("game-play two-phase check rolling", () => {
  it("hydrates pending checks from turn_state for reconnect", () => {
    const state = reduce(createInitialState(handoff), {
      type: "TURN_STATE",
      state: {
        roundNumber: 1,
        phase: Phase.ROLLING,
        readiness: [],
        chatLog: [],
        rollingChecks: [pendingCheck],
      },
    });

    expect(state.phase).toBe(Phase.ROLLING);
    expect(state.rollingChecks).toStrictEqual([pendingCheck]);
  });

  it("maps pending and rolled events into rolling check state", () => {
    let state = createInitialState(handoff);
    const pendingAction = eventToAction({ type: "checks_pending", checks: [pendingCheck] });
    state = reduce(state, pendingAction);

    expect(state.rollingChecks).toStrictEqual([pendingCheck]);

    const rolled = {
      ...pendingCheck,
      status: "rolled",
      roll: 2,
      rolls: [2],
      outcome: "Success",
    };
    state = reduce(state, eventToAction({ type: "check_rolled", check: rolled }));

    expect(state.rollingChecks).toStrictEqual([rolled]);
  });
});
