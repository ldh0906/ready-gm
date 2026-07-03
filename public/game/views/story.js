import { Phase, MAX_ENTRIES } from "../logic.js";

export function createStoryView(ctx) {
  const { els, helpers, getState } = ctx;
  const { storyEl, newStoryBtn } = els;
  const { textSpan, isNearBottom, stickToBottom, prefersReducedMotion } = helpers;

  function narrationKey(entry) {
    return `${entry.roundNumber ?? ""}|${entry.kind || ""}|${String(entry.text)}`;
  }
  let lastStoryKey = "";
  let lastAnimatedStoryKey = "";
  let activeTypewriter = null;

  function stopTypewriter() {
    if (activeTypewriter && activeTypewriter.timer != null) {
      window.clearTimeout(activeTypewriter.timer);
    }
    activeTypewriter = null;
  }

  function scheduleTypewriter() {
    if (!activeTypewriter) return;
    const tw = activeTypewriter;
    const wasNearBottom = isNearBottom(storyEl);
    const chunk = tw.text.length >= 500 ? 3 : tw.text.length >= 240 ? 2 : 1;
    tw.progress = Math.min(tw.text.length, tw.progress + chunk);
    tw.textNode.textContent = tw.text.slice(0, tw.progress);
    stickToBottom(storyEl, wasNearBottom);
    if (tw.progress >= tw.text.length) {
      lastAnimatedStoryKey = tw.key;
      activeTypewriter = null;
      return;
    }
    tw.timer = window.setTimeout(scheduleTypewriter, 25);
  }

  function finishTypewriter() {
    if (!activeTypewriter) return;
    if (activeTypewriter.timer != null) window.clearTimeout(activeTypewriter.timer);
    activeTypewriter.textNode.textContent = activeTypewriter.text;
    lastAnimatedStoryKey = activeTypewriter.key;
    activeTypewriter = null;
    stickToBottom(storyEl, true);
  }

  // 상태의 narrationEntries를 통째로 다시 그린다(<= MAX_ENTRIES이므로 비용 안전).
  function renderStory() {
    const wasNearBottom = isNearBottom(storyEl);
    const previousKey = lastStoryKey;
    const entries = Array.isArray(getState().narrationEntries) ? getState().narrationEntries : [];
    const newest = entries.length > 0 ? entries[entries.length - 1] : null;
    const newestKey = newest ? narrationKey(newest) : "";
    const continuingKey = activeTypewriter ? activeTypewriter.key : "";
    const continuingProgress = activeTypewriter ? activeTypewriter.progress : 0;
    const shouldAnimate =
      newest != null &&
      (newestKey === continuingKey ||
        (newestKey !== previousKey && newestKey !== lastAnimatedStoryKey)) &&
      !prefersReducedMotion();
    stopTypewriter();
    const frag = document.createDocumentFragment();
    for (const entry of entries) {
      const div = document.createElement("div");
      div.className = "gm " + (entry.kind || "");
      const label = entry.kind || "narration";
      const text = String(entry.text);
      const key = narrationKey(entry);
      const textNode = document.createTextNode(text);
      if (shouldAnimate && key === newestKey) {
        const start = key === continuingKey ? Math.min(continuingProgress, text.length) : 0;
        textNode.textContent = text.slice(0, start);
        div.addEventListener("click", finishTypewriter, { once: true });
        activeTypewriter = { key, text, textNode, progress: start, timer: null };
      }
      div.append(textSpan("who", `[GM · ${label}]`), textNode);
      frag.appendChild(div);
    }
    if (getState().phase === Phase.RESOLVING) {
      const div = document.createElement("div");
      div.className = "gm waiting";
      div.append(textSpan("who", "[GM]"), document.createTextNode("GM이 서술을 쓰는 중"));
      frag.appendChild(div);
    }
    storyEl.replaceChildren(frag);
    // DOM 상한(방어적): 상태가 이미 상한을 지키지만 동일 정책을 DOM에도 적용.
    while (storyEl.childElementCount > MAX_ENTRIES) storyEl.removeChild(storyEl.firstChild);
    stickToBottom(storyEl, wasNearBottom);
    if (newestKey && newestKey !== previousKey && !wasNearBottom) {
      newStoryBtn.hidden = false;
    }
    if (isNearBottom(storyEl)) newStoryBtn.hidden = true;
    lastStoryKey = newestKey;
    if (activeTypewriter) scheduleTypewriter();
  }

  // 진행 시계 게이지를 그린다. getState().clocks(노출 시나리오의 narration payload로 갱신)가
  // 비어 있으면 영역을 숨긴다. describeClock으로 값/최대치를 안전하게 정규화한다.
  newStoryBtn.addEventListener("click", () => {
    storyEl.scrollTop = storyEl.scrollHeight;
    newStoryBtn.hidden = true;
  });
  storyEl.addEventListener("scroll", () => {
    if (isNearBottom(storyEl)) newStoryBtn.hidden = true;
  });

  return { renderStory, finishTypewriter };
}
