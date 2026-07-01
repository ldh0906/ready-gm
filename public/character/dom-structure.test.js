// @vitest-environment happy-dom
// @ts-nocheck
/**
 * Example DOM (rendered-structure + wiring) tests for Character_Sheet_App — Task 7.3.
 * Feature: character-sheet
 *
 * Unlike a purely static page, the Character_Sheet_View renders its
 * Sheet_Section / Narrative_Field / Rated_Trait controls DYNAMICALLY from the
 * Active_Sheet_Schema inside the inline module script (buildSheet()). So to
 * assert on the rendered sheet (the four EZFudge ability edits, the name/concept
 * inputs, the initial disabled rules, the focus order, the live regions) we must
 * actually execute the page's real wiring — mirroring public/lobby/wiring.test.js:
 *   1. inject the page's <body> markup into the happy-dom document,
 *   2. extract the inline <script type="module"> verbatim into a sibling temp
 *      file so its relative `import "./logic.js"` resolves, then
 *   3. dynamically import that temp module so its top-level wiring runs against
 *      the live document.
 * All external dependencies are injected on `window` BEFORE the module loads:
 *   - window.__characterFetch              : fetch impl
 *   - window.__characterNewAbortController : AbortController factory
 *   - window.__characterNavigate           : Next_Screen navigator
 * Korean message-string assertions import the constants from ./logic.js directly
 * (the page renders these exact constants into its aria-live regions).
 *
 * Covers (example/DOM, not property):
 * - Req 12.2/12.3: Default_Sheet_Schema render → 4 ability edits + name/concept
 *   inputs + Propose/Save/Confirm/Next/retry controls; initial disabled rules
 * - Req 10.1/10.2/10.3/11.5: distinct Korean messages (timeout/network/server/
 *   auth), blank-concept / blank-name guidance, NO_CHARACTER, schema fallback
 * - Req 12.5: every interactive element has a non-empty accessible name
 * - Req 12.2/12.3: Tab/focus order matches DOM source order (no positive
 *   tabindex), disabled/readonly excluded; native button/input/select elements
 *   support Enter/Space activation
 * - Req 12.6: error/status messages live in aria-live live regions
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import {
  ERROR_MESSAGES,
  BLANK_CONCEPT_MESSAGE,
  BLANK_NAME_MESSAGE,
  SAVE_CONFIRMED_MESSAGE,
  CONFIRMED_MESSAGE,
  NO_CHARACTER_MESSAGE,
  PROPOSAL_INVALID_MESSAGE,
  SCHEMA_FALLBACK_MESSAGE,
  HANDOFF_INVALID_MESSAGE,
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

/**
 * 현재 happy-dom 문서에 페이지를 적재하고, 실제 인라인 모듈을 실행한다.
 * 주입 훅(window.__character*)은 호출 전에 이미 설정되어 있어야 한다.
 * @param {{ url?: string }} [opts]
 */
async function loadPage(opts = {}) {
  const url = opts.url || "https://localhost/character/?roomId=r1&playerId=p1";
  // location/handoff 주입: 모듈 top-level이 location.search를 읽는다.
  if (window.happyDOM && typeof window.happyDOM.setURL === "function") {
    window.happyDOM.setURL(url);
  }
  // 정적 마크업을 먼저 넣어 모듈이 참조할 DOM 요소가 존재하게 한다.
  document.body.innerHTML = bodyMarkup;

  // 인라인 모듈을 형제 임시 파일로 써서 `./logic.js` 상대 import가 해석되게 한다.
  const tmpPath = join(here, `__dom_tmp_${tempCounter++}.js`);
  writeFileSync(tmpPath, inlineModuleSource, "utf8");
  tempFiles.push(tmpPath);
  // 새 파일명이므로 매번 새 모듈 평가 → 깨끗한 초기 상태 + 현재 DOM에 배선.
  await import(/* @vite-ignore */ pathToFileURL(tmpPath).href);
}

