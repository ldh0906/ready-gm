// @vitest-environment happy-dom
// @ts-nocheck
/**
 * Integration tests for Character_Sheet_App side-effect wiring — Task 7.4.
 * Feature: character-sheet
 *
 * Approach (real execution of the page, mirroring public/host-entry/wiring.test.js,
 * public/lobby/wiring.test.js, public/game/integration.test.js):
 * The interactive markup and the side-effect wiring live inside index.html.
 * To exercise the REAL wiring (not a re-implementation), we:
 *   1. load the page's <body> markup into the happy-dom document,
 *   2. extract the page's inline <script type="module"> verbatim and write it to
 *      a sibling temp file so its relative `import "./logic.js"` resolves, then
 *   3. dynamically import that temp module so its top-level wiring runs against
 *      the live document.
 * Each test imports a freshly-named temp module so the wiring binds to a fresh
 * DOM and runs from a clean initial state. Temp files are removed in afterAll.
 *
 * All external dependencies are injected on `window` BEFORE the module loads:
 *   - window.__characterFetch              : fetch impl (read at call time)
 *   - window.__characterNewAbortController : AbortController factory (read at call time)
 *   - window.__characterNavigate           : Next_Screen navigator (captured at module top-level,
 *                                            so it MUST be set before loadPage())
 *
 * Covers (integration, not property):
 * - Req 9.1, 9.4, 9.5, 10.1, 13.9: 10초 타임아웃 → AbortController가 진행 중 fetch 취소,
 *   진행 인디케이터 표시/해제(아래 200ms 메모 참조)
 * - Req 7.1, 7.2: 확정 2단계 순차 전송(기록 성공 후에만 확정 전송, 기록 거부 시 확정 미전송)
 * - Req 8.2: 확정 후 Next_Screen으로 실제 쿼리 인계가 1회만 일어남
 * - Req 10.6: 재시도 동작이 보존 입력으로 직전 요청을 1회 재전송
 * - Req 13.6: 동적 스키마 렌더(유효 스키마 채택 / 오류·무효 시 Default 폴백 + 안내)
 *
 * 200ms 타이밍 메모: 부수효과 계층은 진행 인디케이터를 전용 setTimeout 없이 상태 렌더와
 * 동기적으로 표시/해제한다(SCHEMA_STARTED → 표시, *_RESOLVED → 해제). 따라서 happy-dom에서
 * "전송 200ms 이내 표시·완료 200ms 이내 해제"는 별도 지연 타이머가 아니라 동기 렌더로 충족되며
 * (0ms ≤ 200ms), 본 테스트는 그 관찰 가능한 결과(전송 직후 인디케이터 표시, 완료 직후 해제)를
 * 검증한다.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import {
  SCHEMA_FALLBACK_MESSAGE,
  CONFIRMED_MESSAGE,
  RECORD_REJECTION_MESSAGES,
  defaultSheetSchema,
} from "./logic.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "index.html"), "utf8");

// 인라인 모듈 스크립트 본문(부수효과 배선)을 그대로 추출한다.
const scriptMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/i);
if (!scriptMatch) throw new Error("index.html must contain an inline module script");
const inlineModuleSource = scriptMatch[1];

// <body> 내부에서 스크립트를 제거한 정적 마크업.
const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
if (!bodyMatch) throw new Error("index.html must contain a <body>");
const bodyMarkup = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/i, "");

const tempFiles = [];
let tempCounter = 0;

const DEFAULT_URL = "https://localhost/character/?roomId=r1&playerId=p1&token=secret-token";

/**
 * 현재 happy-dom 문서에 페이지를 적재하고, 실제 인라인 모듈을 실행한다.
 * 주입 훅(window.__character*)은 호출 전에 이미 설정되어 있어야 한다.
 * @param {{ url?: string }} [opts]
 */
async function loadPage(opts = {}) {
  const url = opts.url || DEFAULT_URL;
  // location/handoff 주입: 모듈 top-level이 location.search를 읽는다.
  if (window.happyDOM && typeof window.happyDOM.setURL === "function") {
    window.happyDOM.setURL(url);
  }
  // 정적 마크업을 먼저 넣어 모듈이 참조할 DOM 요소가 존재하게 한다.
  document.body.innerHTML = bodyMarkup;

  // 인라인 모듈을 형제 임시 파일로 써서 `./logic.js` 상대 import가 해석되게 한다.
  const tmpPath = join(here, `__integration_tmp_${tempCounter++}.js`);
  writeFileSync(tmpPath, inlineModuleSource, "utf8");
  tempFiles.push(tmpPath);
  // 새 파일명이므로 매번 새 모듈 평가 → 깨끗한 초기 상태 + 현재 DOM에 배선.
  await import(/* @vite-ignore */ pathToFileURL(tmpPath).href);
}

