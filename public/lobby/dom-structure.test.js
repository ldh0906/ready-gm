// @vitest-environment happy-dom
// @ts-nocheck
/**
 * Example DOM (static-structure) tests for Room_Lobby_App — Task 7.3.
 * Feature: room-lobby
 *
 * These tests load the static markup of public/lobby/index.html into a
 * happy-dom document and assert on the rendered structure WITHOUT executing the
 * page's module script (setting innerHTML does not run <script> tags). Behavior
 * that requires the wiring to run is covered by the integration tests (7.4).
 *
 * Covers (example/DOM, not property):
 * - Req 3.1: 초대 링크 복사 버튼(#copyBtn) 존재 + 초기 비활성
 * - Req 7.1: 세션 시작 버튼(#startBtn) 존재 + 초기 비활성
 * - Req 6.6: 0명 로스터 안내(ROSTER_EMPTY_MESSAGE) 한국어 문구 표시
 * - Req 11.5: 모든 상호작용 요소의 비어 있지 않은 접근성 레이블
 * - Req 11.2, 11.3: Tab/포커스 순서가 DOM 소스 순서와 일치(양수 tabindex 부재)
 * - Req 11.6: 오류/상태 메시지 영역의 aria-live 라이브 영역 제공
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderRoster, ROSTER_EMPTY_MESSAGE } from "./logic.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "index.html"), "utf8");

/**
 * Load the static markup of index.html into the current happy-dom document.
 * We inject everything inside <html>…</html> via documentElement.innerHTML so
 * both <head> and <body> structure is present. innerHTML never executes the
 * inline module, which is exactly what we want for static-structure assertions.
 */
function loadStaticMarkup() {
  const match = html.match(/<html[^>]*>([\s\S]*)<\/html>/i);
  expect(match, "index.html must contain an <html> element").toBeTruthy();
  document.documentElement.innerHTML = match[1];
}

/**
 * Compute an accessible name for an element using the subset of rules relevant
 * to this page: aria-label, then an associated <label for>, then text content.
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

describe("room-lobby example DOM tests — static structure", () => {
  beforeEach(() => {
    loadStaticMarkup();
  });

  it("복사·초대 재조회·시나리오 재조회·세션 시작 버튼이 존재하고, 복사·시작 버튼은 초기 비활성이다 (Req 3.1, 7.1)", () => {
    const copyBtn = document.getElementById("copyBtn");
    const inviteRefetchBtn = document.getElementById("inviteRefetchBtn");
    const scenariosRefetchBtn = document.getElementById("scenariosRefetchBtn");
    const startBtn = document.getElementById("startBtn");

    for (const [id, el] of [
      ["copyBtn", copyBtn],
      ["inviteRefetchBtn", inviteRefetchBtn],
      ["scenariosRefetchBtn", scenariosRefetchBtn],
      ["startBtn", startBtn],
    ]) {
      expect(el, `#${id} must exist`).not.toBeNull();
      expect(el.tagName.toLowerCase()).toBe("button");
    }

    // 데이터 적재 전(인계 직후)에는 복사·시작이 비활성이어야 한다(Req 3.1/7.1, 1.4).
    expect(copyBtn.hasAttribute("disabled")).toBe(true);
    expect(startBtn.hasAttribute("disabled")).toBe(true);
    // 재조회 컨트롤은 정적 마크업에서 활성(비활성 속성 없음)이다.
    expect(inviteRefetchBtn.hasAttribute("disabled")).toBe(false);
    expect(scenariosRefetchBtn.hasAttribute("disabled")).toBe(false);
  });

  it("로스터가 0명이면 한국어 '아직 모인 플레이어 없음' 안내(ROSTER_EMPTY_MESSAGE)를 표시한다 (Req 6.6)", () => {
    // 정적 마크업의 #roster는 초기에 비어 있다. 순수 렌더 함수의 빈 목록 출력을
    // 실제 컨테이너에 주입해 안내 문구가 사용자에게 노출됨을 검증한다.
    const rosterEl = document.getElementById("roster");
    expect(rosterEl).not.toBeNull();

    rosterEl.innerHTML = renderRoster([], 5);

    expect(rosterEl.textContent).toContain(ROSTER_EMPTY_MESSAGE);
    // 안내 문구는 한글을 포함한다.
    expect(ROSTER_EMPTY_MESSAGE).toMatch(/[가-힣]/);
    // 인원/정원 표기도 함께 나타난다(현재 인원: 0 / 5명).
    expect(rosterEl.textContent).toContain("0");
    expect(rosterEl.textContent).toContain("5");
  });

  it("모든 상호작용 요소가 비어 있지 않은 접근성 레이블을 가진다 (Req 11.5)", () => {
    const interactive = Array.from(
      document.querySelectorAll("input, button, a[href], select, textarea"),
    );
    // 페이지에 상호작용 요소가 실제로 존재해야 의미 있는 검증이 된다.
    expect(interactive.length).toBeGreaterThan(0);

    for (const el of interactive) {
      const name = accessibleName(el);
      expect(
        name.length,
        `interactive element <${el.tagName.toLowerCase()} id="${el.id}"> must have a non-empty accessible name`,
      ).toBeGreaterThan(0);
    }
  });

  it("Tab/포커스 순서가 DOM 소스 순서와 일치한다(양수 tabindex 부재) (Req 11.2, 11.3)", () => {
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

    const order = interactive.map((el) => el.id);

    // 기대 상호작용 요소들이 모두 존재한다.
    const expectedIds = [
      "copyBtn",
      "inviteRefetchBtn",
      "scenariosRefetchBtn",
      "startBtn",
      "manualCopy",
    ];
    for (const id of expectedIds) {
      expect(order.indexOf(id), `#${id} must be focusable in the document`).toBeGreaterThanOrEqual(0);
    }

    // 주요 동작 버튼(복사 → 초대 재조회 → 시나리오 재조회 → 세션 시작)은
    // DOM 소스 순서대로 오름차순으로 등장한다.
    const buttonPositions = ["copyBtn", "inviteRefetchBtn", "scenariosRefetchBtn", "startBtn"].map(
      (id) => order.indexOf(id),
    );
    const sortedButtons = [...buttonPositions].sort((a, b) => a - b);
    expect(buttonPositions).toEqual(sortedButtons);

    // 수동 복사 입력(#manualCopy)은 초대 카드 안(초대 재조회 버튼과 시나리오
    // 재조회 버튼 사이)에 위치한다. 이는 DOM 소스 순서 그대로이며, 양수 tabindex가
    // 없으므로 포커스 순서도 DOM 순서와 일치한다.
    expect(order.indexOf("manualCopy")).toBeGreaterThan(order.indexOf("inviteRefetchBtn"));
    expect(order.indexOf("manualCopy")).toBeLessThan(order.indexOf("scenariosRefetchBtn"));
  });

  it("오류/상태 메시지 영역이 aria-live 라이브 영역을 제공한다 (Req 11.6)", () => {
    const liveRegionIds = [
      "handoffInvalid",
      "inviteError",
      "roomError",
      "scenariosError",
      "startError",
      "connectionStatus",
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
