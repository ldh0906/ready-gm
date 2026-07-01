// @vitest-environment happy-dom
// @ts-nocheck
/**
 * DOM/wiring tests for the Character_Sheet_App readiness + host-start layer — ADDITIVE.
 * Feature: character-sheet (multiplayer readiness flow)
 *
 * Approach mirrors integration.test.js: the interactive markup and side-effect
 * wiring live inside index.html. We load the page <body> markup into happy-dom,
 * extract the inline <script type="module"> verbatim to a sibling temp file so
 * its `import "./logic.js"` resolves, then dynamically import it so the real
 * top-level wiring runs against the live document.
 *
 * Injected hooks (set BEFORE loadPage):
 *   - window.__characterFetch            : fetch impl (read at call time)
 *   - window.__characterNavigate         : Next_Screen navigator (captured at module top-level)
 *   - window.__characterReadinessPollMs  : readiness poll interval in ms (test-controllable)
 *
 * Covered:
 *   - non-host: waiting notice shown + no enabled start button
 *   - host: start button enabled only when allConfirmed
 *   - readiness poll returning started:true → navigate once to /game/ with playerId
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { WAITING_FOR_HOST_MESSAGE, buildNextSearch } from "./logic.js";

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

const DEFAULT_URL = "https://localhost/character/?roomId=r1&playerId=p1&token=secret-token";

async function loadPage(opts = {}) {
  const url = opts.url || DEFAULT_URL;
  if (window.happyDOM && typeof window.happyDOM.setURL === "function") {
    window.happyDOM.setURL(url);
  }
  document.body.innerHTML = bodyMarkup;
  const tmpPath = join(here, `__readiness_tmp_${tempCounter++}.js`);
  writeFileSync(tmpPath, inlineModuleSource, "utf8");
  tempFiles.push(tmpPath);
  await import(/* @vite-ignore */ pathToFileURL(tmpPath).href);
}

async function flush() {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

const $ = (id) => document.getElementById(id);

function okJson(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

/**
 * Routing fetch driven by a mutable `readinessRef.value`. Records start calls.
 * Always serves the default sheet schema for /sheet-schema so the sheet renders.
 */
function makeFetch(readinessRef) {
  const startCalls = [];
  const fetchImpl = (url, options = {}) => {
    const u = String(url);
    if (u.endsWith("/sheet-schema")) {
      return okJson({
        sections: [
          { id: "narrative", label: "서사" },
          { id: "attributes", label: "능력치" },
        ],
        narrativeFields: [
          { id: "name", label: "이름", guidance: "g", sectionId: "narrative", maxLength: 100 },
          { id: "concept", label: "컨셉", guidance: "g", sectionId: "narrative", maxLength: 2000 },
        ],
        traits: [{ key: "Might", label: "힘", sectionId: "attributes", ladder: { min: -2, max: 4 } }],
      });
    }
    if (u.endsWith("/readiness")) {
      return okJson(readinessRef.value);
    }
    if (u.endsWith("/start")) {
      startCalls.push({ url: u, method: options.method });
      return okJson({ ok: true, started: true });
    }
    return okJson({});
  };
  return { fetchImpl, startCalls };
}

function clearHooks() {
  delete window.__characterFetch;
  delete window.__characterNewAbortController;
  delete window.__characterNavigate;
  delete window.__characterReadinessPollMs;
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

describe("character-sheet readiness wiring — multiplayer host-start", () => {
  it("비호스트: 호스트 대기 안내를 표시하고 활성화된 세션 시작 버튼이 없다", async () => {
    vi.useFakeTimers();
    const readinessRef = {
      value: { total: 2, confirmed: 1, allConfirmed: false, started: false, hostPlayerId: "other" },
    };
    const { fetchImpl } = makeFetch(readinessRef);
    window.__characterFetch = fetchImpl;
    window.__characterNavigate = () => {};
    window.__characterReadinessPollMs = 2000;

    await loadPage();
    await flush();

    // 준비 인원 표시.
    expect($("readinessText").textContent).toBe("준비 1 / 2");
    // 비호스트: 시작 버튼 숨김, 대기 안내 표시.
    expect($("startSessionBtn").hidden).toBe(true);
    expect($("waitingForHost").hidden).toBe(false);
    expect($("waitingForHost").textContent).toBe(WAITING_FOR_HOST_MESSAGE);
    // 활성화된 시작 버튼이 없다(숨김이거나 비활성).
    expect($("startSessionBtn").hidden || $("startSessionBtn").disabled).toBe(true);
  });

  it("호스트: 전원 확정일 때만 세션 시작 버튼이 활성화된다", async () => {
    vi.useFakeTimers();
    const readinessRef = {
      value: { total: 2, confirmed: 1, allConfirmed: false, started: false, hostPlayerId: "p1" },
    };
    const { fetchImpl, startCalls } = makeFetch(readinessRef);
    window.__characterFetch = fetchImpl;
    window.__characterNavigate = () => {};
    window.__characterReadinessPollMs = 2000;

    await loadPage();
    await flush();

    // 호스트(viewer playerId p1 === hostPlayerId): 버튼 노출, 미확정이라 비활성.
    expect($("startSessionBtn").hidden).toBe(false);
    expect($("startSessionBtn").disabled).toBe(true);
    expect($("waitingForHost").hidden).toBe(true);

    // 전원 확정으로 바뀌면 다음 폴링에서 버튼이 활성화된다.
    readinessRef.value = { total: 2, confirmed: 2, allConfirmed: true, started: false, hostPlayerId: "p1" };
    await vi.advanceTimersByTimeAsync(2000);
    await flush();

    expect($("startSessionBtn").disabled).toBe(false);

    // 클릭하면 start 요청을 전송한다.
    $("startSessionBtn").click();
    await flush();
    expect(startCalls.length).toBe(1);
    expect(startCalls[0].method).toBe("POST");
  });

  it("readiness 폴링이 started:true를 반환하면 게임 화면으로 정확히 1회 이동한다(viewer playerId 포함)", async () => {
    vi.useFakeTimers();
    const readinessRef = {
      value: { total: 2, confirmed: 2, allConfirmed: true, started: false, hostPlayerId: "other" },
    };
    const { fetchImpl } = makeFetch(readinessRef);
    const navCalls = [];
    window.__characterFetch = fetchImpl;
    window.__characterNavigate = (search) => navCalls.push(search);
    window.__characterReadinessPollMs = 2000;

    await loadPage();
    await flush();
    // 아직 시작 전이라 이동하지 않는다.
    expect(navCalls.length).toBe(0);

    // 세션 시작 → 다음 폴링에서 started:true 관찰 → 1회 이동.
    readinessRef.value = { total: 2, confirmed: 2, allConfirmed: true, started: true, hostPlayerId: "other" };
    await vi.advanceTimersByTimeAsync(2000);
    await flush();

    expect(navCalls.length).toBe(1);
    expect(navCalls[0]).toBe(
      buildNextSearch({ roomId: "r1", playerId: "p1", token: "secret-token" }),
    );
    // viewer playerId가 쿼리에 포함된다.
    expect(navCalls[0]).toContain("playerId=p1");

    // 폴링이 멈췄으므로 추가 이동은 없다.
    await vi.advanceTimersByTimeAsync(4000);
    await flush();
    expect(navCalls.length).toBe(1);
  });
});
