export function createSheetDrawerView(ctx) {
  const { els, getState } = ctx;
  const {
    sheetBackdropEl,
    sheetDrawerEl,
    sheetDrawerTitleEl,
    sheetDrawerSubtitleEl,
    sheetDrawerBodyEl,
    sheetRefreshBtn,
    sheetCloseBtn,
  } = els;
  let sheetViewsCache = null;
  let sheetViewsInFlight = null;
  let activeSheetPlayerId = "";
  let sheetReturnFocusEl = null;

  function sheetFetchHeaders() {
    const headers = {};
    if (getState().handoff.token) headers["x-playtest-token"] = getState().handoff.token;
    if (getState().handoff.ticket) headers["x-connection-ticket"] = getState().handoff.ticket;
    return headers;
  }

  async function loadSheetViews(force) {
    if (!force && sheetViewsCache) return sheetViewsCache;
    if (!force && sheetViewsInFlight) return sheetViewsInFlight;
    const url = `/rooms/${encodeURIComponent(getState().handoff.roomId)}/sheet-views`;
    sheetViewsInFlight = fetch(url, {
      method: "GET",
      headers: sheetFetchHeaders(),
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`sheet views ${response.status}`);
        const body = await response.json();
        const views = Array.isArray(body && body.views) ? body.views : [];
        sheetViewsCache = views;
        return views;
      })
      .finally(() => {
        sheetViewsInFlight = null;
      });
    return sheetViewsInFlight;
  }

  function sheetRow(labelText, valueText) {
    const row = document.createElement("div");
    row.className = "sheet-row";
    const label = document.createElement("span");
    label.className = "sheet-label";
    label.textContent = labelText;
    const value = document.createElement("span");
    value.className = "sheet-value";
    value.textContent = valueText;
    row.replaceChildren(label, value);
    return row;
  }

  function sheetSection(titleText, rows) {
    const section = document.createElement("section");
    section.className = "sheet-section";
    const title = document.createElement("h3");
    title.textContent = titleText;
    const list = document.createElement("div");
    list.className = "sheet-list";
    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "sheet-empty";
      empty.textContent = "표시할 내용이 없습니다.";
      list.appendChild(empty);
    } else {
      list.replaceChildren(...rows);
    }
    section.replaceChildren(title, list);
    return section;
  }

  function characterStateForSheet(sheetEntry) {
    const states = Array.isArray(getState().characterStates) ? getState().characterStates : [];
    const characterId = sheetEntry && typeof sheetEntry.characterId === "string" ? sheetEntry.characterId : "";
    const byId = states.find((raw) => raw && raw.characterId === characterId);
    return describeCharacterState(byId || {});
  }

  function statusRowsForSheet(sheetEntry) {
    const cs = characterStateForSheet(sheetEntry);
    const rows = [];
    for (const cond of cs.conditions) {
      rows.push(sheetRow("조건", cond.severity != null ? `${cond.name} ${cond.severity}` : cond.name));
    }
    for (const item of cs.inventory) {
      rows.push(sheetRow("장비", item.tags.length > 0 ? `${item.name} (${item.tags.join(", ")})` : item.name));
    }
    for (const res of cs.resources) {
      rows.push(sheetRow("자원", `${res.key}: ${res.value}`));
    }
    for (const clock of cs.personalClocks) {
      rows.push(sheetRow("개인 시계", `${clock.name} ${clock.value}/${clock.max}`));
    }
    return rows;
  }

  function renderSheetDrawer(sheetEntry) {
    const view = sheetEntry && sheetEntry.view ? sheetEntry.view : null;
    if (!view) {
      sheetDrawerTitleEl.textContent = "캐릭터 시트";
      sheetDrawerSubtitleEl.textContent = "";
      sheetDrawerBodyEl.replaceChildren(sheetSection("안내", [sheetRow("상태", "시트를 찾을 수 없습니다.")]));
      return;
    }
    sheetDrawerTitleEl.replaceChildren(document.createTextNode(view.name || "캐릭터"));
    if (view.isSelf) {
      const badge = document.createElement("span");
      badge.className = "sheet-badge";
      badge.textContent = "내 시트";
      sheetDrawerTitleEl.appendChild(badge);
    }
    sheetDrawerSubtitleEl.textContent = view.card ? view.card.roleLabel : "";
    const basics = [sheetRow("컨셉", view.concept || "")];
    if (view.card) basics.unshift(sheetRow("역할", view.card.roleLabel));
    const attributes = Array.isArray(view.attributes)
      ? view.attributes.map((attr) => {
          const rung = attr.rungLabel ? ` · ${attr.rungLabel}` : "";
          return sheetRow(attr.label || attr.key, `${attr.value}${rung}`);
        })
      : [];
    const narrative = Array.isArray(view.narrativeFields)
      ? view.narrativeFields.map((field) => sheetRow(field.label || field.id, field.value || ""))
      : [];
    sheetDrawerBodyEl.replaceChildren(
      sheetSection("기본 정보", basics),
      sheetSection("능력치", attributes),
      sheetSection("서사", narrative),
      sheetSection("현재 상태", statusRowsForSheet(sheetEntry)),
    );
  }

  async function openSheetDrawer(playerId, returnFocusEl) {
    activeSheetPlayerId = playerId;
    sheetReturnFocusEl = returnFocusEl || document.activeElement;
    sheetBackdropEl.hidden = false;
    sheetDrawerTitleEl.textContent = "캐릭터 시트";
    sheetDrawerSubtitleEl.textContent = "";
    sheetDrawerBodyEl.replaceChildren(sheetSection("불러오기", [sheetRow("상태", "시트를 불러오는 중입니다.")]));
    sheetDrawerEl.focus();
    try {
      const views = await loadSheetViews(false);
      renderSheetDrawer(views.find((entry) => entry && entry.playerId === activeSheetPlayerId));
    } catch {
      sheetDrawerBodyEl.replaceChildren(sheetSection("오류", [sheetRow("상태", "시트를 불러오지 못했습니다.")]));
    }
  }

  function closeSheetDrawer() {
    sheetBackdropEl.hidden = true;
    activeSheetPlayerId = "";
    const target = sheetReturnFocusEl;
    sheetReturnFocusEl = null;
    if (target && typeof target.focus === "function") target.focus();
  }

  // ---- stick-to-bottom 스크롤 (QA-2) -------------------------------------
  // 사용자가 하단 근처에 있을 때만 자동 스크롤한다. 위로 스크롤해 지난 글을
  // 읽는 중이면 재렌더링이 스크롤 위치를 건드리지 않는다.
  // 사용법: 렌더 전에 isNearBottom(el)을 캡처 → 렌더 후 stickToBottom(el, was).
  sheetCloseBtn.addEventListener("click", closeSheetDrawer);
  sheetRefreshBtn.addEventListener("click", async () => {
    if (!activeSheetPlayerId) return;
    sheetDrawerBodyEl.replaceChildren(sheetSection("불러오기", [sheetRow("상태", "시트를 새로고침하는 중입니다.")]));
    try {
      const views = await loadSheetViews(true);
      renderSheetDrawer(views.find((entry) => entry && entry.playerId === activeSheetPlayerId));
    } catch {
      sheetDrawerBodyEl.replaceChildren(sheetSection("오류", [sheetRow("상태", "시트를 불러오지 못했습니다.")]));
    }
  });
  sheetBackdropEl.addEventListener("click", (ev) => {
    if (ev.target === sheetBackdropEl) closeSheetDrawer();
  });
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !sheetBackdropEl.hidden) closeSheetDrawer();
  });

  return { openSheetDrawer, loadSheetViews };
}