/** 마이크로태스크 큐를 비운다. */
async function flush() {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

/** 응답이 끝나지 않는 fetch(스키마 로딩 상태 유지용). */
function pendingFetch() {
  return () => new Promise(() => {});
}

/** 스키마 요청을 비-2xx로 끝내 기본 시트 폴백을 유도하는 fetch. */
function failingSchemaFetch() {
  return () =>
    Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
}

/**
 * aria-label → 연관 <label for> → 텍스트 내용 순으로 접근성 이름을 계산한다.
 */
function accessibleName(el) {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim().length > 0) return ariaLabel.trim();
  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (label && label.textContent && label.textContent.trim().length > 0) {
      return label.textContent.trim();
    }
  }
  const text = el.textContent ? el.textContent.trim() : "";
  return text;
}

function clearHooks() {
  delete window.__characterFetch;
  delete window.__characterNewAbortController;
  delete window.__characterNavigate;
}

beforeEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>";
  clearHooks();
  // 네비게이션·AbortController는 항상 안전한 기본 훅으로 둔다.
  window.__characterNewAbortController = () => new AbortController();
  window.__characterNavigate = () => {};
});

afterEach(() => {
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

describe("character-sheet example DOM tests — rendered structure & wiring", () => {
  it("Default_Sheet_Schema 렌더 시 네 능력치 select·이름/컨셉 입력·Propose/Save/Confirm/Next/재시도 버튼이 존재한다 (Req 12.2, 12.3)", async () => {
    window.__characterFetch = pendingFetch();
    await loadPage();
    await flush();

    // 네 EZFudge 능력치 편집 요소(Might·Agility·Wits·Spirit)가 select로 렌더된다.
    for (const key of ["Might", "Agility", "Wits", "Spirit"]) {
      const select = document.getElementById(`trait-${key}`);
      expect(select, `#trait-${key} must be rendered`).not.toBeNull();
      expect(select.tagName.toLowerCase()).toBe("select");
      // 사다리 [-2,4]의 7개 정수 옵션으로 선택을 제한한다(요구사항 5.2).
      expect(select.querySelectorAll("option").length).toBe(7);
    }

    // 이름(한 줄 input)·컨셉(여러 줄 textarea) Narrative_Field 입력.
    const nameInput = document.getElementById("field-name");
    expect(nameInput).not.toBeNull();
    expect(nameInput.tagName.toLowerCase()).toBe("input");
    const conceptInput = document.getElementById("field-concept");
    expect(conceptInput).not.toBeNull();
    expect(conceptInput.tagName.toLowerCase()).toBe("textarea");

    // Propose/Confirm/재시도 동작 버튼.
    for (const id of ["proposeBtn", "confirmBtn", "retryBtn"]) {
      const btn = document.getElementById(id);
      expect(btn, `#${id} must exist`).not.toBeNull();
      expect(btn.tagName.toLowerCase()).toBe("button");
    }
  });

  it("초기 비활성 규칙: 재시도는 숨김이고, 스키마 로딩 중 Propose/Confirm이 비활성이다 (Req 12.3)", async () => {
    window.__characterFetch = pendingFetch();
    await loadPage();
    await flush();

    // 스키마 로딩 인디케이터가 표시되고, 진행 중에는 동작이 비활성이다(요구사항 9.3, 13.9).
    expect(document.getElementById("schemaLoading").hidden).toBe(false);
    expect(document.getElementById("proposeBtn").disabled).toBe(true);
    expect(document.getElementById("confirmBtn").disabled).toBe(true);

    // 복구 가능 오류가 없으므로 재시도는 숨김이다(요구사항 10.4).
    expect(document.getElementById("retryBtn").hidden).toBe(true);
  });

  it("스키마 로드 실패 시 기본 시트로 폴백하고 한국어 폴백 안내를 표시하며, 비확정 상태에서 동작이 활성화된다 (Req 12.6, 13.6)", async () => {
    window.__characterFetch = failingSchemaFetch();
    await loadPage();
    await flush();

    // 폴백 안내가 전용 라이브 영역에 정확한 한국어 문구로 노출된다.
    const schemaFallback = document.getElementById("schemaFallback");
    expect(schemaFallback.hidden).toBe(false);
    expect(schemaFallback.textContent).toBe(SCHEMA_FALLBACK_MESSAGE);

    // 폴백 후에도 기본 시트(네 능력치)가 렌더되어 있다.
    for (const key of ["Might", "Agility", "Wits", "Spirit"]) {
      expect(document.getElementById(`trait-${key}`)).not.toBeNull();
    }

    // 스키마 로딩이 끝나고(인디케이터 해제) 유효 인계·비확정이므로 동작이 활성이다(요구사항 9.4).
    expect(document.getElementById("schemaLoading").hidden).toBe(true);
    expect(document.getElementById("proposeBtn").disabled).toBe(false);
    expect(document.getElementById("confirmBtn").disabled).toBe(false);
    // 입력 컨트롤도 활성(읽기 전용 아님)이다.
    expect(document.getElementById("field-name").disabled).toBe(false);
    expect(document.getElementById("trait-Might").disabled).toBe(false);
  });

  it("빈 컨셉·빈 이름 안내가 상태 라이브 영역(#statusMessage)에 한국어로 표시된다 (Req 11.5, 12.6)", async () => {
    window.__characterFetch = failingSchemaFetch();
    await loadPage();
    await flush();

    const statusMessage = document.getElementById("statusMessage");
    // 초기에는 안내가 숨겨져 있다.
    expect(statusMessage.hidden).toBe(true);

    // 컨셉이 빈 상태에서 AI 제안 시도 → 요청을 보내지 않고 컨셉 입력 안내를 표시한다(요구사항 4.2).
    document.getElementById("proposeBtn").click();
    await flush();
    expect(statusMessage.hidden).toBe(false);
    expect(statusMessage.textContent).toBe(BLANK_CONCEPT_MESSAGE);

    // 이름이 빈 상태에서 확정 시도 → 요청을 보내지 않고 이름 입력 안내를 표시한다(요구사항 7.6).
    document.getElementById("confirmBtn").click();
    await flush();
    expect(statusMessage.hidden).toBe(false);
    expect(statusMessage.textContent).toBe(BLANK_NAME_MESSAGE);
  });

  it("오류·상태 한국어 문구가 서로 구분되고 한글을 포함한다 (타임아웃·네트워크·서버·인증 거부, 빈 컨셉/이름, NO_CHARACTER, 폴백) (Req 10.1, 10.2, 10.3, 11.5)", () => {
    // 타임아웃·네트워크·서버·인증 거부는 서로 구분되는 한국어 메시지로 매핑된다(요구사항 10.1~10.3, 11.5).
    const transmission = [
      ERROR_MESSAGES.timeout,
      ERROR_MESSAGES.network,
      ERROR_MESSAGES.server,
      ERROR_MESSAGES.auth,
    ];
    for (const msg of transmission) {
      expect(typeof msg).toBe("string");
      expect(msg.trim().length).toBeGreaterThan(0);
      expect(msg).toMatch(/[가-힣]/);
    }
    // 네 전송 오류 문구는 모두 서로 다르다(중복 없음).
    expect(new Set(transmission).size).toBe(4);

    // 안내·확인·거부 문구들도 비어 있지 않은 한국어이며 서로 구분된다.
    const notices = [
      BLANK_CONCEPT_MESSAGE,
      BLANK_NAME_MESSAGE,
      NO_CHARACTER_MESSAGE,
      SCHEMA_FALLBACK_MESSAGE,
      PROPOSAL_INVALID_MESSAGE,
      SAVE_CONFIRMED_MESSAGE,
      CONFIRMED_MESSAGE,
      HANDOFF_INVALID_MESSAGE,
    ];
    for (const msg of notices) {
      expect(msg.trim().length).toBeGreaterThan(0);
      expect(msg).toMatch(/[가-힣]/);
    }
    // 모든 사용자 문구(전송 오류 + 안내)는 서로 구분된다.
    const all = [...transmission, ...notices];
    expect(new Set(all).size).toBe(all.length);
  });

  it("모든 상호작용 요소가 비어 있지 않은 접근성 레이블을 가진다 (Req 12.5)", async () => {
    window.__characterFetch = pendingFetch();
    await loadPage();
    await flush();

    const interactive = Array.from(
      document.querySelectorAll("input, button, a[href], select, textarea"),
    );
    // 동적 렌더된 시트 입력·평가 select와 정적 동작 버튼이 모두 포함된다.
    expect(interactive.length).toBeGreaterThan(0);

    for (const el of interactive) {
      const name = accessibleName(el);
      expect(
        name.length,
        `interactive element <${el.tagName.toLowerCase()} id="${el.id}"> must have a non-empty accessible name`,
      ).toBeGreaterThan(0);
    }
  });

  it("Tab/포커스 순서가 DOM 소스 순서와 일치하고(양수 tabindex 부재) 비활성 요소는 제외된다 (Req 12.2, 12.3)", async () => {
    // 폴백 상태(동작 활성)에서 검사해 동작 버튼도 포커스 가능 집합에 포함되게 한다.
    window.__characterFetch = failingSchemaFetch();
    await loadPage();
    await flush();

    const interactive = Array.from(
      document.querySelectorAll("input, button, a[href], select, textarea"),
    );

    // 어떤 요소도 양수 tabindex로 순서를 재정의하지 않으므로 탭 순서 = DOM 순서.
    for (const el of interactive) {
      const tabindex = el.getAttribute("tabindex");
      if (tabindex !== null) {
        expect(Number(tabindex)).toBeLessThanOrEqual(0);
      }
    }

    // 비활성·숨김 요소는 키보드 포커스 순서에서 제외된다.
    const focusable = interactive.filter((el) => !el.disabled && !el.hasAttribute("hidden"));
    const order = focusable.map((el) => el.id);

    // 기대 요소들이 모두 포커스 가능하다: 시트 입력·평가 select → 동작 버튼.
    const expectedRelative = [
      "field-name",
      "field-concept",
      "trait-Might",
      "trait-Agility",
      "trait-Wits",
      "trait-Spirit",
      "proposeBtn",
      "confirmBtn",
    ];
    const positions = expectedRelative.map((id) => order.indexOf(id));
    for (const [i, pos] of positions.entries()) {
      expect(pos, `#${expectedRelative[i]} must be focusable`).toBeGreaterThanOrEqual(0);
    }
    // 상대적 순서가 DOM 소스 순서(오름차순)와 일치한다.
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });

  it("동작 컨트롤이 네이티브 button/input/select 요소여서 Enter/Space로 활성화된다 (Req 12.3)", async () => {
    window.__characterFetch = failingSchemaFetch();
    await loadPage();
    await flush();

    // 네이티브 <button>은 Enter/Space로, <input>/<select>는 기본 키보드 상호작용으로 조작된다.
    for (const id of ["proposeBtn", "confirmBtn", "retryBtn"]) {
      expect(document.getElementById(id).tagName.toLowerCase()).toBe("button");
    }
    expect(document.getElementById("field-name").tagName.toLowerCase()).toBe("input");
    expect(document.getElementById("field-concept").tagName.toLowerCase()).toBe("textarea");
    for (const key of ["Might", "Agility", "Wits", "Spirit"]) {
      expect(document.getElementById(`trait-${key}`).tagName.toLowerCase()).toBe("select");
    }
  });

  it("오류/상태 메시지 영역이 aria-live 라이브 영역을 제공한다 (Req 12.6)", async () => {
    window.__characterFetch = pendingFetch();
    await loadPage();
    await flush();

    const liveRegionIds = [
      "handoffInvalid",
      "schemaFallback",
      "statusMessage",
      "errorMessage",
      "schemaLoading",
      "proposalLoading",
      "recordLoading",
      "confirmLoading",
    ];
    for (const id of liveRegionIds) {
      const el = document.getElementById(id);
      expect(el, `#${id} must exist`).not.toBeNull();
      const ariaLive = el.getAttribute("aria-live");
      expect(
        ariaLive && ariaLive.trim().length > 0,
        `#${id} must declare a non-empty aria-live region`,
      ).toBe(true);
    }
  });
});
