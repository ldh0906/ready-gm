// @vitest-environment happy-dom
// @ts-nocheck
/**
 * Integration tests for Room_Lobby_App custom scenario combobox rendering.
 * Feature: room-lobby (custom combobox — name + metadata sub-box, genre grouping)
 *
 * Mirrors the side-effect wiring harness in wiring.test.js: the page's inline
 * module is extracted to a sibling temp file and dynamically imported so the
 * REAL wiring runs against a live happy-dom document. External dependencies are
 * injected on `window` before the module loads.
 *
 * The scenario picker is a custom listbox (NOT a native <select>): the trigger
 * button (#scenarioTrigger / #scenarioTriggerLabel) opens #scenarioListbox,
 * which renders genre group headers (.combobox-group-label + .combobox-group-desc)
 * and option items (.combobox-option) each showing the title (.combobox-option-title,
 * NO "— genre" suffix) and a small metadata sub-box (.combobox-option-meta with
 * .combobox-option-meta-seg segments). The pure genre grouping/ordering logic is
 * covered by genre-grouping.test.js; here we assert the DOM rendering + selection.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "index.html"), "utf8");

const scriptMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/i);
if (!scriptMatch) throw new Error("index.html must contain an inline module script");
const inlineModuleSource = scriptMatch[1];

const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
if (!bodyMatch) throw new Error("index.html must contain a <body>");
const bodyMarkup = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/i, "");

const tempFiles = [];
let tempCounter = 0;

async function loadPage(opts = {}) {
  const url = opts.url || "https://localhost/lobby/?roomId=r1&hostPlayerId=h1";
  if (window.happyDOM && typeof window.happyDOM.setURL === "function") {
    window.happyDOM.setURL(url);
  }
  document.body.innerHTML = bodyMarkup;
  const tmpPath = join(here, `__scenario_meta_tmp_${tempCounter++}.js`);
  writeFileSync(tmpPath, inlineModuleSource, "utf8");
  tempFiles.push(tmpPath);
  await import(/* @vite-ignore */ pathToFileURL(tmpPath).href);
}

async function flush() {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

function makeFakeConnect() {
  const calls = [];
  const sent = [];
  let handlers = null;
  const connect = (roomId, token, h) => {
    calls.push({ roomId, token });
    handlers = h;
    return { send: (obj) => sent.push(obj), close: () => {} };
  };
  return {
    connect,
    calls,
    sent,
    get handlers() {
      return handlers;
    },
  };
}

function clearHooks() {
  delete window.__lobbyFetch;
  delete window.__lobbyNewAbortController;
  delete window.__lobbyConnect;
  delete window.__lobbyClipboard;
}

beforeEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>";
  clearHooks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  clearHooks();
});

afterAll(() => {
  for (const f of tempFiles) {
    try {
      unlinkSync(f);
    } catch {
      /* already gone */
    }
  }
});

const $ = (id) => document.getElementById(id);

// /scenarios만 응답하고, 그 외(invite/room)는 영원히 pending인 fetch.
function scenariosFetch(scenarios) {
  return (url) => {
    if (typeof url === "string" && url === "/scenarios") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ scenarios }),
      });
    }
    return new Promise(() => {});
  };
}

/** 리스트박스 안의 옵션 요소들과 그 제목/메타 세그먼트 텍스트를 추출한다. */
function readOptions() {
  const listbox = $("scenarioListbox");
  const opts = Array.from(listbox.querySelectorAll(".combobox-option"));
  return opts.map((opt) => ({
    el: opt,
    scenarioId: opt.dataset.scenarioId,
    title: opt.querySelector(".combobox-option-title")?.textContent ?? "",
    metaSegs: Array.from(opt.querySelectorAll(".combobox-option-meta-seg")).map(
      (s) => s.textContent,
    ),
    hasMeta: !!opt.querySelector(".combobox-option-meta"),
  }));
}

/** 그룹 머리글(라벨/설명)을 추출한다. */
function readGroups() {
  const listbox = $("scenarioListbox");
  return Array.from(listbox.querySelectorAll(".combobox-group")).map((g) => ({
    label: g.querySelector(".combobox-group-label")?.textContent ?? "",
    desc: g.querySelector(".combobox-group-desc")?.textContent ?? "",
  }));
}

