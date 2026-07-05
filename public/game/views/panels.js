import {
  describeCharacterState,
  describeBlackboard,
  describeClock,
  rosterModel,
  currentPhaseModel,
  readyTally,
  selfStatus,
} from "../logic.js";
import { hueForId } from "./dom.js";

export function createPanelsView(ctx) {
  const { els, helpers, getState, getViewerPlayerId } = ctx;
  const { clocksEl, charStatesEl, blackboardEl, turnIndicatorEl, selfStatusEl, rosterEl } = els;
  const { textSpan, turnStateView } = helpers;
  const viewerPlayerId = getViewerPlayerId();

  // 단계 한국어 레이블 (단계/차례 표시용)
  const PHASE_LABELS = {
    free_chat: "자유 대화",
    ready_check: "준비 체크",
    resolving: "판정 중",
    rolling: "주사위 굴림",
    ended: "종료",
  };

  function renderClocks() {
    const clocks = Array.isArray(getState().clocks) ? getState().clocks : [];
    if (clocks.length === 0) {
      clocksEl.hidden = true;
      clocksEl.replaceChildren();
      return;
    }
    clocksEl.hidden = false;
    const frag = document.createDocumentFragment();
    for (const raw of clocks) {
      const c = describeClock(raw);
      const wrap = document.createElement("div");
      wrap.className = "clock" + (c.max > 0 && c.value >= c.max ? " full" : "");

      const label = document.createElement("span");
      label.className = "clock-label";
      label.textContent = `${c.name} ${c.value}/${c.max}`;

      const gauge = document.createElement("span");
      gauge.className = "clock-gauge";
      gauge.setAttribute("role", "img");
      gauge.setAttribute("aria-label", `${c.name} ${c.value}/${c.max}`);
      for (let i = 0; i < c.max; i++) {
        const seg = document.createElement("span");
        seg.className = i < c.value ? "seg on" : "seg";
        gauge.appendChild(seg);
      }

      wrap.appendChild(label);
      wrap.appendChild(gauge);
      frag.appendChild(wrap);
    }
    clocksEl.replaceChildren(frag);
  }

  // player-visible 캐릭터 상태(조건/장비/자원/개인 시계)를 그린다. 서버가 GM 전용
  // 정보를 이미 제외한 스냅샷을 turn_state에 실어 보내며, 표시할 내용이 있는
  // 캐릭터가 하나도 없으면 영역을 숨긴다. DOM API로만 조립해 XSS 표면을 만들지 않는다.
  function renderCharacterStates() {
    const list = Array.isArray(getState().characterStates) ? getState().characterStates : [];
    const cards = [];
    for (const raw of list) {
      const cs = describeCharacterState(raw);
      const hasContent =
        cs.conditions.length > 0 ||
        cs.inventory.length > 0 ||
        cs.resources.length > 0 ||
        cs.personalClocks.length > 0;
      if (!hasContent) continue;

      const card = document.createElement("div");
      card.className = "char-state";

      const nameEl = document.createElement("span");
      nameEl.className = "cs-name";
      nameEl.textContent = cs.name || "캐릭터";
      card.appendChild(nameEl);

      const line = document.createElement("span");
      line.className = "cs-line";
      for (const cond of cs.conditions) {
        const tag = document.createElement("span");
        tag.className = "cs-tag cond";
        tag.textContent = cond.severity != null ? `${cond.name} ${cond.severity}` : cond.name;
        line.appendChild(tag);
      }
      for (const item of cs.inventory) {
        const tag = document.createElement("span");
        tag.className = "cs-tag item";
        tag.textContent = item.name;
        line.appendChild(tag);
      }
      for (const res of cs.resources) {
        const tag = document.createElement("span");
        tag.className = "cs-tag res";
        tag.textContent = `${res.key} ${res.value}`;
        line.appendChild(tag);
      }
      for (const clock of cs.personalClocks) {
        const tag = document.createElement("span");
        tag.className = "cs-tag";
        tag.textContent = `${clock.name} ${clock.value}/${clock.max}`;
        line.appendChild(tag);
      }
      card.appendChild(line);
      cards.push(card);
    }

    if (cards.length === 0) {
      charStatesEl.hidden = true;
      charStatesEl.replaceChildren();
      return;
    }
    charStatesEl.hidden = false;
    charStatesEl.replaceChildren(...cards);
  }

  // player-visible 시나리오 블랙보드(발견한 단서 / 보이는 NPC / 활성 위협)를 그린다.
  // 서버가 숨겨진 secret과 미발견 단서를 이미 제외한 projection만 turn_state에 실어
  // 보내므로, 여기서는 형태 방어(describeBlackboard) 후 DOM API로만 조립한다.
  function renderBlackboard() {
    const bb = describeBlackboard(getState().blackboard);
    const groups = [];

    if (bb.clues.length > 0) {
      const group = document.createElement("span");
      group.className = "bb-group";
      group.appendChild(textSpan("bb-label", "발견한 단서"));
      for (const clue of bb.clues) {
        const tag = document.createElement("span");
        tag.className = "bb-tag clue";
        tag.textContent = clue.conclusion;
        group.appendChild(tag);
      }
      groups.push(group);
    }
    if (bb.npcs.length > 0) {
      const group = document.createElement("span");
      group.className = "bb-group";
      group.appendChild(textSpan("bb-label", "NPC"));
      for (const npc of bb.npcs) {
        const tag = document.createElement("span");
        tag.className = "bb-tag npc";
        tag.textContent = npc.role ? `${npc.name} (${npc.role})` : npc.name;
        group.appendChild(tag);
      }
      groups.push(group);
    }
    if (bb.threats.length > 0) {
      const group = document.createElement("span");
      group.className = "bb-group";
      group.appendChild(textSpan("bb-label", "위협"));
      for (const threat of bb.threats) {
        const tag = document.createElement("span");
        tag.className = "bb-tag threat";
        tag.textContent = threat.status ? `${threat.name} · ${threat.status}` : threat.name;
        group.appendChild(tag);
      }
      groups.push(group);
    }

    if (groups.length === 0) {
      blackboardEl.hidden = true;
      blackboardEl.replaceChildren();
      return;
    }
    blackboardEl.hidden = false;
    blackboardEl.replaceChildren(...groups);
  }

  // 채팅(서버 권위)과 본인 행동 로그(로컬 에코)를 한 사이드바에 그린다.

  // 멀티플레이 표시: 단계/차례 · 본인 상태 · 로스터를 결정적으로 재도출해 그린다.
  function renderMultiplayer() {
    const ts = turnStateView();
    const roster = rosterModel(ts, viewerPlayerId);
    const phaseModel = currentPhaseModel(ts, viewerPlayerId);
    const self = selfStatus(getState().readiness, viewerPlayerId);
    renderTurnIndicator(phaseModel, roster);
    renderSelfStatusView(self);
    renderRoster(roster, phaseModel);
  }

  // 단계/차례 표시: 현재 단계 + (턴 기반) 활성 플레이어/순서 또는 (단계 기반) 행동 가능 (요구사항 2.1~2.5)
  function renderTurnIndicator(phaseModel, roster) {
    const nameOf = new Map(roster.map((r) => [r.playerId, r.characterName]));
    const phaseLabel =
      phaseModel.phase != null ? PHASE_LABELS[phaseModel.phase] || phaseModel.phase : "-";
    let detail;
    if (phaseModel.isTurnBased && phaseModel.activePlayerId) {
      const activeName = nameOf.get(phaseModel.activePlayerId) || phaseModel.activePlayerId;
      detail = `차례: ${activeName}`;
      if (phaseModel.turnOrder.length > 0) {
        const orderNames = phaseModel.turnOrder.map((id) => nameOf.get(id) || id);
        detail += ` · 순서: ${orderNames.join(" → ")}`;
      }
    } else if (phaseModel.actablePlayerIds.length > 0) {
      const actableNames = phaseModel.actablePlayerIds.map((id) => nameOf.get(id) || id);
      detail = `행동 가능: ${actableNames.join(", ")}`;
    } else {
      detail = "행동 가능한 플레이어 없음";
    }
    turnIndicatorEl.replaceChildren(
      textSpan("phase-label", `단계: ${phaseLabel}`),
      textSpan("turn-detail", detail),
    );
  }

  // 본인 상태 표시: 준비/행동완료/관전 (요구사항 6.4)
  function renderSelfStatusView(self) {
    let text;
    if (self.spectator) {
      text = "관전 중";
    } else {
      const readyText = self.status === "ready" ? "준비 완료" : "준비 안 됨";
      const actedText = self.hasActed ? "행동 완료" : "행동 대기";
      text = `${readyText} · ${actedText}`;
    }
    // textContent는 자동 이스케이프되므로 별도 esc 불필요.
    selfStatusEl.textContent = `본인: ${text}`;
  }

  // 로스터 패널: readiness당 한 행(캐릭터명 esc · 연결 배지 · 준비 · 행동완료 · 본인) (요구사항 1.3, 1.4, 4.2, 5.2)
  function renderRoster(roster, phaseModel) {
    const actable = new Set(phaseModel.actablePlayerIds);
    const pendingCheckPlayers = new Set(
      (Array.isArray(getState().rollingChecks) ? getState().rollingChecks : [])
        .filter((check) => check && check.status !== "rolled" && check.playerId != null)
        .map((check) => check.playerId),
    );
    const frag = document.createDocumentFragment();
    for (const r of roster) {
      const li = document.createElement("li");
      li.className =
        "roster-row" +
        (r.isSelf ? " self" : "") +
        (r.hasActed ? " acted" : "") +
        (r.connectionStatus === "disconnected" ? " disconnected" : "") +
        (pendingCheckPlayers.has(r.playerId) ? " rolling" : "");
      // 키보드 포커스 가능(요구사항 8.4의 보이는 포커스 표시 대상).
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      const connLabel =
        r.connectionStatus === "connected"
          ? "연결됨"
          : r.connectionStatus === "disconnected"
            ? "연결 끊김"
            : "연결 상태 미상";
      const readyLabel = r.status === "ready" ? "준비 완료" : "준비 안 됨";
      const actedLabel = r.hasActed ? "행동 완료" : actable.has(r.playerId) ? "행동 가능" : "대기";
      // 표시 이름: 캐릭터이름(방입장이름). 합류 이름이 있고 캐릭터명과 다르면 괄호로 덧붙인다.
      const joinName =
        typeof r.displayName === "string" && r.displayName.trim().length > 0 ? r.displayName.trim() : "";
      const nameText =
        joinName && joinName !== r.characterName ? `${r.characterName}(${joinName})` : r.characterName;
      // 비어 있지 않은 접근성 레이블(요구사항 8.2). setAttribute는 HTML로 해석되지 않는다.
      li.setAttribute(
        "aria-label",
        `${nameText}${r.isSelf ? " (나)" : ""}, ${connLabel}, ${readyLabel}, ${actedLabel}, 캐릭터 시트 열기`,
      );
      li.addEventListener("click", () => ctx.openSheetDrawer(r.playerId, li));
      li.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          ctx.openSheetDrawer(r.playerId, li);
        }
      });
      const name = textSpan("r-name", nameText);
      const coin = textSpan("roster-coin", Array.from(nameText || r.playerId || "?")[0] || "?");
      coin.style.setProperty("--coin-hue", String(hueForId(r.playerId)));
      coin.setAttribute("aria-hidden", "true");
      const badges = [name];
      if (r.isSelf) {
        const self = textSpan("r-self", "나");
        self.setAttribute("aria-hidden", "true");
        badges.push(self);
      }
      const connClass =
        r.connectionStatus === "connected"
          ? "connected"
          : r.connectionStatus === "disconnected"
            ? "disconnected"
            : "unknown";
      const conn = textSpan(`r-conn ${connClass}`, connLabel);
      conn.setAttribute("aria-hidden", "true");
      const ready = textSpan(`r-ready ${r.status === "ready" ? "on" : ""}`, readyLabel);
      ready.setAttribute("aria-hidden", "true");
      const acted = textSpan(`r-acted ${r.hasActed ? "on" : ""}`, actedLabel);
      acted.setAttribute("aria-hidden", "true");
      if (pendingCheckPlayers.has(r.playerId)) {
        const rolling = textSpan("r-rolling", "🎲");
        rolling.setAttribute("aria-hidden", "true");
        badges.push(rolling);
      }
      li.replaceChildren(coin, ...badges, conn, ready, acted);
      frag.appendChild(li);
    }
    rosterEl.replaceChildren(frag);
  }

  return { renderClocks, renderCharacterStates, renderBlackboard, renderMultiplayer };
}
