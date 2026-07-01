// @vitest-environment happy-dom
// @ts-nocheck
/**
 * Integration tests for Join_App side-effect wiring.
 * Feature: multiplayer-session-flow — 단계 1 (초대 입장 화면)
 *
 * Approach (option a — real execution of the page), mirroring host-entry/wiring.test.js:
 * The interactive markup and the side-effect wiring live inside index.html.
 * To exercise the REAL wiring (not a re-implementation), we:
 *   1. load the page's <body> markup into the happy-dom document,
 *   2. extract the page's inline <script type="module"> verbatim and write it to
 *      a sibling temp file so its relative `import "./logic.js"` resolves, then
 *   3. dynamically import that temp module so its top-level wiring runs against
 *      the live document, with injectable window.__joinFetch / __joinNavigate /
 *      __joinNewAbortController hooks and the page URL stubbed.
 *
 * Covers (integration, not property):
 * - invalid token: 입장 비활성 + 무효 안내 노출, 요청 미전송
 * - blank name: 입력 인접 안내 노출, 요청 미전송
 * - successful join: 입장 playerId가 쿼리에 담겨 /lobby/로 이동
 * - 409 full: 정원 초과 메시지 노출
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { OUTCOME_MESSAGES, BLANK_NAME_MESSAGE, INVALID_LINK_MESSAGE } from "./logic.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "index.html"), "utf8");

// 인라인 모듈 스크립트 본문(배선)을 그대로 추출한다.
const scriptMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/i);
if (!scriptMatch) throw new Error("index.html must contain an inline module script");
const inlineModuleSource = scriptMatch[1];

// <body> 내부에서 스크립트를 제거한 정적 마크업.
const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
if (!bodyMatch) throw new Error("index.html must contain a <body>");
const bodyMarkup = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/i, "");

const tempFiles = [];
let tempCounter = 0;

/**
 * 현재 happy-dom 문서에 페이지를 적재하고, 실제 인라인 모듈을 실행한다.
 * @param {{ url?: string }} [opts]
 */
async function loadPage(opts = {}) {
  const url = opts.url || "https://localhost/join/invite-tok-1";
  // location 주입: 모듈 top-level이 location.pathname / location.search를 읽는다.
  if (window.happyDOM && typeof window.happyDOM.setURL === "function") {
    window.happyDOM.setURL(url);
  }
  // 정적 마크업을 먼저 넣어 모듈이 참조할 DOM 요소가 존재하게 한다.
  document.body.innerHTML = bodyMarkup;

  // 인라인 모듈을 형제 임시 파일로 써서 `./logic.js` 상대 import가 해석되게 한다.
  const tmpPath = join(here, `__wiring_tmp_${tempCounter++}.js`);
  writeFileSync(tmpPath, inlineModuleSource, "utf8");
  tempFiles.push(tmpPath);
  // 새 파일명이므로 매번 새 모듈 평가 → 깨끗한 초기 상태 + 현재 DOM에 배선.
  await import(/* @vite-ignore */ pathToFileURL(tmpPath).href);
}

/** 마이크로태스크 큐를 비운다(가짜 타이머 환경에서도 동작). */
async function flush() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>";
  delete window.__joinFetch;
  delete window.__joinNavigate;
  delete window.__joinNewAbortController;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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

describe("multiplayer-session-flow 단계1 — join wiring", () => {
  it("초대 토큰 없음: 입장 버튼이 비활성화되고 무효 안내가 노출되며 요청을 보내지 않는다", async () => {
    const fetchSpy = vi.fn();
    window.__joinFetch = fetchSpy;

    // 토큰이 없는 경로(/join 또는 /join/)로 로드.
    await loadPage({ url: "https://localhost/join/" });

    const invalidNotice = document.getElementById("invalidNotice");
    expect(invalidNotice.hidden).toBe(false);
    expect(invalidNotice.textContent).toBe(INVALID_LINK_MESSAGE);

    const joinBtn = document.getElementById("joinBtn");
    expect(joinBtn.disabled).toBe(true);

    // 클릭해도 요청은 전송되지 않는다.
    joinBtn.click();
    await flush();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("빈 이름: 입력 인접 안내(#nameError)를 표시하고 요청을 보내지 않는다", async () => {
    const fetchSpy = vi.fn();
    window.__joinFetch = fetchSpy;

    await loadPage();

    // 이름을 비운 채 입장 클릭.
    const nameInput = document.getElementById("displayName");
    nameInput.value = "   "; // 공백만
    document.getElementById("joinBtn").click();
    await flush();

    const nameError = document.getElementById("nameError");
    expect(nameError.textContent).toBe(BLANK_NAME_MESSAGE);
    expect(fetchSpy).not.toHaveBeenCalled();
    // 진행 인디케이터는 뜨지 않는다.
    expect(document.getElementById("progress").hidden).toBe(true);
  });

  it("입장 성공: 입장 playerId가 쿼리에 담겨 /lobby/로 이동한다", async () => {
    window.__joinFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ roomId: "room-7", playerId: "player-42", displayName: "참가자" }),
      }),
    );
    const navSpy = vi.fn();
    window.__joinNavigate = navSpy;

    await loadPage({ url: "https://localhost/join/invite-tok-9?token=secret" });

    const nameInput = document.getElementById("displayName");
    nameInput.value = "참가자";
    document.getElementById("joinBtn").click();
    await flush();

    // POST /rooms/invite-tok-9/join 로 요청.
    expect(window.__joinFetch).toHaveBeenCalledTimes(1);
    const [calledUrl] = window.__joinFetch.mock.calls[0];
    expect(calledUrl).toBe("/rooms/invite-tok-9/join");

    // 로비로 이동: 입장한 playerId가 쿼리에 담긴다.
    expect(navSpy).toHaveBeenCalledTimes(1);
    const search = navSpy.mock.calls[0][0];
    const params = new URLSearchParams(search);
    expect(params.get("roomId")).toBe("room-7");
    expect(params.get("playerId")).toBe("player-42");
    expect(params.get("token")).toBe("secret");
    // 입장 플레이어는 호스트가 아니다.
    expect(params.has("hostPlayerId")).toBe(false);
  });

  it("409 정원 초과: 정원 가득 참 메시지를 표시하고 재시도를 허용한다", async () => {
    window.__joinFetch = vi.fn(() => Promise.resolve({ ok: false, status: 409 }));
    const navSpy = vi.fn();
    window.__joinNavigate = navSpy;

    await loadPage();

    const nameInput = document.getElementById("displayName");
    nameInput.value = "늦은참가자";
    document.getElementById("joinBtn").click();
    await flush();

    const formError = document.getElementById("formError");
    expect(formError.hidden).toBe(false);
    expect(formError.textContent).toBe(OUTCOME_MESSAGES.full);
    // 이동하지 않는다.
    expect(navSpy).not.toHaveBeenCalled();
    // 재시도 허용: 인디케이터 해제, 입장 버튼 재활성.
    expect(document.getElementById("progress").hidden).toBe(true);
    expect(document.getElementById("joinBtn").disabled).toBe(false);
  });
});
