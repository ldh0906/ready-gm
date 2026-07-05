// @vitest-environment happy-dom
// @ts-nocheck
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeRollingCheck,
  canRollCheck,
  ConnectionStatus,
  createInitialState,
  eventToAction,
  narrationFailureMessage,
  Phase,
  reduce,
} from "./logic.js";
import { createChecksView } from "./views/checks.js";

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

const spectatorCheck = {
  ...pendingCheck,
  checkId: "round-1-check-a",
  characterId: "c-a",
  characterName: "Ari",
  playerId: "p-other",
};

const ownSecondCheck = {
  ...pendingCheck,
  checkId: "round-1-check-b",
  characterId: "c-b",
  characterName: "Bex",
  playerId: "p-host",
  attribute: "Might",
};

function div(id, className = "") {
  const el = document.createElement("div");
  el.id = id;
  el.className = className;
  return el;
}

function setupChecksView(initialState) {
  vi.useFakeTimers();
  const checkBar = div("checkBar");
  const rollCountdownEl = div("rollCountdown");
  const checkTray = div("checkTray");
  const rollRitualEl = div("rollRitual", "roll-ritual");
  rollRitualEl.hidden = true;
  rollRitualEl.appendChild(div("", "ritual-stage"));
  document.body.replaceChildren(checkBar, rollCountdownEl, checkTray, rollRitualEl);
  let state = initialState;
  const commands = [];
  const view = createChecksView({
    els: { checkBar, rollCountdownEl, checkTray, rollRitualEl },
    helpers: {
      textSpan: (className, text) => {
        const span = document.createElement("span");
        span.className = className;
        span.textContent = text;
        return span;
      },
      frand: () => 0,
      fsign: (value) => (value > 0 ? `+${value}` : String(value)),
      now: () => Date.parse("2030-01-01T00:00:00.000Z"),
      prefersReducedMotion: () => true,
    },
    getState: () => state,
    sendCommand: (cmd) => {
      commands.push(cmd);
      return true;
    },
    getViewerPlayerId: () => "p-host",
  });
  return {
    view,
    commands,
    checkBar,
    checkTray,
    rollRitualEl,
    setState: (next) => {
      state = next;
    },
  };
}

afterEach(() => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.replaceChildren();
});

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

  it("carries sceneLocation from turn_state as a display-only string", () => {
    const state = reduce(createInitialState(handoff), {
      type: "TURN_STATE",
      state: {
        roundNumber: 1,
        phase: Phase.FREE_CHAT,
        readiness: [],
        chatLog: [],
        sceneLocation: "검은 숲 입구",
      },
    });

    expect(state.sceneLocation).toBe("검은 숲 입구");

    const cleared = reduce(state, {
      type: "TURN_STATE",
      state: {
        roundNumber: 1,
        phase: Phase.FREE_CHAT,
        readiness: [],
        chatLog: [],
        sceneLocation: 123,
      },
    });
    expect(cleared.sceneLocation).toBeNull();
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

describe("activeRollingCheck", () => {
  it("returns the first unrolled check and null when all are rolled", () => {
    expect(activeRollingCheck({ rollingChecks: [{ status: "rolled" }, spectatorCheck] })).toBe(spectatorCheck);
    expect(activeRollingCheck({ rollingChecks: [{ status: "rolled" }] })).toBeNull();
  });
});

describe("shared sequential roll overlay", () => {
  function rollingState(checks) {
    return {
      ...createInitialState(handoff),
      handoffValid: true,
      turnReceived: true,
      connection: ConnectionStatus.OPEN,
      phase: Phase.ROLLING,
      rollingChecks: checks,
      rollCheckDeadline: "2030-01-01T00:00:05.000Z",
    };
  }

  it("opens the active non-owner check as a spectator overlay without a roll button", () => {
    const { view, rollRitualEl } = setupChecksView(rollingState([spectatorCheck, ownSecondCheck]));

    view.renderRollingChecks();

    expect(rollRitualEl.hidden).toBe(false);
    expect(rollRitualEl.textContent).toContain("Ari");
    expect(rollRitualEl.textContent).toContain("굴리는 중");
    expect(rollRitualEl.textContent).toContain("5초 후 자동 굴림");
    expect(rollRitualEl.querySelector(".ritual-roll-btn")).toBeNull();
  });

  it("shows another player's rolled result, then relays to the viewer's active check", () => {
    const initial = rollingState([spectatorCheck, ownSecondCheck]);
    const { view, rollRitualEl, setState } = setupChecksView(initial);
    view.renderRollingChecks();

    const rolledA = {
      ...spectatorCheck,
      status: "rolled",
      roll: 2,
      rolls: [2],
      outcome: "Success",
    };
    setState(rollingState([rolledA, ownSecondCheck]));
    view.animateRolledCheck(rolledA);

    expect(rollRitualEl.textContent).toContain("+2");
    expect(rollRitualEl.textContent).toContain("결과 성공");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(rollRitualEl.hidden).toBe(false);
    expect(rollRitualEl.textContent).toContain("Bex");
    expect(rollRitualEl.textContent).toContain("굴리기");
    expect(rollRitualEl.querySelector(".ritual-roll-btn")).not.toBeNull();
  });

  it("marks the active owner in the status bar and only shows reopen on the viewer's turn", () => {
    const { view, checkTray, setState } = setupChecksView(rollingState([spectatorCheck, ownSecondCheck]));

    view.renderRollingChecks();
    expect(checkTray.textContent).toContain("🎲 Ari 차례");
    expect(checkTray.textContent).toContain("Bex 대기");
    expect(checkTray.querySelector(".reopen-roll-btn")).toBeNull();

    setState(rollingState([{ ...spectatorCheck, status: "rolled" }, ownSecondCheck]));
    view.renderRollingChecks();

    expect(checkTray.textContent).toContain("🎲 Bex 차례");
    expect(checkTray.querySelector(".reopen-roll-btn")).not.toBeNull();
  });

  it("keeps the spectator overlay visible and displays results immediately with reduced motion", () => {
    const { view, rollRitualEl, setState } = setupChecksView(rollingState([spectatorCheck]));
    view.renderRollingChecks();

    expect(rollRitualEl.hidden).toBe(false);
    expect(rollRitualEl.textContent).toContain("굴리는 중");

    const rolled = {
      ...spectatorCheck,
      status: "rolled",
      autoRolled: true,
      roll: -1,
      rolls: [-1],
      outcome: "Failure",
    };
    setState(rollingState([rolled]));
    view.animateRolledCheck(rolled);

    expect(rollRitualEl.hidden).toBe(false);
    expect(rollRitualEl.textContent).toContain("-1");
    expect(rollRitualEl.textContent).toContain("결과 실패");
  });
});
