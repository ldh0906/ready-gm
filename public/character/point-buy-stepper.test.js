// @vitest-environment happy-dom
// @ts-nocheck
/**
 * POINT_BUY 스테퍼 렌더·동작 테스트 — flexible-stat-allocation.
 * Feature: flexible-stat-allocation (character-sheet 화면)
 *
 * 접근: integration.test.js와 동일한 하네스로 index.html의 실제 마크업+인라인 모듈을 happy-dom에
 * 적재해 진짜 buildSheet/syncSheet 배선을 실행한다. POINT_BUY 시트(baseLevel 1, pointPool 3,
 * [1,4] 항목 셋)에서 각 Rated_Trait가 드롭다운이 아니라 −/값/+ 스테퍼로 렌더되고, +/− 클릭이
 * TRAIT_CHANGED를 디스패치해 표시 Trait_Level을 갱신하며, 경계·남은 점수에서 버튼이 비활성화됨을
 * 검증한다. LADDER_SELECT 시트는 여전히 <select>로 렌더됨을 회귀 가드로 확인한다.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
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

const DEFAULT_URL = "https://localhost/character/?roomId=r1&playerId=p1&token=secret-token";

async function loadPage(opts = {}) {
  const url = opts.url || DEFAULT_URL;
  if (window.happyDOM && typeof window.happyDOM.setURL === "function") {
    window.happyDOM.setURL(url);
  }
  document.body.innerHTML = bodyMarkup;
  const tmpPath = join(here, `__pointbuy_tmp_${tempCounter++}.js`);
  writeFileSync(tmpPath, inlineModuleSource, "utf8");
  tempFiles.push(tmpPath);
  await import(/* @vite-ignore */ pathToFileURL(tmpPath).href);
}

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

const $ = (id) => document.getElementById(id);

