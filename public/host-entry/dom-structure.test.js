// @vitest-environment happy-dom
// @ts-nocheck
/**
 * Example DOM (static-structure) tests for Host_Entry_App — Task 6.3.
 * Feature: frontend-applications
 *
 * These tests load the static markup of public/host-entry/index.html into a
 * happy-dom document and assert on the rendered structure WITHOUT executing the
 * page's module script (setting innerHTML does not run <script> tags). Behavior
 * that requires the wiring to run is covered by the integration tests (6.4).
 *
 * Covers (example/DOM, not property):
 * - Req 1.1, 2.1: Korean ready-gm intro + labeled Display_Name input + Submit button
 * - Req 1.2: Invite_Panel hidden initially
 * - Req 5.1: success panel contains a copy button
 * - Req 10.4: every interactive element has a non-empty accessible name
 * - Req 10.2: tab/focus order matches DOM source order
 * - Req 10.5: validation message associated to input via aria-describedby
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

describe("frontend-applications example DOM tests — static structure", () => {
  beforeEach(() => {
    loadStaticMarkup();
  });

  it("초기 렌더에 한국어 소개·Display_Name 입력·Submit 버튼이 존재한다 (Req 1.1, 2.1)", () => {
    // 한국어 ready-gm 소개 문구 (intro 영역).
    const introTitle = document.getElementById("intro-title");
    expect(introTitle).not.toBeNull();
    const introText = introTitle.textContent || "";
    expect(introText.trim().length).toBeGreaterThan(0);
    // 한글이 포함되어야 한다.
    expect(introText).toMatch(/[가-힣]/);

    // 레이블이 붙은 Display_Name 입력 (#displayName + <label for>).
    const nameInput = document.getElementById("displayName");
    expect(nameInput).not.toBeNull();
    expect(nameInput.tagName.toLowerCase()).toBe("input");
    const nameLabel = document.querySelector('label[for="displayName"]');
    expect(nameLabel).not.toBeNull();
    expect((nameLabel.textContent || "").trim().length).toBeGreaterThan(0);

    // Submit_Action 버튼.
    const submitBtn = document.getElementById("submitBtn");
    expect(submitBtn).not.toBeNull();
    expect(submitBtn.tagName.toLowerCase()).toBe("button");
  });

  it("Invite_Panel은 초기에 hidden 속성을 가진다 (Req 1.2)", () => {
    const invitePanel = document.getElementById("invitePanel");
    expect(invitePanel).not.toBeNull();
    expect(invitePanel.hasAttribute("hidden")).toBe(true);
  });

  it("성공 패널 마크업에 초대 링크 복사 버튼이 존재한다 (Req 5.1)", () => {
    const copyBtn = document.getElementById("copyBtn");
    expect(copyBtn).not.toBeNull();
    expect(copyBtn.tagName.toLowerCase()).toBe("button");
    // 복사 버튼은 invite 패널 안에 위치한다.
    const invitePanel = document.getElementById("invitePanel");
    expect(invitePanel.contains(copyBtn)).toBe(true);
  });

  it("모든 상호작용 요소가 비어 있지 않은 접근성 레이블을 가진다 (Req 10.4)", () => {
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

  it("Tab/포커스 순서가 DOM 소스 순서와 일치한다 (Req 10.2)", () => {
    // 어떤 요소도 tabindex로 순서를 재정의하지 않으므로 탭 순서 = DOM 순서.
    const interactive = Array.from(
      document.querySelectorAll("input, button, a[href], select, textarea"),
    );
    for (const el of interactive) {
      const tabindex = el.getAttribute("tabindex");
      // 양수 tabindex가 있으면 DOM 순서를 깨뜨릴 수 있으므로 없어야 한다.
      if (tabindex !== null) {
        expect(Number(tabindex)).toBeLessThanOrEqual(0);
      }
    }

    const order = interactive.map((el) => el.id);
    const expectedRelative = [
      "displayName",
      "submitBtn",
      "copyBtn",
      "manualCopy",
      "enterRoomBtn",
    ];
    // 기대 요소들이 모두 존재하고, 상대적 순서가 DOM 순서와 일치한다.
    const positions = expectedRelative.map((id) => order.indexOf(id));
    for (const pos of positions) {
      expect(pos).toBeGreaterThanOrEqual(0);
    }
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });

  it("검증 안내(#nameError)가 aria-describedby로 #displayName과 연관된다 (Req 10.5)", () => {
    const nameInput = document.getElementById("displayName");
    const describedBy = nameInput.getAttribute("aria-describedby");
    expect(describedBy).toBe("nameError");
    // 연관된 안내 요소가 실제로 존재한다.
    const nameError = document.getElementById("nameError");
    expect(nameError).not.toBeNull();
  });
});
