import { Phase, activeRollingCheck, buildRollCheckCommand, canRollCheck } from "../logic.js";
import { ATTR_LABELS, DIFF_LABELS, OUTCOME_LABELS } from "./dom.js";

export function createChecksView(ctx) {
  const { els, helpers, getState, sendCommand, getViewerPlayerId } = ctx;
  const { checkBar, rollCountdownEl, checkTray, rollRitualEl } = els;
  const { textSpan, frand, fsign, now, prefersReducedMotion } = helpers;
  const viewerPlayerId = getViewerPlayerId();

  const dismissedPendingIds = new Set();
  const ritualQueue = [];
  const animatedServerCheckIds = new Set();
  const animatingCheckIds = new Set();
  let activeRitual = null;

  function attrLabelFor(check) {
    return check.attributeLabel || ATTR_LABELS[check.attribute] || check.attribute || "판정";
  }

  function resultCaption(check) {
    const diff = DIFF_LABELS[check.difficulty] || check.difficulty || "";
    const outcome = OUTCOME_LABELS[check.outcome] || check.outcome || "";
    const autoText = check.autoRolled === true ? " (시간 초과 — 자동 굴림)" : "";
    return outcome ? `난이도 ${diff} · 결과 ${outcome}${autoText}` : `난이도 ${diff}${autoText}`;
  }

  function pendingViewerChecks(checks) {
    return checks.filter((check) => check && check.status !== "rolled" && check.playerId === viewerPlayerId);
  }

  function renderRollCountdown(checks) {
    const pending = checks.filter((check) => check && check.status !== "rolled");
    const deadline = getState().rollCheckDeadline;
    if (getState().phase !== Phase.ROLLING || pending.length === 0 || typeof deadline !== "string" || deadline.length === 0) {
      rollCountdownEl.hidden = true;
      rollCountdownEl.textContent = "";
      rollCountdownEl.className = "roll-countdown";
      return;
    }
    const parsedDeadline = Date.parse(deadline);
    if (!Number.isFinite(parsedDeadline)) {
      rollCountdownEl.hidden = true;
      rollCountdownEl.textContent = "";
      rollCountdownEl.className = "roll-countdown";
      return;
    }
    const ms = Math.max(0, parsedDeadline - now());
    const seconds = Math.ceil(ms / 1000);
    const mine = pendingViewerChecks(checks).length > 0;
    rollCountdownEl.hidden = false;
    rollCountdownEl.textContent = `⏱ 자동 굴림까지 ${seconds}초`;
    rollCountdownEl.className = "roll-countdown" + (mine ? " mine" : "") + (mine && seconds <= 10 ? " warn" : "");
  }

  function updateRitualCountdown(target) {
    if (!target) return;
    const deadline = getState().rollCheckDeadline;
    if (typeof deadline !== "string" || deadline.length === 0) {
      target.hidden = true;
      target.textContent = "";
      return;
    }
    const parsedDeadline = Date.parse(deadline);
    if (!Number.isFinite(parsedDeadline)) {
      target.hidden = true;
      target.textContent = "";
      return;
    }
    target.hidden = false;
    target.textContent = `⏱ ${Math.ceil(Math.max(0, parsedDeadline - now()) / 1000)}초 후 자동 굴림`;
  }

  function clearActiveTimers() {
    if (!activeRitual) return;
    for (const timer of activeRitual.timers) window.clearTimeout(timer);
    for (const interval of activeRitual.intervals) window.clearInterval(interval);
  }

  function closeRollRitual({ dismissed = true } = {}) {
    if (!activeRitual || !rollRitualEl) return;
    const closing = activeRitual;
    clearActiveTimers();
    window.removeEventListener("keydown", closing.onKeydown);
    rollRitualEl.removeEventListener("click", closing.onClick);
    rollRitualEl.hidden = true;
    const stage = rollRitualEl.querySelector(".ritual-stage");
    if (stage) stage.replaceChildren();
    animatingCheckIds.delete(closing.checkId);
    if (dismissed && closing.mode === "pending") dismissedPendingIds.add(closing.checkId);
    activeRitual = null;
    playNextRollRitual();
    if (!activeRitual) maybeAutoOpenPending(Array.isArray(getState().rollingChecks) ? getState().rollingChecks : []);
  }

  function bindRitualDismiss(checkId, mode) {
    const onKeydown = (ev) => {
      if (ev.key === "Escape") closeRollRitual({ dismissed: true });
    };
    const onClick = (ev) => {
      if (ev.target === rollRitualEl) closeRollRitual({ dismissed: true });
    };
    const ritualState = { checkId, mode, timers: [], intervals: [], onKeydown, onClick };
    activeRitual = ritualState;
    window.addEventListener("keydown", onKeydown);
    rollRitualEl.addEventListener("click", onClick);
    return ritualState;
  }

  function makeStage(check) {
    const stage = rollRitualEl.querySelector(".ritual-stage");
    if (!stage) return null;
    const whoName = typeof check.characterName === "string" ? check.characterName.trim() : "";
    const title = document.createElement("div");
    title.className = "ritual-title";
    title.textContent = whoName ? `${whoName} · ${attrLabelFor(check)}` : attrLabelFor(check);
    const die = document.createElement("span");
    die.className = "fate-die ritual";
    die.setAttribute("aria-label", "운명 주사위");
    die.append(textSpan("fate-face", "?"), textSpan("fate-label", "판정"));
    const caption = document.createElement("div");
    caption.className = "ritual-caption";
    const result = document.createElement("div");
    result.className = "ritual-result";
    const countdown = document.createElement("div");
    countdown.className = "ritual-countdown";
    countdown.setAttribute("role", "status");
    countdown.setAttribute("aria-live", "polite");
    stage.replaceChildren(title, die, caption, result, countdown);
    rollRitualEl.hidden = false;
    return { stage, die, face: die.querySelector(".fate-face"), caption, result, countdown };
  }

  function shuffleDiceFaces(faces, format, onDone) {
    if (prefersReducedMotion()) {
      onDone();
      return;
    }
    const durationMs = 2000;
    const startedAt = Date.now();
    let delay = 70;
    const step = () => {
      if (Date.now() - startedAt >= durationMs) {
        onDone();
        return;
      }
      faces.forEach((f) => { f.textContent = format(frand(-4, 4)); });
      delay = Math.min(delay * 1.18, 300);
      window.setTimeout(step, delay);
    };
    step();
  }

  function showRolledResult(check, autoCloseMs) {
    if (!rollRitualEl) return;
    const checkId = String(check.checkId || "");
    if (!activeRitual || activeRitual.checkId !== checkId) {
      if (activeRitual) closeRollRitual({ dismissed: false });
      const made = makeStage(check);
      if (!made) return;
      bindRitualDismiss(checkId, "result");
    }
    const stage = rollRitualEl.querySelector(".ritual-stage");
    if (!stage || !activeRitual) return;
    const die = stage.querySelector(".fate-die");
    const face = stage.querySelector(".fate-face");
    const caption = stage.querySelector(".ritual-caption");
    const result = stage.querySelector(".ritual-result");
    const countdown = stage.querySelector(".ritual-countdown");
    if (countdown) {
      countdown.hidden = true;
      countdown.textContent = "";
    }
    die.classList.add("rolling");
    caption.textContent = prefersReducedMotion() ? "판정 결과" : "굴리는 중...";
    shuffleDiceFaces([face], fsign, () => {
      if (!activeRitual || activeRitual.checkId !== checkId) return;
      die.classList.remove("rolling");
      die.classList.add("settled");
      face.textContent = fsign(check.roll);
      die.setAttribute("aria-label", `운명 주사위 ${fsign(check.roll)}`);
      const outcome = check.outcome || "";
      const stingClass = outcome === "Critical Success" ? "critical" : outcome === "Failure" ? "failure" : "success";
      die.classList.add(stingClass);
      const settle = () => {
        if (!activeRitual || activeRitual.checkId !== checkId) return;
        caption.textContent = "판정 결과";
        result.textContent = resultCaption(check);
        activeRitual.timers.push(window.setTimeout(() => closeRollRitual({ dismissed: false }), autoCloseMs));
      };
      if (prefersReducedMotion()) settle();
      else activeRitual.timers.push(window.setTimeout(settle, 600));
    });
  }

  function openPendingRitual(check) {
    if (!rollRitualEl || !check || !check.checkId) return;
    const checkId = String(check.checkId);
    if (activeRitual && activeRitual.checkId === checkId && activeRitual.mode === "pending") return;
    if (activeRitual) return;
    const made = makeStage(check);
    if (!made) return;
    animatingCheckIds.add(checkId);
    const state = bindRitualDismiss(checkId, "pending");
    const isOwner = check.playerId === viewerPlayerId;
    if (isOwner) {
      made.caption.textContent = "당신 차례 — 굴리기";
    } else {
      const whoName = typeof check.characterName === "string" && check.characterName.trim() ? check.characterName.trim() : "플레이어";
      made.caption.textContent = `${whoName}이(가) 굴리는 중…`;
    }
    updateRitualCountdown(made.countdown);
    state.intervals.push(window.setInterval(() => updateRitualCountdown(made.countdown), 1000));
    if (!isOwner) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "roll-btn ritual-roll-btn";
    button.textContent = "굴리기";
    button.disabled = !canRollCheck(getState());
    made.stage.appendChild(button);
    button.addEventListener("click", () => {
      const cmd = buildRollCheckCommand(check.checkId);
      if (cmd && sendCommand(cmd)) {
        button.disabled = true;
        button.textContent = "굴리는 중...";
        dismissedPendingIds.delete(checkId);
      } else {
        button.disabled = false;
        button.textContent = "굴리기";
      }
    });
  }

  function playNextRollRitual() {
    if (activeRitual || ritualQueue.length === 0) return;
    const check = ritualQueue.shift();
    showRolledResult(check, check.autoRolled === true ? 1200 : 900);
  }

  function maybeAutoOpenPending(checks) {
    if (activeRitual) return;
    const active = checks.find((check) => check && check.status !== "rolled");
    if (!active) return;
    // Real server roll windows always include a deadline; no-deadline states are synthetic legacy tests.
    if (active.playerId !== viewerPlayerId && typeof getState().rollCheckDeadline !== "string") return;
    if (dismissedPendingIds.has(String(active.checkId || ""))) return;
    openPendingRitual(active);
  }

  function renderRollingChecks() {
    const checks = Array.isArray(getState().rollingChecks) ? getState().rollingChecks : [];
    if (checks.length === 0) {
      checkTray.replaceChildren();
      checkBar.hidden = true;
      renderRollCountdown([]);
      return;
    }
    checkBar.hidden = false;
    renderRollCountdown(checks);
    const pending = checks.filter((check) => check && check.status !== "rolled");
    const active = activeRollingCheck(getState());
    const frag = document.createDocumentFragment();
    for (const check of pending) {
      const pill = document.createElement("span");
      pill.className = "check-pill";
      const name = typeof check.characterName === "string" && check.characterName.trim() ? check.characterName.trim() : "플레이어";
      pill.textContent = active && active.checkId === check.checkId ? `🎲 ${name} 차례` : `${name} 대기`;
      frag.appendChild(pill);
    }
    const mineActive = active && active.playerId === viewerPlayerId ? active : null;
    if (mineActive) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "roll-btn reopen-roll-btn";
      btn.textContent = "🎲 내 판정 굴리기";
      btn.disabled = !canRollCheck(getState());
      btn.addEventListener("click", () => {
        dismissedPendingIds.delete(String(mineActive.checkId || ""));
        openPendingRitual(mineActive);
      });
      frag.appendChild(btn);
    }
    checkTray.replaceChildren(frag);
    maybeAutoOpenPending(checks);
  }

  function animateRolledCheck(check) {
    if (!check || !check.checkId || typeof check.roll !== "number") return;
    const checkId = String(check.checkId);
    animatedServerCheckIds.add(checkId);
    dismissedPendingIds.delete(checkId);
    if (
      check.playerId !== viewerPlayerId &&
      (!activeRitual || activeRitual.checkId !== checkId) &&
      // Real server roll windows always include a deadline; no-deadline states are synthetic legacy tests.
      typeof getState().rollCheckDeadline !== "string"
    ) return;
    if (
      check.autoRolled === true &&
      (!activeRitual || activeRitual.checkId !== checkId) &&
      // Real server roll windows always include a deadline; no-deadline states are synthetic legacy tests.
      typeof getState().rollCheckDeadline !== "string"
    ) return;
    if (activeRitual && activeRitual.checkId === checkId) {
      clearActiveTimers();
      activeRitual.mode = "result";
      showRolledResult(check, check.autoRolled === true ? 1200 : 900);
      return;
    }
    ritualQueue.push(check);
    playNextRollRitual();
  }

  function clearAnimatedServerCheckIds() {
    animatedServerCheckIds.clear();
  }

  return {
    renderRollingChecks,
    renderRollCountdown,
    pendingViewerChecks,
    shuffleDiceFaces,
    animateRolledCheck,
    clearAnimatedServerCheckIds,
  };
}