function okJson(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

/** sheet-schema 응답으로 주어진 스키마를 돌려주는 라우팅 fetch. */
function schemaFetch(schemaBody) {
  return (url) => {
    if (String(url).endsWith("/sheet-schema")) return okJson(schemaBody);
    return okJson({});
  };
}

const GEESE_SCHEMA = {
  sections: [{ id: "stats", label: "능력치" }],
  narrativeFields: [
    { id: "name", label: "이름", guidance: "이름", sectionId: "stats", maxLength: 100 },
    { id: "concept", label: "컨셉", guidance: "컨셉", sectionId: "stats", maxLength: 2000 },
  ],
  traits: [
    { key: "Honk", label: "꽥", sectionId: "stats", ladder: { min: 1, max: 4 } },
    { key: "Waddle", label: "뒤뚱", sectionId: "stats", ladder: { min: 1, max: 4 } },
    { key: "Menace", label: "위협", sectionId: "stats", ladder: { min: 1, max: 4 } },
  ],
  allocation: { mode: "POINT_BUY", baseLevel: 1, pointPool: 3 },
};

const LADDER_SCHEMA = {
  sections: [{ id: "stats", label: "스탯" }],
  narrativeFields: [
    { id: "name", label: "이름", guidance: "이름", sectionId: "stats", maxLength: 100 },
    { id: "concept", label: "컨셉", guidance: "컨셉", sectionId: "stats", maxLength: 2000 },
  ],
  traits: [
    { key: "Power", label: "파워", sectionId: "stats", ladder: { min: 0, max: 3 } },
    { key: "Speed", label: "스피드", sectionId: "stats", ladder: { min: 0, max: 3 } },
  ],
  allocation: { mode: "LADDER_SELECT" },
};

const KEYS = ["Honk", "Waddle", "Menace"];
const minusBtn = (k) => $(`trait-${k}-minus`);
const plusBtn = (k) => $(`trait-${k}-plus`);
const valueEl = (k) => $(`trait-${k}-value`);

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

describe("POINT_BUY 스테퍼 — 렌더·동작·비활성 계약", () => {
  it("각 Rated_Trait가 −/값/+ 스테퍼로 렌더되고 그 항목엔 <select>가 없다 (요구사항 5.x)", async () => {
    window.__characterFetch = schemaFetch(GEESE_SCHEMA);
    window.__characterNavigate = () => {};
    await loadPage();
    await flush();

    for (const k of KEYS) {
      const minus = minusBtn(k);
      const plus = plusBtn(k);
      const value = valueEl(k);
      expect(minus, `#trait-${k}-minus`).not.toBeNull();
      expect(plus, `#trait-${k}-plus`).not.toBeNull();
      expect(value, `#trait-${k}-value`).not.toBeNull();
      expect(minus.tagName.toLowerCase()).toBe("button");
      expect(plus.tagName.toLowerCase()).toBe("button");
      expect(minus.type).toBe("button");
      expect(plus.type).toBe("button");
      // 비어 있지 않은 접근성 레이블(요구사항 12.5).
      expect(minus.getAttribute("aria-label").length).toBeGreaterThan(0);
      expect(plus.getAttribute("aria-label").length).toBeGreaterThan(0);
      // 값 요소는 폴라이트 라이브 영역으로 낭독된다.
      expect(value.getAttribute("aria-live")).toBe("polite");
      // POINT_BUY 항목엔 <select>가 없다.
      expect($(`trait-${k}`)).toBeNull();
    }
    // 스테퍼 컨테이너는 trait 레이블을 가진 group이다.
    const groups = document.querySelectorAll(".trait-stepper[role='group']");
    expect(groups.length).toBe(3);
    expect(groups[0].getAttribute("aria-label").length).toBeGreaterThan(0);

    // 세 항목 모두 Base_Level 1에서 시작한다.
    for (const k of KEYS) expect(valueEl(k).textContent).toBe("1");
  });

  it("+ 클릭은 TRAIT_CHANGED를 디스패치해 표시 Trait_Level을 1 올린다 (요구사항 3.2)", async () => {
    window.__characterFetch = schemaFetch(GEESE_SCHEMA);
    window.__characterNavigate = () => {};
    await loadPage();
    await flush();

    expect(valueEl("Honk").textContent).toBe("1");
    plusBtn("Honk").click();
    expect(valueEl("Honk").textContent).toBe("2");
    plusBtn("Honk").click();
    expect(valueEl("Honk").textContent).toBe("3");
  });

  it("− 클릭은 올렸던 값을 다시 1 내린다 (요구사항 3.2)", async () => {
    window.__characterFetch = schemaFetch(GEESE_SCHEMA);
    window.__characterNavigate = () => {};
    await loadPage();
    await flush();

    plusBtn("Honk").click(); // 1 → 2
    expect(valueEl("Honk").textContent).toBe("2");
    minusBtn("Honk").click(); // 2 → 1
    expect(valueEl("Honk").textContent).toBe("1");
  });

  it("− 는 Base_Level(1)에서 비활성, 값을 올리면 활성화된다 (요구사항 3.x)", async () => {
    window.__characterFetch = schemaFetch(GEESE_SCHEMA);
    window.__characterNavigate = () => {};
    await loadPage();
    await flush();

    // 초기 Base_Level → − 비활성.
    for (const k of KEYS) expect(minusBtn(k).disabled).toBe(true);
    // 올리면 − 활성.
    plusBtn("Honk").click();
    expect(minusBtn("Honk").disabled).toBe(false);
  });

  it("남은 배분 점수가 0이 되면 모든 + 가 비활성화된다 (요구사항 3.6)", async () => {
    window.__characterFetch = schemaFetch(GEESE_SCHEMA);
    window.__characterNavigate = () => {};
    await loadPage();
    await flush();

    // 초기엔 남은 3점, 모든 + 활성.
    for (const k of KEYS) expect(plusBtn(k).disabled).toBe(false);

    // 세 항목에 1점씩 분배 → 각 2, 남은 0.
    plusBtn("Honk").click();
    plusBtn("Waddle").click();
    plusBtn("Menace").click();

    for (const k of KEYS) {
      expect(valueEl(k).textContent).toBe("2");
      // 남은 점수 0 → 모든 + 비활성.
      expect(plusBtn(k).disabled).toBe(true);
    }
  });

  it("항목이 사다리 상한(4)에 닿으면 그 + 가 비활성화된다 (요구사항 5.2)", async () => {
    window.__characterFetch = schemaFetch(GEESE_SCHEMA);
    window.__characterNavigate = () => {};
    await loadPage();
    await flush();

    // 한 항목에 3점을 모두 몰아 1 → 4(상한).
    plusBtn("Honk").click(); // 2
    plusBtn("Honk").click(); // 3
    plusBtn("Honk").click(); // 4
    expect(valueEl("Honk").textContent).toBe("4");
    // 상한 도달 → + 비활성. 다른 항목도 남은 점수 0이라 + 비활성.
    expect(plusBtn("Honk").disabled).toBe(true);
    expect(plusBtn("Waddle").disabled).toBe(true);
    // 올린 항목의 − 는 활성(Base_Level 위).
    expect(minusBtn("Honk").disabled).toBe(false);
  });

  it("회귀: LADDER_SELECT 시트는 여전히 <select>로 렌더된다 (기존 동작 보존)", async () => {
    window.__characterFetch = schemaFetch(LADDER_SCHEMA);
    window.__characterNavigate = () => {};
    await loadPage();
    await flush();

    for (const key of ["Power", "Speed"]) {
      const select = $(`trait-${key}`);
      expect(select, `#trait-${key}`).not.toBeNull();
      expect(select.tagName.toLowerCase()).toBe("select");
    }
    // 스테퍼는 없다.
    expect(document.querySelectorAll(".trait-stepper").length).toBe(0);
  });
});