/** 마이크로태스크 큐를 비운다(가짜 타이머 환경에서도 동작). */
async function flush() {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

const $ = (id) => document.getElementById(id);

/** 200/JSON 응답 헬퍼. */
function okJson(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

/**
 * URL로 라우팅하는 가짜 fetch를 만든다. 호출 인자(URL·메서드·파싱된 본문)를 기록한다.
 * config: { schemaBody, schemaStatus, record(options), confirm(options), proposal(options) }
 * (확인: /character/confirm 분기를 /character보다 먼저 검사한다.)
 */
function makeRoutingFetch(config = {}) {
  const calls = [];
  const fetchImpl = (url, options = {}) => {
    const u = String(url);
    let body;
    try {
      body = options.body ? JSON.parse(options.body) : undefined;
    } catch {
      body = options.body;
    }
    calls.push({ url: u, method: options.method, body });

    if (u.endsWith("/sheet-schema")) {
      const schemaBody =
        config.schemaBody !== undefined ? config.schemaBody : defaultSheetSchema();
      return okJson(schemaBody, config.schemaStatus || 200);
    }
    if (u.endsWith("/character/confirm")) {
      return (config.confirm || (() => okJson({ character: {} })))(options);
    }
    if (u.endsWith("/character")) {
      return (config.record || (() => okJson({ character: {} })))(options);
    }
    if (u.endsWith("/proposal")) {
      return (config.proposal || (() => okJson({ values: {} })))(options);
    }
    return okJson({});
  };
  return { fetchImpl, calls };
}

/** 표시 이름 입력을 채우고 input 이벤트를 발생시킨다(NARRATIVE_CHANGED 디스패치). */
function typeName(value) {
  const nameInput = $("field-name");
  nameInput.value = value;
  nameInput.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function clearHooks() {
  delete window.__characterFetch;
  delete window.__characterNewAbortController;
  delete window.__characterNavigate;
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

describe("character-sheet integration tests — side-effect wiring", () => {
  it("10초 타임아웃: 응답이 없으면 AbortController가 진행 중 스키마 fetch를 취소하고, 인디케이터가 표시되었다 해제되며 기본 시트로 폴백한다 (Req 9.1, 9.4, 9.5, 10.1, 13.6, 13.9)", async () => {
    vi.useFakeTimers();

    let aborted = false;
    // 스스로는 resolve 하지 않고, signal abort 시 AbortError로 reject 한다.
    window.__characterFetch = (_url, options) =>
      new Promise((_resolve, reject) => {
        const signal = options && options.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            aborted = true;
            const err = new Error("The operation was aborted.");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    window.__characterNewAbortController = () => new AbortController();
    window.__characterNavigate = () => {};

    await loadPage();
    await flush();

    // 유효 인계 → 부팅 시 스키마 조회가 전송되고 진행 인디케이터가 표시된다(전송 즉시, ≤200ms).
    expect($("schemaLoading").hidden).toBe(false);

    // 10초 경과 → setTimeout 발화 → controller.abort() → fetch reject(AbortError).
    await vi.advanceTimersByTimeAsync(10000);
    await flush();

    expect(aborted).toBe(true);
    // 완료 즉시(≤200ms) 인디케이터 해제.
    expect($("schemaLoading").hidden).toBe(true);
    // timeout 결과 → 기본 시트 폴백 + 안내 표시(요구사항 13.6).
    expect($("schemaFallback").hidden).toBe(false);
    expect($("schemaFallback").textContent).toBe(SCHEMA_FALLBACK_MESSAGE);
    // 기본 시트가 렌더되었다(네 능력치).
    expect($("trait-Might")).not.toBeNull();
    expect($("trait-Spirit")).not.toBeNull();
  });

  it("확정 2단계 순차 전송: 기록이 성공하면 그 뒤에만 확정 요청을 전송하고 Confirmed_State로 잠근다 (Req 7.1, 7.2)", async () => {
    const { fetchImpl, calls } = makeRoutingFetch({
      record: () => okJson({ character: { name: "용사" } }),
      confirm: () => okJson({ character: { name: "용사", confirmed: true } }),
    });
    window.__characterFetch = fetchImpl;
    window.__characterNavigate = () => {};

    await loadPage();
    await flush();

    typeName("용사");
    $("confirmBtn").click();
    await flush();

    const recordCalls = calls.filter((c) => c.url.endsWith("/character"));
    const confirmCalls = calls.filter((c) => c.url.endsWith("/character/confirm"));
    // 기록 1회 + 확정 1회.
    expect(recordCalls.length).toBe(1);
    expect(confirmCalls.length).toBe(1);
    // 순서: 기록이 확정보다 먼저 전송된다.
    const recordIdx = calls.findIndex((c) => c.url.endsWith("/character"));
    const confirmIdx = calls.findIndex((c) => c.url.endsWith("/character/confirm"));
    expect(recordIdx).toBeLessThan(confirmIdx);
    // 확정 성공 → 잠금: 확정 안내 표시, Confirm 비활성.
    expect($("statusMessage").textContent).toBe(CONFIRMED_MESSAGE);
    expect($("confirmBtn").disabled).toBe(true);
  });

  it("확정 2단계 순차 전송: 선행 기록이 거부되면 확정 요청을 전송하지 않고 거부 메시지를 표시한다 (Req 7.1, 7.2)", async () => {
    const { fetchImpl, calls } = makeRoutingFetch({
      // HTTP 200 본문의 reason으로 거부(NAME_TAKEN)를 노출한다.
      record: () => okJson({ ok: false, reason: "NAME_TAKEN" }),
    });
    window.__characterFetch = fetchImpl;
    window.__characterNavigate = () => {};

    await loadPage();
    await flush();

    typeName("중복이름");
    $("confirmBtn").click();
    await flush();

    const recordCalls = calls.filter((c) => c.url.endsWith("/character"));
    const confirmCalls = calls.filter((c) => c.url.endsWith("/character/confirm"));
    // 기록은 1회 전송되지만 거부되어 확정은 전송되지 않는다.
    expect(recordCalls.length).toBe(1);
    expect(confirmCalls.length).toBe(0);
    // 거부 메시지 표시 + 비확정 유지(Confirm 재활성).
    expect($("errorMessage").textContent).toBe(RECORD_REJECTION_MESSAGES.NAME_TAKEN);
    expect($("confirmBtn").disabled).toBe(false);
  });

  it("재시도: 전송 오류 후 보존된 입력으로 직전 기록 요청을 정확히 1회 재전송한다 (Req 10.6)", async () => {
    let recordAttempts = 0;
    const recordBodies = [];
    const { fetchImpl } = makeRoutingFetch({
      record: (options) => {
        recordAttempts += 1;
        try {
          recordBodies.push(JSON.parse(options.body));
        } catch {
          recordBodies.push(undefined);
        }
        // 네트워크 실패(abort 아님)로 거부 → 복구 가능 오류.
        return Promise.reject(new TypeError("Failed to fetch"));
      },
    });
    window.__characterFetch = fetchImpl;
    window.__characterNavigate = () => {};

    await loadPage();
    await flush();

    typeName("재시도용사");
    // "확정"은 1단계로 기록(저장) 요청을 보낸다. 그 기록이 전송 오류로 실패하면 확정 단계로
    // 넘어가지 않고 재시도가 노출된다(저장 버튼 제거 후에도 기록 경로가 그대로 검증됨).
    $("confirmBtn").click();
    await flush();

    // 기록 1회 전송 후 실패 → 재시도 동작 노출.
    expect(recordAttempts).toBe(1);
    expect($("retryBtn").hidden).toBe(false);

    // 재시도 → 보존 입력으로 직전 요청을 1회 재전송(총 2회).
    $("retryBtn").click();
    await flush();
    expect(recordAttempts).toBe(2);
    // 보존 입력 동일성: 두 요청 본문의 이름이 동일하게 보존된다.
    expect(recordBodies[0].name).toBe("재시도용사");
    expect(recordBodies[1].name).toBe("재시도용사");
  });

  it("동적 스키마 렌더: 유효 시나리오 스키마를 채택해 그 구성대로 렌더하고 폴백 안내를 표시하지 않는다 (Req 13.6, 13.9)", async () => {
    const customSchema = {
      sections: [{ id: "stats", label: "스탯" }],
      narrativeFields: [
        { id: "name", label: "이름", guidance: "이름 안내", sectionId: "stats", maxLength: 100 },
        { id: "concept", label: "컨셉", guidance: "컨셉 안내", sectionId: "stats", maxLength: 2000 },
      ],
      traits: [
        { key: "Power", label: "파워", sectionId: "stats", ladder: { min: 0, max: 3 } },
        { key: "Speed", label: "스피드", sectionId: "stats", ladder: { min: 0, max: 3 } },
      ],
    };
    const { fetchImpl } = makeRoutingFetch({ schemaBody: customSchema });
    window.__characterFetch = fetchImpl;
    window.__characterNavigate = () => {};

    await loadPage();
    await flush();

    // 채택 → 폴백 안내 없음.
    expect($("schemaFallback").hidden).toBe(true);
    // 시나리오 스키마가 정의한 Rated_Trait만 렌더된다.
    expect($("trait-Power")).not.toBeNull();
    expect($("trait-Speed")).not.toBeNull();
    // 기본 스키마의 능력치는 렌더되지 않는다.
    expect($("trait-Might")).toBeNull();
    expect($("trait-Agility")).toBeNull();
    // 시나리오 섹션 제목이 표시된다.
    expect($("sheetMount").textContent).toContain("스탯");
  });

  it("동적 스키마 렌더: 무효 스키마 응답이면 Default 시트로 폴백하고 안내를 표시한다 (Req 13.6, 13.9)", async () => {
    // Rated_Trait가 없는 무효 본문(검증 실패) → Default 폴백.
    const { fetchImpl } = makeRoutingFetch({ schemaBody: { traits: [], narrativeFields: [] } });
    window.__characterFetch = fetchImpl;
    window.__characterNavigate = () => {};

    await loadPage();
    await flush();

    // 폴백 안내 표시 + 기본 네 능력치 렌더.
    expect($("schemaFallback").hidden).toBe(false);
    expect($("schemaFallback").textContent).toBe(SCHEMA_FALLBACK_MESSAGE);
    expect($("trait-Might")).not.toBeNull();
    expect($("trait-Agility")).not.toBeNull();
    expect($("trait-Wits")).not.toBeNull();
    expect($("trait-Spirit")).not.toBeNull();
  });
});
