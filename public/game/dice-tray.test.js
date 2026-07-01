// @vitest-environment happy-dom
// @ts-nocheck
/**
 * 주사위 트레이(dice-tray.js)에 대한 DOM/통합 테스트(happy-dom).
 * Feature: game-dice
 *
 * 애니메이션은 타이머에 의존하므로 실제 타이머 대신 "수동 가짜 스케줄러"를 주입한다.
 * 가상 시계(advance)로 시간을 결정적으로 진행시켜 굴림 시작(.rolling) → 멈춤(.settled)
 * → 결과 면/극단값(.crit/.fumble) 전이를 검증한다. 난수는 ()=>0 으로 고정해
 * rollDie(sides, ()=>0) === 1 이 되도록 하여 중간 프레임/결과를 예측 가능하게 만든다.
 *
 * Covers:
 * - Test A: 단일 주사위가 결과로 멈춘다(.rolling → .settled, d20 crit)
 * - Test B: 시퀀스는 순차적(첫 주사위 멈춘 뒤 다음이 시작)
 * - Test C: clear()는 비우고 cancel()은 타이머를 멈춘다
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createDiceTray } from "./dice-tray.js";

/**
 * 수동 가짜 스케줄러: 가상 시계 + 큐잉된 timeout/interval.
 * advance(ms)는 시간 순서대로 due 타이머와 인터벌 틱을 발화한다.
 */
function createFakeScheduler() {
  let now = 0;
  let seq = 0;
  /** @type {Map<number, {at:number, fn:Function}>} */
  const timeouts = new Map();
  /** @type {Map<number, {everyMs:number, fn:Function, lastFired:number}>} */
  const intervals = new Map();

  function setTimeoutImpl(fn, ms) {
    const id = ++seq;
    timeouts.set(id, { at: now + Math.max(0, ms || 0), fn });
    return id;
  }
  function clearTimeoutImpl(id) {
    timeouts.delete(id);
  }
  function setIntervalImpl(fn, ms) {
    const id = ++seq;
    intervals.set(id, { everyMs: Math.max(1, ms || 1), fn, lastFired: now });
    return id;
  }
  function clearIntervalImpl(id) {
    intervals.delete(id);
  }

  /**
   * 목표 시각까지 진행한다. 매 스텝마다 (due timeout, due interval tick) 중
   * 가장 이른 이벤트를 골라 그 시각으로 시계를 옮기고 발화한다.
   */
  function advance(ms) {
    const target = now + ms;
    // 안전 가드: 무한 루프 방지.
    let guard = 0;
    for (;;) {
      if (++guard > 1_000_000) throw new Error("advance: too many iterations");

      // 다음 due timeout(target 이하 중 가장 이른 것).
      let nextTimeout = null;
      for (const [id, t] of timeouts) {
        if (t.at <= target && (nextTimeout === null || t.at < nextTimeout.at)) {
          nextTimeout = { id, at: t.at, fn: t.fn };
        }
      }

      // 다음 due interval tick(target 이하 중 가장 이른 것).
      let nextInterval = null;
      for (const [id, iv] of intervals) {
        const at = iv.lastFired + iv.everyMs;
        if (at <= target && (nextInterval === null || at < nextInterval.at)) {
          nextInterval = { id, at };
        }
      }

      if (nextTimeout === null && nextInterval === null) {
        break; // target 이하에 발화할 이벤트 없음.
      }

      // 더 이른 이벤트를 발화한다. 동시각이면 interval을 먼저(면 깜빡임이 멈춤보다 앞서도록).
      if (nextInterval !== null && (nextTimeout === null || nextInterval.at <= nextTimeout.at)) {
        now = nextInterval.at;
        const iv = intervals.get(nextInterval.id);
        if (iv) {
          iv.lastFired = nextInterval.at;
          iv.fn();
        }
      } else {
        now = nextTimeout.at;
        // 발화 전에 큐에서 제거(중복 방지).
        timeouts.delete(nextTimeout.id);
        nextTimeout.fn();
      }
    }
    now = target;
  }

  return {
    setTimeout: setTimeoutImpl,
    clearTimeout: clearTimeoutImpl,
    setInterval: setIntervalImpl,
    clearInterval: clearIntervalImpl,
    advance,
    get now() {
      return now;
    },
    get pendingTimeouts() {
      return timeouts.size;
    },
    get pendingIntervals() {
      return intervals.size;
    },
  };
}

/** 마이크로태스크 플러시(Promise resolve 콜백 처리). */
const flush = () => Promise.resolve();

