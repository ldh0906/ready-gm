// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
  canRollCheck,
  ConnectionStatus,
  createInitialState,
  eventToAction,
  narrationFailureMessage,
  Phase,
  reduce,
} from "./logic.js";

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
        rollCheckDeadline: "2030-01-01T00:00:00.000Z",
      },
    });

    expect(state.phase).toBe(Phase.ROLLING);
    expect(state.rollingChecks).toStrictEqual([pendingCheck]);
    expect(state.rollCheckDeadline).toBe("2030-01-01T00:00:00.000Z");
  });

  it("maps pending and rolled events into rolling check state", () => {
    let state = createInitialState(handoff);
    state = reduce(state, {
      type: "NARRATION_FAILED",
      phase: "resolution",
      retrying: true,
    });
    expect(state.narrationFailedNotice).toBe(
      "GM이 결과를 쓰다 실패해 자동으로 다시 시도합니다. 판정이 다시 나타나면 한 번 더 굴려 주세요.",
    );

    const pendingAction = eventToAction({ type: "checks_pending", checks: [pendingCheck] });
    state = reduce(state, pendingAction);

    expect(state.rollingChecks).toStrictEqual([pendingCheck]);
    expect(state.narrationFailedNotice).toBeNull();

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

  it("maps retrying narration failures to the retry guidance action", () => {
    const action = eventToAction({
      type: "narration_failed",
      phase: "resolution",
      reason: "model timeout",
      retryable: true,
      retrying: true,
    });

    expect(action).toStrictEqual({
      type: "NARRATION_FAILED",
      phase: "resolution",
      retryable: true,
      retrying: true,
    });
    expect(narrationFailureMessage("resolution", true)).toBe(
      "GM이 결과를 쓰다 실패해 자동으로 다시 시도합니다. 판정이 다시 나타나면 한 번 더 굴려 주세요.",
    );
  });
});

describe("canRollCheck (rolling-phase roll button gate)", () => {
  // 전역 입력 잠금(isInputLocked)은 rolling에서 채팅을 잠그지만, 굴리기 버튼은
  // rolling에서만 활성이어야 한다 — canSend() 게이팅으로 버튼이 항상 죽던 회귀 가드.
  const rollableState = {
    handoffValid: true,
    turnReceived: true,
    ended: false,
    connection: ConnectionStatus.OPEN,
    phase: Phase.ROLLING,
  };

  it("allows rolling while connected in the rolling phase", () => {
    expect(canRollCheck(rollableState)).toBe(true);
  });

  it("hydrated rolling turn_state yields a rollable state", () => {
    let state = createInitialState(handoff);
    state = reduce(state, { type: "CONNECTION_OPENED" });
    state = reduce(state, {
      type: "TURN_STATE",
      state: {
        roundNumber: 1,
        phase: Phase.ROLLING,
        readiness: [],
        chatLog: [],
        rollingChecks: [pendingCheck],
      },
    });
    expect(canRollCheck(state)).toBe(true);
  });

  it("denies rolling outside the rolling phase", () => {
    expect(canRollCheck({ ...rollableState, phase: Phase.FREE_CHAT })).toBe(false);
    expect(canRollCheck({ ...rollableState, phase: Phase.RESOLVING })).toBe(false);
    expect(canRollCheck({ ...rollableState, phase: null })).toBe(false);
  });

  it("denies rolling when disconnected, ended, or before the first turn_state", () => {
    expect(canRollCheck({ ...rollableState, connection: ConnectionStatus.DISCONNECTED })).toBe(false);
    expect(canRollCheck({ ...rollableState, ended: true })).toBe(false);
    expect(canRollCheck({ ...rollableState, turnReceived: false })).toBe(false);
    expect(canRollCheck({ ...rollableState, handoffValid: false })).toBe(false);
    expect(canRollCheck(null)).toBe(false);
  });
});