describe("room-lobby integration — custom scenario combobox metadata", () => {
  it("옵션 제목엔 장르 접미사가 없고, 각 옵션 아래 메타 서브박스가 장르/구성요소/시스템/형식을 보여준다", async () => {
    const fake = makeFakeConnect();
    const scenarios = [
      {
        id: "s1",
        title: "잃어버린 동굴",
        summary: "어두운 동굴 탐험.",
        genre: "판타지",
        category: "탐험·전투",
        system: "d20",
        form: "원샷",
      },
      {
        id: "s2",
        title: "도시의 그림자",
        summary: "느와르 추적극.",
        genre: "미스터리",
        category: "조사",
        system: "PbtA",
        form: "캠페인",
      },
    ];
    window.__lobbyFetch = scenariosFetch(scenarios);
    window.__lobbyNewAbortController = () => new AbortController();
    window.__lobbyConnect = fake.connect;

    await loadPage();
    await flush();

    const opts = readOptions();
    expect(opts.length).toBe(2);

    // 제목은 정확히 시나리오 제목과 같다(이름 옆 "— 장르" 접미사가 없다).
    const byId = Object.fromEntries(opts.map((o) => [o.scenarioId, o]));
    expect(byId.s1.title).toBe("잃어버린 동굴");
    expect(byId.s2.title).toBe("도시의 그림자");

    // 각 옵션의 메타 서브박스가 네 세그먼트를 보여준다.
    expect(byId.s1.metaSegs).toEqual([
      "장르: 판타지",
      "구성요소: 탐험·전투",
      "시스템: d20",
      "형식: 원샷",
    ]);
    expect(byId.s2.metaSegs).toEqual([
      "장르: 미스터리",
      "구성요소: 조사",
      "시스템: PbtA",
      "형식: 캠페인",
    ]);

    // 장르 그룹 머리글이 공통 장르 설명을 표시한다(판타지가 미스터리보다 먼저).
    const groups = readGroups();
    expect(groups.length).toBe(2);
    expect(groups[0].label).toBe("판타지·모험");
    expect(groups[0].desc.length).toBeGreaterThan(0);
    expect(groups[1].label).toBe("호러·미스터리");
    expect(groups[1].desc.length).toBeGreaterThan(0);
  });

  it("옵션 선택 시 트리거 라벨과 #scenarioMeta가 갱신되고 SET_SCENARIO를 보낸다", async () => {
    const fake = makeFakeConnect();
    const scenarios = [
      {
        id: "s1",
        title: "잃어버린 동굴",
        summary: "어두운 동굴 탐험.",
        genre: "판타지",
        category: "탐험·전투",
        system: "d20",
        form: "원샷",
      },
      {
        id: "s2",
        title: "도시의 그림자",
        summary: "느와르 추적극.",
        genre: "미스터리",
        category: "조사",
        system: "PbtA",
        form: "캠페인",
      },
    ];
    window.__lobbyFetch = scenariosFetch(scenarios);
    window.__lobbyNewAbortController = () => new AbortController();
    window.__lobbyConnect = fake.connect;

    await loadPage();
    await flush();

    // 연결을 활성화해 트리거를 사용할 수 있게 한 뒤 콤보박스를 연다.
    fake.handlers.onOpen();
    await flush();
    const trigger = $("scenarioTrigger");
    expect(trigger.disabled).toBe(false);
    trigger.click();
    await flush();
    expect($("scenarioListbox").hidden).toBe(false);

    // s2 옵션을 클릭해 선택한다.
    const opts = readOptions();
    const s2 = opts.find((o) => o.scenarioId === "s2");
    s2.el.click();
    await flush();

    // 트리거 라벨이 선택 제목으로 갱신된다.
    expect($("scenarioTriggerLabel").textContent).toContain("도시의 그림자");

    // 선택 시나리오 메타 줄(#scenarioMeta)이 메타데이터를 보여준다.
    const meta = $("scenarioMeta");
    expect(meta.hidden).toBe(false);
    expect(meta.textContent).toBe("장르: 미스터리 · 구성요소: 조사 · 시스템: PbtA · 형식: 캠페인");

    // SET_SCENARIO가 채널로 전송된다.
    expect(fake.sent.some((m) => m.type === "SET_SCENARIO" && m.scenarioId === "s2")).toBe(true);
  });

  it("빈 값(빈 문자열) 세그먼트는 옵션 서브박스와 메타 줄에서 생략된다", async () => {
    const fake = makeFakeConnect();
    const scenarios = [
      {
        id: "s1",
        title: "정적의 방",
        summary: "단서만 남은 방.",
        genre: "미스터리",
        category: "", // 빈 구성요소 → 생략
        system: "  ", // 공백 시스템 → 생략
        form: "", // 빈 형식 → 생략
      },
    ];
    window.__lobbyFetch = scenariosFetch(scenarios);
    window.__lobbyNewAbortController = () => new AbortController();
    window.__lobbyConnect = fake.connect;

    await loadPage();
    await flush();

    const opts = readOptions();
    expect(opts.length).toBe(1);
    // 메타 서브박스엔 장르 세그먼트만 남는다.
    expect(opts[0].metaSegs).toEqual(["장르: 미스터리"]);

    // 선택 후 메타 줄도 장르만 표시한다.
    fake.handlers.onOpen();
    await flush();
    $("scenarioTrigger").click();
    await flush();
    opts[0].el.click();
    await flush();

    const meta = $("scenarioMeta");
    expect(meta.textContent).toBe("장르: 미스터리");
    expect(meta.textContent).not.toContain("구성요소");
    expect(meta.textContent).not.toContain("시스템");
    expect(meta.textContent).not.toContain("형식");
  });

  it("메타데이터가 전혀 없으면 옵션엔 서브박스가 없고 #scenarioMeta는 숨겨진다", async () => {
    const fake = makeFakeConnect();
    const scenarios = [{ id: "s1", title: "이름만 있는 시나리오", summary: "요약." }];
    window.__lobbyFetch = scenariosFetch(scenarios);
    window.__lobbyNewAbortController = () => new AbortController();
    window.__lobbyConnect = fake.connect;

    await loadPage();
    await flush();

    const opts = readOptions();
    expect(opts.length).toBe(1);
    expect(opts[0].title).toBe("이름만 있는 시나리오");
    // 메타가 전혀 없으므로 서브박스가 렌더되지 않는다.
    expect(opts[0].hasMeta).toBe(false);

    // 선택해도 #scenarioMeta는 비어 있고 숨겨진다.
    fake.handlers.onOpen();
    await flush();
    $("scenarioTrigger").click();
    await flush();
    opts[0].el.click();
    await flush();

    const meta = $("scenarioMeta");
    expect(meta.textContent).toBe("");
    expect(meta.hidden).toBe(true);
  });
});
