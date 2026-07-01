// @vitest-environment happy-dom
// @ts-nocheck
/**
 * Integration tests for Host_Entry_App side-effect wiring — Task 6.4.
 * Feature: frontend-applications
 *
 * Approach (option a — real execution of the page):
 * The interactive markup and the side-effect wiring live inside index.html.
 * To exercise the REAL wiring (not a re-implementation), we:
 *   1. load the page's <body> markup into the happy-dom document,
 *   2. extract the page's inline <script type="module"> verbatim and write it to
 *      a sibling temp file so its relative `import "./logic.js"` resolves, then
 *   3. dynamically import that temp module so its top-level wiring runs against
 *      the live document, with global fetch / navigator.clipboard / location and
 *      timers stubbed.
 * Each test imports a freshly-named temp module so the wiring binds to a fresh
 * DOM and runs from a clean initial state. Temp files are removed in afterAll.
 *
 * Covers (integration, not property):
 * - Req 3.5: 10s client timeout → AbortController cancels fetch → "timeout" flow
 * - Req 5.4: clipboard failure → manual-copy fallback revealed
 * - Req 7.1, 8.1, 8.2: Korean error messages for validation(400)/server(5xx)/network
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { ERROR_MESSAGES } from "./logic.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "index.html"), "utf8");

// 인라인 모듈 스크립트 본문(검증/배선)을 그대로 추출한다.
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
  const url = opts.url || "https://localhost/host-entry/?token=secret-token";
  // location/token 주입: 모듈 top-level이 location.search를 읽는다.
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

function setClipboard(impl) {
  Object.defineProperty(navigator, "clipboard", {
    value: impl,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>";
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

describe("frontend-applications integration tests — side-effect wiring", () => {
  it("10초 타임아웃: 응답이 없으면 AbortController가 fetch를 취소하고 timeout 흐름으로 회복한다 (Req 3.5)", async () => {
    vi.useFakeTimers();

    let abortedByController = false;
    // 스스로는 절대 resolve 하지 않고, signal abort 시 AbortError로 reject 한다.
    globalThis.fetch = vi.fn((_url, options) => {
      return new Promise((_resolve, reject) => {
        const signal = options && options.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            abortedByController = true;
            const err = new Error("The operation was aborted.");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    });
    setClipboard(undefined);

    await loadPage();

    // 표시 이름 입력 후 제출 → submitting 진입 + 요청 전송.
    const nameInput = document.getElementById("displayName");
    nameInput.value = "타임아웃호스트";
    nameInput.dispatchEvent(new window.Event("input", { bubbles: true }));

    document.getElementById("submitBtn").click();
    await flush();

    // 요청이 전송되고 진행 인디케이터가 표시된 상태.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(document.getElementById("progress").hidden).toBe(false);
    expect(document.getElementById("submitBtn").disabled).toBe(true);

    // 10초 경과 → setTimeout 발화 → controller.abort() → fetch reject(AbortError).
    await vi.advanceTimersByTimeAsync(10000);
    await flush();

    expect(abortedByController).toBe(true);
    // timeout 결과로 회복: 인디케이터 해제, Submit 재활성, 폼 오류에 timeout 메시지.
    expect(document.getElementById("progress").hidden).toBe(true);
    expect(document.getElementById("submitBtn").disabled).toBe(false);
    const formError = document.getElementById("formError");
    expect(formError.hidden).toBe(false);
    expect(formError.textContent).toBe(ERROR_MESSAGES.timeout);
  });

  it("클립보드 실패: writeText가 거부되면 수동 복사 폴백(#copyFallback)이 노출된다 (Req 5.4)", async () => {
    // 성공 응답으로 invite 패널을 띄운 뒤 복사를 시도한다.
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 201,
        json: () =>
          Promise.resolve({
            roomId: "room-1",
            inviteToken: "tok-1",
            inviteLink: "https://ready-gm.example/join/room-1?t=tok-1",
            hostPlayerId: "host-1",
            state: "lobby",
            maxPlayers: 5,
          }),
      }),
    );
    // writeText가 항상 거부 → copyInviteLink false → 폴백 노출.
    setClipboard({ writeText: () => Promise.reject(new Error("denied")) });

    await loadPage();

    const nameInput = document.getElementById("displayName");
    nameInput.value = "복사테스트";
    nameInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    document.getElementById("submitBtn").click();
    await flush();

    // 성공 패널이 표시되고 수동 복사 입력에 전체 링크가 채워진다.
    const invitePanel = document.getElementById("invitePanel");
    expect(invitePanel.hidden).toBe(false);
    const manualCopy = document.getElementById("manualCopy");
    expect(manualCopy.value).toBe("https://ready-gm.example/join/room-1?t=tok-1");

    // 폴백은 복사 시도 전에는 숨겨져 있다.
    const copyFallback = document.getElementById("copyFallback");
    expect(copyFallback.hidden).toBe(true);

    // 복사 시도 → 실패 → 폴백 노출.
    document.getElementById("copyBtn").click();
    await flush();

    expect(copyFallback.hidden).toBe(false);
    // 수동 복사용 입력은 여전히 전체 링크를 보유한다(직접 선택·복사 가능).
    expect(manualCopy.value).toBe("https://ready-gm.example/join/room-1?t=tok-1");
  });

  it("400 응답: 입력 인접 영역(#nameError)에 한국어 검증 메시지가 표시된다 (Req 7.1)", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 400 }));
    setClipboard(undefined);

    await loadPage();

    const nameInput = document.getElementById("displayName");
    nameInput.value = "검증호스트";
    nameInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    document.getElementById("submitBtn").click();
    await flush();

    // validation 오류는 입력 인접 #nameError에 표시되고 폼 오류 영역은 숨김.
    const nameError = document.getElementById("nameError");
    expect(nameError.textContent).toBe(ERROR_MESSAGES.validation);
    expect(document.getElementById("formError").hidden).toBe(true);
    // 회복 가능: 인디케이터 해제, Submit 재활성, 입력 보존.
    expect(document.getElementById("progress").hidden).toBe(true);
    expect(document.getElementById("submitBtn").disabled).toBe(false);
    expect(nameInput.value).toBe("검증호스트");
  });

  it("5xx 응답: 폼 오류 영역(#formError)에 한국어 서버 오류 메시지가 표시된다 (Req 8.2)", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 503 }));
    setClipboard(undefined);

    await loadPage();

    const nameInput = document.getElementById("displayName");
    nameInput.value = "서버오류호스트";
    nameInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    document.getElementById("submitBtn").click();
    await flush();

    const formError = document.getElementById("formError");
    expect(formError.hidden).toBe(false);
    expect(formError.textContent).toBe(ERROR_MESSAGES.server);
    // 입력 인접 영역에는 메시지가 없다(서버 오류는 폼 오류 영역에 표시).
    expect(document.getElementById("nameError").textContent).toBe("");
    expect(document.getElementById("submitBtn").disabled).toBe(false);
  });

  it("네트워크 실패: 폼 오류 영역(#formError)에 한국어 연결 오류 메시지가 표시된다 (Req 8.1)", async () => {
    // abort가 아닌 일반 reject → 네트워크 오류로 분류.
    globalThis.fetch = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    setClipboard(undefined);

    await loadPage();

    const nameInput = document.getElementById("displayName");
    nameInput.value = "네트워크호스트";
    nameInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    document.getElementById("submitBtn").click();
    await flush();

    const formError = document.getElementById("formError");
    expect(formError.hidden).toBe(false);
    expect(formError.textContent).toBe(ERROR_MESSAGES.network);
    expect(document.getElementById("submitBtn").disabled).toBe(false);
    // 입력값은 보존된다(즉시 재시도 가능).
    expect(nameInput.value).toBe("네트워크호스트");
  });
});
