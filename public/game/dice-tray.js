// @ts-check
/**
 * 주사위 트레이 UI 컴포넌트 (애니메이션 부수효과 계층)
 *
 * dice.js의 순수 계획(planRollSequence)을 받아 실제 DOM 주사위를 만들고,
 * "구르는 동안 면 숫자가 빠르게 바뀌다가 결과에 멈추는" 애니메이션을 순차로 실행한다.
 * 타이머·난수는 주입 가능하게 두어(가짜 타이머/난수) happy-dom 통합 테스트가 가능하다.
 *
 * CSS(주사위 모양·흔들림 키프레임)는 이 컴포넌트를 마운트하는 페이지가 제공한다
 * (dice-demo.html / game/index.html). 클래스 계약:
 *   .dice-die                 한 주사위 컨테이너
 *   .dice-die[data-sides=N]   면 수별 모양/색
 *   .dice-die.rolling         구르는 중(흔들림 애니메이션)
 *   .dice-die.settled         멈춤
 *   .dice-die.emphasis        중요 이벤트 강조(더 큰 흔들림)
 *   .dice-die.crit / .fumble  d20 극단값 강조
 *   .dice-face                숫자 표시 영역
 *   .dice-type                "d20" 같은 종류 라벨
 *   .dice-label               표시용 라벨(선택)
 */
import { planRollSequence, randomFace, sequenceTotalMs } from "./dice.js";

/**
 * 주사위 트레이를 루트 요소에 마운트한다.
 *
 * @param {HTMLElement} rootEl 주사위를 그릴 컨테이너
 * @param {{
 *   rng?: () => number,
 *   setTimeout?: (fn: () => void, ms: number) => any,
 *   clearTimeout?: (id: any) => void,
 *   setInterval?: (fn: () => void, ms: number) => any,
 *   clearInterval?: (id: any) => void,
 *   gapMs?: number,
 * }} [options]
 * @returns {{
 *   rollSequence: (specs: import("./dice.js").DieSpec[]) => Promise<import("./dice.js").PlannedRoll[]>,
 *   roll: (sides: number, opts?: Partial<import("./dice.js").DieSpec>) => Promise<import("./dice.js").PlannedRoll[]>,
 *   clear: () => void,
 *   cancel: () => void,
 * }}
 */
export function createDiceTray(rootEl, options = {}) {
  const rng = options.rng || Math.random;
  const setTimeoutImpl = options.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const clearTimeoutImpl = options.clearTimeout || ((id) => clearTimeout(id));
  const setIntervalImpl = options.setInterval || ((fn, ms) => setInterval(fn, ms));
  const clearIntervalImpl = options.clearInterval || ((id) => clearInterval(id));
  const gapMs = options.gapMs;

  const doc = rootEl.ownerDocument || document;

  /** 진행 중인 모든 타이머 핸들(취소·정리용). */
  let timers = [];
  /** 면 깜빡임 인터벌 핸들. */
  let intervals = [];

  function track(id) {
    timers.push(id);
    return id;
  }
  function trackInterval(id) {
    intervals.push(id);
    return id;
  }

  /** 진행 중인 모든 애니메이션을 멈춘다(결과는 건드리지 않음). */
  function cancel() {
    for (const id of timers) clearTimeoutImpl(id);
    for (const id of intervals) clearIntervalImpl(id);
    timers = [];
    intervals = [];
  }

  /** 트레이를 비운다. */
  function clear() {
    cancel();
    rootEl.replaceChildren();
  }

  /**
   * 한 주사위 DOM 요소를 만든다(초기 idle 상태: 종류 라벨 + "?" 면).
   * @param {import("./dice.js").PlannedRoll} plan
   */
  function makeDieEl(plan) {
    const die = doc.createElement("div");
    die.className = "dice-die";
    die.setAttribute("data-sides", String(plan.sides));
    if (plan.emphasis) die.classList.add("emphasis");
    die.setAttribute("role", "img");
    die.setAttribute(
      "aria-label",
      `${plan.label ? plan.label + " " : ""}d${plan.sides} 주사위, 굴리는 중`,
    );

    const type = doc.createElement("span");
    type.className = "dice-type";
    type.textContent = `d${plan.sides}`;

    const face = doc.createElement("span");
    face.className = "dice-face";
    face.textContent = "?";

    die.appendChild(type);
    die.appendChild(face);

    if (plan.label) {
      const label = doc.createElement("span");
      label.className = "dice-label";
      label.textContent = plan.label;
      die.appendChild(label);
    }
    return { die, face };
  }

  /**
   * 계획된 시퀀스를 순차로 굴린다. 각 주사위는 자기 startAtMs에 구르기 시작하고
   * settleAtMs에 결과로 멈춘다. 모든 주사위가 멈추면 resolve 한다.
   *
   * @param {import("./dice.js").DieSpec[]} specs
   * @returns {Promise<import("./dice.js").PlannedRoll[]>}
   */
  function rollSequence(specs) {
    clear();
    const plans = planRollSequence(specs, { rng, gapMs });

    // 모든 주사위 요소를 미리 그려 둔다(idle). 이후 각자 시각에 굴린다.
    const faces = plans.map((plan) => {
      const { die, face } = makeDieEl(plan);
      rootEl.appendChild(die);
      return { plan, die, face };
    });

    return new Promise((resolve) => {
      for (const { plan, die, face } of faces) {
        // 1) startAtMs: 구르기 시작 — 흔들림 클래스 + 면 깜빡임 인터벌 시작.
        track(
          setTimeoutImpl(() => {
            die.classList.add("rolling");
            const interval = setIntervalImpl(() => {
              face.textContent = String(randomFace(plan.sides, rng));
            }, plan.intervalMs);
            trackInterval(interval);

            // 2) durationMs 뒤(=settleAtMs): 멈추고 결과 확정.
            track(
              setTimeoutImpl(() => {
                clearIntervalImpl(interval);
                die.classList.remove("rolling");
                die.classList.add("settled");
                face.textContent = String(plan.result);
                if (plan.criticality === "crit") die.classList.add("crit");
                else if (plan.criticality === "fumble") die.classList.add("fumble");
                die.setAttribute(
                  "aria-label",
                  `${plan.label ? plan.label + " " : ""}d${plan.sides} 주사위 결과 ${plan.result}` +
                    (plan.criticality === "crit"
                      ? ", 대성공"
                      : plan.criticality === "fumble"
                        ? ", 대실패"
                        : ""),
                );
              }, plan.durationMs),
            );
          }, plan.startAtMs),
        );
      }

      // 전체 시퀀스 종료 시 resolve.
      const totalMs = sequenceTotalMs(plans);
      track(
        setTimeoutImpl(() => {
          resolve(plans);
        }, totalMs),
      );
    });
  }

  /**
   * 단일 주사위 굴림 편의 함수.
   * @param {number} sides
   * @param {Partial<import("./dice.js").DieSpec>} [opts]
   */
  function roll(sides, opts = {}) {
    return rollSequence([{ sides, ...opts }]);
  }

  return { rollSequence, roll, clear, cancel };
}
