// @vitest-environment happy-dom
// @ts-nocheck
/**
 * Integration tests for scenario-character-cards dealt-hand side-effect wiring.
 * Feature: scenario-character-cards
 *
 * Mirrors the integration.test.js happy-dom harness: loads index.html's <body>
 * markup + the real inline module script, injecting fetch/AbortController/navigate
 * on window before the module evaluates.
 *
 * Covers:
 * - Card-based schema → after load, only the dealt 3 cards render (not the full list).
 * - Confirming a card the server reports as { ok:false, reason:"CARD_TAKEN" } shows the
 *   CARD_TAKEN notice, does NOT navigate, and re-fetches the cards endpoint (hand updated).
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { RECORD_REJECTION_MESSAGES } from "./logic.js";

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

// 11장의 전체 카드 목록을 싣는 카드 기반 스키마(서버가 분배 손패로 좁히기 전 폴백).
function cardSchema() {
  const cards = [];
  for (let i = 1; i <= 11; i++) {
    cards.push({ id: `card-${i}`, roleLabel: `역할 ${i}`, premise: `전제 ${i}` });
  }
  return {
    sections: [{ id: "narrative", label: "서사" }],
    narrativeFields: [
      { id: "name", label: "이름", guidance: "이름 안내", sectionId: "narrative", maxLength: 100 },
      { id: "concept", label: "컨셉", guidance: "컨셉 안내", sectionId: "narrative", maxLength: 2000 },
    ],
    traits: [],
    characterCards: cards,
  };
}

async function loadPage(opts = {}) {
  const url = opts.url || DEFAULT_URL;
  if (window.happyDOM && typeof window.happyDOM.setURL === "function") {
    window.happyDOM.setURL(url);
  }
  document.body.innerHTML = bodyMarkup;
  const tmpPath = join(here, `__cards_integration_tmp_${tempCounter++}.js`);
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
 * URL로 라우팅하는 가짜 fetch. /cards 손패 응답을 단계별로 바꿀 수 있게 cardsResponder를 받는다.
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
      return okJson(config.schemaBody || cardSchema());
    }
    if (u.endsWith("/cards")) {
      return (config.cards || (() => okJson({ cards: [] })))();
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

describe("scenario-character-cards integration — dealt hand drives rendering", () => {
  it("카드 기반 스키마 채택 후, 서버가 분배한 3장만 렌더된다(전체 11장이 아님)", async () => {
    const dealt = [
      { id: "card-2", roleLabel: "역할 2", premise: "전제 2" },
      { id: "card-5", roleLabel: "역할 5", premise: "전제 5" },
      { id: "card-9", roleLabel: "역할 9", premise: "전제 9" },
    ];
    const { fetchImpl, calls } = makeRoutingFetch({
      cards: () => okJson({ cards: dealt }),
    });
    window.__characterFetch = fetchImpl;
    window.__characterNavigate = () => {};

    await loadPage();
    await flush();

    // 손패 엔드포인트가 호출되었다.
    expect(calls.some((c) => c.url.endsWith("/cards"))).toBe(true);

    // 카드 섹션이 표시되고 정확히 3장만 렌더된다.
    const cardMount = $("cardMount");
    const renderedButtons = cardMount.querySelectorAll("button");
    expect(renderedButtons.length).toBe(3);
    const text = cardMount.textContent;
    expect(text).toContain("역할 2");
    expect(text).toContain("역할 5");
    expect(text).toContain("역할 9");
    // 분배되지 않은 카드는 렌더되지 않는다.
    expect(text).not.toContain("역할 1");
    expect(text).not.toContain("역할 11");
  });

  it("CARD_TAKEN 확정 응답: 안내를 표시하고 네비게이션 없이 손패를 다시 조회한다", async () => {
    let cardsCallCount = 0;
    // 첫 손패: card-2 포함. 재조회 손패: card-2 제거(점유됨).
    const firstHand = [
      { id: "card-2", roleLabel: "역할 2", premise: "전제 2" },
      { id: "card-5", roleLabel: "역할 5", premise: "전제 5" },
      { id: "card-9", roleLabel: "역할 9", premise: "전제 9" },
    ];
    const secondHand = [
      { id: "card-5", roleLabel: "역할 5", premise: "전제 5" },
      { id: "card-9", roleLabel: "역할 9", premise: "전제 9" },
      { id: "card-7", roleLabel: "역할 7", premise: "전제 7" },
    ];
    const { fetchImpl, calls } = makeRoutingFetch({
      cards: () => {
        cardsCallCount += 1;
        return okJson({ cards: cardsCallCount === 1 ? firstHand : secondHand });
      },
      record: () => okJson({ character: {} }),
      // 확정은 HTTP 200 본문에 판별 거부를 노출한다.
      confirm: () => okJson({ ok: false, reason: "CARD_TAKEN", message: "taken" }),
    });
    const navCalls = [];
    window.__characterFetch = fetchImpl;
    window.__characterNavigate = (search) => navCalls.push(search);

    await loadPage();
    await flush();

    // 최초 손패 조회 완료.
    expect(cardsCallCount).toBe(1);

    // 이름 입력 + 분배된 card-2 선택.
    typeName("용사");
    const cardMount = $("cardMount");
    const buttons = cardMount.querySelectorAll("button");
    // card-2(역할 2)에 해당하는 첫 버튼을 클릭한다.
    buttons[0].click();
    await flush();

    // 확정 시도 → 서버가 CARD_TAKEN으로 거부.
    $("confirmBtn").click();
    await flush();
    await flush();
    await flush();

    // CARD_TAKEN 안내가 오류 라이브 영역에 표시된다.
    expect($("errorMessage").textContent).toBe(RECORD_REJECTION_MESSAGES.CARD_TAKEN);
    // 확정되지 않았다(Confirm 재활성).
    expect($("confirmBtn").disabled).toBe(false);
    // 네비게이션은 일어나지 않았다.
    expect(navCalls.length).toBe(0);
    // 손패를 다시 조회했다(총 2회).
    expect(cardsCallCount).toBe(2);
    // 재조회 손패가 렌더되어 점유된 card-2(역할 2)는 사라지고 card-7(역할 7)이 등장한다.
    const text = $("cardMount").textContent;
    expect(text).toContain("역할 7");
    expect(text).not.toContain("역할 2");
  });
});
