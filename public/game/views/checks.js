import { Phase, buildRollCheckCommand, canRollCheck } from "../logic.js";

export function createChecksView(ctx) {
  const { els, helpers, getState, sendCommand, getViewerPlayerId } = ctx;
  const { checkBar, rollCountdownEl, checkTray } = els;
  const { textSpan, frand, fsign, now } = helpers;
  const viewerPlayerId = getViewerPlayerId();

  const ATTR_LABELS = { Might: "힘", Agility: "민첩", Wits: "지혜", Spirit: "정신", Sneaky: "은밀함", Fast: "재빠름", Tenacious: "집요함" };
  const DIFF_LABELS = { Trivial: "사소", Easy: "쉬움", Average: "보통", Hard: "어려움", Formidable: "지난" };
  const OUTCOME_LABELS = {
    "Failure": "실패",
    "Partial Success": "부분 성공",
    "Success": "성공",
    "Critical Success": "대성공",
  };

  // 관전자(본인)의 캐릭터 이름. readiness에 게이트웨이가 주입한 characterName을 쓴다.
  // 본인이 굴려야 하는 판정을 가려내는 데 사용한다.
  function viewerCharacterName() {
    const list = Array.isArray(getState().readiness) ? getState().readiness : [];
    const entry = list.find((r) => r && r.playerId === viewerPlayerId);
    return entry && typeof entry.characterName === "string" ? entry.characterName : "";
  }

  function renderSettledDice(check, dieRow, caption) {
    const rolls = Array.isArray(check.rolls) && check.rolls.length > 0 ? check.rolls : [check.roll];
    const dice = rolls.map((roll, i) => {
      const die = document.createElement("span");
      die.className = "fate-die settled";
      die.setAttribute("aria-label", `운명 주사위 ${fsign(roll)}`);
      die.append(
        textSpan("fate-face", fsign(roll)),
        textSpan("fate-label", rolls.length === 2 ? (i + 1) + "차" : "판정"),
      );
      return die;
    });
    if (rolls.length === 2) {
      let keptIdx = rolls.findIndex((r) => r === check.roll);
      if (keptIdx < 0) {
        keptIdx = check.advantage === "advantage"
          ? (rolls[0] >= rolls[1] ? 0 : 1)
          : (rolls[0] <= rolls[1] ? 0 : 1);
      }
      dice.forEach((die, i) => die.classList.add(i === keptIdx ? "kept" : "dropped"));
    }
    dieRow.replaceChildren(...dice);
    const diff = DIFF_LABELS[check.difficulty] || check.difficulty;
    const outcome = OUTCOME_LABELS[check.outcome] || check.outcome || "";
    const autoText = check.autoRolled === true ? " (시간 초과 — 자동 굴림)" : "";
    caption.textContent = outcome ? `난이도 ${diff} · 결과 ${outcome}${autoText}` : `난이도 ${diff}${autoText}`;
  }

  function renderPendingDice(check, dieRow, caption) {
    const pendingDie = document.createElement("span");
    pendingDie.className = "fate-die";
    pendingDie.setAttribute("aria-label", "아직 굴리지 않은 운명 주사위");
    pendingDie.append(
      textSpan("fate-face", "?"),
      textSpan("fate-label", "대기"),
    );
    dieRow.appendChild(pendingDie);
    const ownerName = check.characterName || "플레이어";
    if (check.playerId === viewerPlayerId) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "roll-btn";
      btn.textContent = "굴리기";
      // canSend()가 아니라 굴림 전용 가드를 쓴다: 전역 입력 잠금(isInputLocked)은
      // rolling 단계에서 채팅을 잠그므로, 그것으로 게이팅하면 굴리기 버튼이
      // 항상 비활성이 된다(2인 세션 QA 회귀).
      btn.disabled = !canRollCheck(getState());
      dieRow.appendChild(btn);
      btn.addEventListener("click", () => {
        const cmd = buildRollCheckCommand(check.checkId);
        // 전송이 성공했을 때만 버튼을 잠근다(실패 시 다시 굴리기를 시도할 수 있게).
        if (cmd && sendCommand(cmd)) {
          btn.disabled = true;
        }
      });
      caption.textContent = "당신의 판정입니다.";
    } else {
      caption.textContent = `${ownerName}의 굴림을 기다리는 중`;
    }
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

  function renderRollingChecks() {
    const checks = Array.isArray(getState().rollingChecks) ? getState().rollingChecks : [];
    if (checks.length === 0) {
      if (getState().phase === Phase.ROLLING) {
        checkTray.replaceChildren();
        checkBar.hidden = true;
      }
      renderRollCountdown(checks);
      return;
    }
    checkBar.hidden = false;
    renderRollCountdown(checks);
    // 셔플 연출 중인 그룹은 기존 DOM을 그대로 재사용한다 — 1초 렌더 티커와
    // check_rolled 디스패치 직후 재렌더가 replaceChildren으로 연출을 즉시
    // 끊어버리던 회귀 가드("애니메이션이 너무 빠르다" QA).
    const liveGroups = new Map(
      Array.from(checkTray.querySelectorAll("[data-check-id]")).map((el) => [el.dataset.checkId, el]),
    );
    const nextGroups = [];
    for (const check of checks) {
      const checkId = String(check.checkId || "");
      const live = liveGroups.get(checkId);
      if (live && animatingCheckIds.has(checkId)) {
        nextGroups.push(live);
        continue;
      }
      const group = document.createElement("div");
      group.className = "check-group";
      group.dataset.checkId = String(check.checkId || "");
      const attrLabel = check.attributeLabel || ATTR_LABELS[check.attribute] || check.attribute;
      const whoName = typeof check.characterName === "string" ? check.characterName.trim() : "";
      const who = document.createElement("div");
      who.className = "check-who";
      who.textContent = whoName ? `${whoName} · ${attrLabel}` : attrLabel;
      const dieRow = document.createElement("div");
      dieRow.className = "check-dice";
      const caption = document.createElement("div");
      caption.className = "caption";
      group.append(who, dieRow, caption);
      nextGroups.push(group);
      if (check.status === "rolled" && typeof check.roll === "number") {
        renderSettledDice(check, dieRow, caption);
      } else {
        renderPendingDice(check, dieRow, caption);
      }
    }
    checkTray.replaceChildren(...nextGroups);
  }

  // 주사위 얼굴 셔플 연출: 빠르게 시작해 점점 느려지다 멈춘다(감속 곡선).
  // reduced-motion이면 짧고 성기게. 완료 시 onDone에서 실제 결과로 정착시킨다.
  function shuffleDiceFaces(faces, format, onDone) {
    const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const durationMs = reduced ? 700 : 2000;
    const startedAt = Date.now();
    let delay = reduced ? 150 : 70;
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

  function animateRolledCheck(check) {
    if (!check || !check.checkId || typeof check.roll !== "number") return;
    animatedServerCheckIds.add(check.checkId);
    const findGroup = () =>
      Array.from(checkTray.querySelectorAll("[data-check-id]"))
        .find((el) => el.dataset.checkId === String(check.checkId));
    let group = findGroup();
    if (!group) {
      renderRollingChecks();
      group = findGroup();
    }
    if (!group) return;
    const dieRow = group.querySelector(".check-dice");
    const caption = group.querySelector(".caption");
    if (!dieRow || !caption) return;
    const rolls = Array.isArray(check.rolls) && check.rolls.length > 0 ? check.rolls : [check.roll];
    const dice = rolls.map((_, i) => {
      const die = document.createElement("span");
      die.className = "fate-die rolling";
      die.append(
        textSpan("fate-face", String(frand(-4, 4))),
        textSpan("fate-label", rolls.length === 2 ? (i + 1) + "차" : "판정"),
      );
      return die;
    });
    dieRow.replaceChildren(...dice);
    caption.textContent = "굴리는 중...";
    // 연출 중 재렌더가 이 그룹을 갈아치우지 않도록 등록해 둔다(renderRollingChecks 참조).
    const checkId = String(check.checkId);
    animatingCheckIds.add(checkId);
    const faces = dice.map((d) => d.querySelector(".fate-face"));
    shuffleDiceFaces(faces, (n) => String(n), () => {
      animatingCheckIds.delete(checkId);
      renderSettledDice(check, dieRow, caption);
    });
  }

  // 판정 하나의 DOM을 만들고 주사위 연출을 수행하는 내부 실행기를 돌려준다.
  // manual=true면 "굴리기" 버튼을 노출하고, 버튼을 눌러야 연출이 시작된다(본인 주사위).
  function renderCheck(check, manual) {
    const group = document.createElement("div");
    group.className = "check-group";
    // 누가 무슨 주사위를 굴리는지 상단에 표기한다.
    const attrLabel = check.attributeLabel || ATTR_LABELS[check.attribute] || check.attribute;
    const whoName = typeof check.characterName === "string" ? check.characterName.trim() : "";
    const who = document.createElement("div");
    who.className = "check-who";
    who.textContent = whoName ? `${whoName} · ${attrLabel}` : attrLabel;
    group.appendChild(who);
    const dieRow = document.createElement("div");
    dieRow.className = "check-dice";
    group.appendChild(dieRow);
    const caption = document.createElement("div");
    caption.className = "caption";
    group.appendChild(caption);
    checkTray.appendChild(group);
    while (checkTray.children.length > 12) checkTray.removeChild(checkTray.firstChild);

    const advLabel =
      check.advantage === "advantage" ? "유리(높은 합 채택)"
      : check.advantage === "disadvantage" ? "불리(낮은 합 채택)" : "보통";
    const rolls = Array.isArray(check.rolls) && check.rolls.length > 0 ? check.rolls : [check.roll];

    // 실제 주사위 연출. 서버가 이미 결과를 확정했으므로 여기서는 표현만 한다.
    const animate = () => {
      const dice = rolls.map((_, i) => {
        const die = document.createElement("div");
        die.className = "fate-die rolling";
        die.setAttribute("role", "img");
        die.replaceChildren(
          textSpan("fate-type", attrLabel),
          textSpan("fate-face", "…"),
          textSpan("fate-label", rolls.length === 2 ? (i + 1) + "차" : "판정"),
        );
        dieRow.appendChild(die);
        return die;
      });
      return new Promise((resolve) => {
        const faces = dice.map((d) => d.querySelector(".fate-face"));
        shuffleDiceFaces(faces, fsign, () => {
          dice.forEach((die, i) => {
            die.classList.remove("rolling");
            die.classList.add("settled");
            faces[i].textContent = fsign(rolls[i]);
            die.setAttribute("aria-label", `운명 주사위 ${fsign(rolls[i])}`);
          });
          if (rolls.length === 2) {
            let keptIdx = rolls.findIndex((r) => r === check.roll);
            if (keptIdx === -1) {
              keptIdx = check.advantage === "advantage"
                ? (rolls[0] >= rolls[1] ? 0 : 1)
                : (rolls[0] <= rolls[1] ? 0 : 1);
            }
            dice.forEach((die, i) => die.classList.add(i === keptIdx ? "kept" : "dropped"));
          }
          const d = DIFF_LABELS[check.difficulty] || check.difficulty;
          const o = OUTCOME_LABELS[check.outcome] || check.outcome;
          const advText = check.advantage === "none" ? "" : ` · ${advLabel}`;
          const prefix = whoName ? `${whoName} · ` : "";
          caption.textContent = `${prefix}${attrLabel} · ${d}${advText} → ${o}`;
          resolve();
        });
      });
    };

    if (!manual) return animate();
    // 본인 주사위: 버튼을 눌러야 굴러간다.
    return new Promise((resolve) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "roll-btn";
      btn.textContent = "굴리기";
      dieRow.appendChild(btn);
      btn.addEventListener("click", () => {
        btn.remove();
        void animate().then(resolve);
      }, { once: true });
    });
  }

  async function revealChecks(checks) {
    const myName = viewerCharacterName();
    for (const check of checks) {
      const manual =
        myName.length > 0 &&
        typeof check.characterName === "string" &&
        check.characterName === myName;
      await renderCheck(check, manual);
    }
  }

  // resolution 내레이션이 실어 온 이번 라운드 판정을 연출한다. 서버가 이미
  // visibility="player"만 골라 보내므로 그대로 쓰되, 같은 판정 재전송은 시그니처로 막는다.
  let lastCheckSig = "";
  const animatedServerCheckIds = new Set();
  // 셔플 연출이 진행 중인 checkId — renderRollingChecks가 해당 그룹 DOM을 보존한다.
  const animatingCheckIds = new Set();
  function maybeAnimateChecks(checks) {
    if (animatedServerCheckIds.size > 0) return;
    if (!Array.isArray(checks) || checks.length === 0) return;
    const sig = JSON.stringify(
      checks.map((c) => [c.characterName, c.attribute, c.difficulty, c.advantage, c.rolls, c.roll, c.outcome]),
    );
    if (sig === lastCheckSig) return;
    lastCheckSig = sig;
    checkBar.hidden = false;
    checkTray.replaceChildren();
    void revealChecks(checks);
  }

  function clearAnimatedServerCheckIds() {
    animatedServerCheckIds.clear();
  }

  return {
    renderRollingChecks,
    renderRollCountdown,
    pendingViewerChecks,
    renderSettledDice,
    renderPendingDice,
    shuffleDiceFaces,
    animateRolledCheck,
    renderCheck,
    maybeAnimateChecks,
    clearAnimatedServerCheckIds,
  };
}
