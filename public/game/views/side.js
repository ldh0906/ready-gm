import { MAX_ENTRIES, actionHistoryModel } from "../logic.js";

export function createSideView(ctx) {
  const { els, helpers, getState } = ctx;
  const { sideEl } = els;
  const { textSpan, appendText, stickToBottom, isNearBottom, turnStateView } = helpers;

  function renderSide() {
    const wasNearBottom = isNearBottom(sideEl);
    const frag = document.createDocumentFragment();
    for (const c of getState().chatEntries) {
      const div = document.createElement("div");
      div.className = "li chat";
      const dn = c.displayName;
      const name = document.createElement("b");
      name.textContent = c.characterName;
      div.appendChild(name);
      if (typeof dn === "string" && dn.trim().length > 0 && dn !== c.characterName) {
        // 캐릭터 이름 + 방 합류 표시 이름: "알렉스(라면)" 형태로 귀속한다.
        div.appendChild(textSpan("chat-handle", `(${dn})`));
      }
      appendText(div, `: ${c.text}`);
      frag.appendChild(div);
    }
    let lastActionRound = null;
    for (const a of actionHistoryModel(turnStateView())) {
      if (a.round !== lastActionRound) {
        const sep = document.createElement("div");
        sep.className = "li round-sep";
        sep.textContent = `— ${a.round}라운드 —`;
        frag.appendChild(sep);
        lastActionRound = a.round;
      }
      const div = document.createElement("div");
      // 캐릭터이름(방입장이름) 형식. 합류 이름이 없거나 캐릭터명과 같으면 이름만.
      const dn = typeof a.displayName === "string" ? a.displayName.trim() : "";
      const nameText = dn && dn !== a.characterName ? `${a.characterName}(${dn})` : a.characterName;
      if (a.kind === "confirm") {
        div.className = "li act";
        appendText(div, "🗡 ");
        const name = document.createElement("b");
        name.textContent = nameText;
        div.appendChild(name);
        appendText(div, ` 행동 확정: ${a.text}`);
      } else {
        div.className = "li pass";
        div.textContent = `${nameText} — ${a.auto ? "자동 패스" : "패스"}`;
      }
      frag.appendChild(div);
    }
    sideEl.replaceChildren(frag);
    while (sideEl.childElementCount > MAX_ENTRIES) sideEl.removeChild(sideEl.firstChild);
    stickToBottom(sideEl, wasNearBottom);
  }

  return { renderSide };
}