describe("game-dice DOM 통합 테스트 — dice-tray.js", () => {
  let root;
  let scheduler;

  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement("div");
    root.id = "tray";
    document.body.appendChild(root);
    scheduler = createFakeScheduler();
  });

  function makeTray(extra = {}) {
    return createDiceTray(root, {
      rng: () => 0, // 결정적: rollDie(sides, ()=>0) === 1, 중간 프레임도 1.
      setTimeout: scheduler.setTimeout,
      clearTimeout: scheduler.clearTimeout,
      setInterval: scheduler.setInterval,
      clearInterval: scheduler.clearInterval,
      ...extra,
    });
  }

  it("Test A: 단일 d20이 result로 멈춘다(.rolling → .settled, crit)", async () => {
    const tray = makeTray();
    tray.roll(20, { result: 20 });

    // 주사위 요소가 즉시 그려진다(idle).
    const die = root.querySelector('.dice-die[data-sides="20"]');
    expect(die, "d20 주사위 요소가 존재해야 한다").not.toBeNull();
    expect(die.querySelector(".dice-type").textContent).toBe("d20");
    // startAtMs(=0) 전이지만 normal duration=1000. 시작 타이머가 0ms이므로 살짝 진행해 .rolling 확인.
    expect(die.classList.contains("rolling")).toBe(false);

    // 굴림 시작 직후(중간): .rolling 이며 아직 .settled 아님.
    scheduler.advance(500); // normal duration 1000의 중간.
    expect(die.classList.contains("rolling")).toBe(true);
    expect(die.classList.contains("settled")).toBe(false);

    // settle 시각(1000ms)까지 진행: 멈추고 결과 20 + crit.
    scheduler.advance(500);
    expect(die.classList.contains("rolling")).toBe(false);
    expect(die.classList.contains("settled")).toBe(true);
    expect(die.classList.contains("crit")).toBe(true);
    expect(die.querySelector(".dice-face").textContent).toBe("20");
  });

  it("Test B: 시퀀스는 순차적 — 첫 주사위 멈춘 뒤 두 번째가 시작/멈춘다", async () => {
    const tray = makeTray({ gapMs: 220 });
    const promise = tray.rollSequence([
      { sides: 6, result: 3 },
      { sides: 20, result: 1 },
    ]);

    // 두 주사위 모두 미리 그려진다.
    const dice = root.querySelectorAll(".dice-die");
    expect(dice.length).toBe(2);
    const first = dice[0];
    const second = dice[1];
    expect(first.getAttribute("data-sides")).toBe("6");
    expect(second.getAttribute("data-sides")).toBe("20");

    // 첫 주사위(normal: 1000ms)가 멈출 때까지 진행.
    // 이 시점에 두 번째는 아직 시작 전(startAt = 1000 + 220 = 1220)이라 .rolling/.settled 아님.
    scheduler.advance(1000);
    expect(first.classList.contains("settled")).toBe(true);
    expect(first.querySelector(".dice-face").textContent).toBe("3");
    expect(second.classList.contains("settled")).toBe(false);
    expect(second.classList.contains("rolling")).toBe(false);

    // gap(220) 동안에도 두 번째는 시작하지 않는다.
    scheduler.advance(219);
    expect(second.classList.contains("rolling")).toBe(false);

    // 두 번째 시작 시각(1220) 통과 → .rolling.
    scheduler.advance(1); // now = 1220
    expect(second.classList.contains("rolling")).toBe(true);
    expect(second.classList.contains("settled")).toBe(false);

    // 두 번째 settle(1220 + 1000 = 2220)까지 진행 → 결과 1 + fumble.
    scheduler.advance(1000);
    expect(second.classList.contains("settled")).toBe(true);
    expect(second.classList.contains("fumble")).toBe(true);
    expect(second.querySelector(".dice-face").textContent).toBe("1");

    // 전체 시퀀스 종료 후 promise는 plans로 resolve된다.
    scheduler.advance(10); // 남은 resolve 타이머 여유 진행.
    await flush();
    const plans = await promise;
    expect(Array.isArray(plans)).toBe(true);
    expect(plans.length).toBe(2);
    expect(plans[0].result).toBe(3);
    expect(plans[1].result).toBe(1);
    // 순차 보장: 두 번째 시작 > 첫 번째 멈춤 + gap.
    expect(plans[1].startAtMs).toBe(plans[0].settleAtMs + 220);
  });

  it("Test C: clear()는 트레이를 비우고 cancel()은 타이머를 멈춘다", async () => {
    const tray = makeTray();
    tray.roll(20, { result: 20 });

    // 굴림 시작.
    scheduler.advance(100);
    const die = root.querySelector(".dice-die");
    expect(die).not.toBeNull();
    expect(die.classList.contains("rolling")).toBe(true);

    // cancel(): 더 이상 면이 갱신되지 않는다(인터벌 정지).
    const faceBefore = die.querySelector(".dice-face").textContent;
    tray.cancel();
    expect(scheduler.pendingTimeouts).toBe(0);
    expect(scheduler.pendingIntervals).toBe(0);
    scheduler.advance(5000); // 시간을 한참 진행해도
    expect(die.querySelector(".dice-face").textContent).toBe(faceBefore); // 변화 없음
    expect(die.classList.contains("settled")).toBe(false); // settle도 일어나지 않음

    // clear(): 루트를 비운다.
    tray.clear();
    expect(root.children.length).toBe(0);
    expect(root.querySelector(".dice-die")).toBeNull();
  });
});
