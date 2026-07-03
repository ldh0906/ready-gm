// @vitest-environment happy-dom
// @ts-nocheck
/**
 * Example DOM (static-structure) tests for Game_Play_App — Task 6.3.
 * Feature: game-play
 *
 * These tests load the static markup of public/game/index.html into a
 * happy-dom document and assert on the rendered structure WITHOUT executing the
 * page's module script (setting innerHTML does not run <script> tags). Behavior
 * that requires the wiring to run (connect/render/escaping on live entries) is
 * covered by the integration tests (6.4); here we additionally verify the pure
 * escape helper directly since static markup never runs JS.
 *
 * Covers (example/DOM, not property):
 * - Req 5.1: 헤더 라운드/단계/준비/busy 요소 존재 + 2분할 #story/#side + 푸터 컨트롤
 * - Req 11.5: 모든 상호작용 요소의 비어 있지 않은 접근성 레이블
 * - Req 11.2, 11.3: Tab/포커스 순서가 DOM 소스 순서와 일치(양수 tabindex 부재)
 * - Req 11.6: 상태/안내 메시지 영역의 aria-live 라이브 영역 제공
 * - Req 3.4, 4.3: esc()가 < > & 를 이스케이프(원문 태그 미해석)
 * - Req 9.3: 세션 종료 안내(SESSION_ENDED_MESSAGE) 한국어 문구 + #notice 영역 존재
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { esc, SESSION_ENDED_MESSAGE } from "./logic.js";

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

describe("game-play example DOM tests — static structure", () => {
  beforeEach(() => {
    loadStaticMarkup();
  });

  it("게임 CSS/JS를 외부 리소스로 로드하고 인라인 스타일·모듈 스크립트를 두지 않는다", () => {
    const stylesheet = document.querySelector('link[rel="stylesheet"][href="./styles.css"]');
    expect(stylesheet, "index.html must load ./styles.css").not.toBeNull();

    const appScript = document.querySelector('script[type="module"][src="./app.js"]');
    expect(appScript, "index.html must load ./app.js as a module").not.toBeNull();

    expect(document.querySelectorAll("style").length, "inline style blocks are forbidden").toBe(0);
    const inlineModules = Array.from(document.querySelectorAll('script[type="module"]')).filter(
      (script) => !script.getAttribute("src"),
    );
    expect(inlineModules.length, "inline module scripts are forbidden").toBe(0);
  });

  it("헤더(라운드·단계·준비·busy)·2분할 본문(#story/#side)·푸터 컨트롤이 모두 존재한다 (Req 5.1)", () => {
    // 헤더 상태 요소.
    for (const id of ["connStatus", "round", "phase", "ready", "countdown", "busy"]) {
      expect(document.getElementById(id), `#${id} must exist`).not.toBeNull();
    }

    // 2분할 본문: GM 서사(좌) + 채팅·행동 로그(우).
    const app = document.getElementById("app");
    const story = document.getElementById("story");
    const side = document.getElementById("side");
    expect(app, "#app must exist").not.toBeNull();
    expect(story, "#story must exist").not.toBeNull();
    expect(side, "#side must exist").not.toBeNull();
    // 두 패널은 #app 컨테이너 안에 존재한다.
    expect(app.contains(story)).toBe(true);
    expect(app.contains(side)).toBe(true);

    // 입력 푸터 컨트롤.
    const msg = document.getElementById("msg");
    expect(msg, "#msg must exist").not.toBeNull();
    expect(msg.tagName.toLowerCase()).toBe("input");
    for (const id of ["sendBtn", "passBtn", "reviseBtn"]) {
      const btn = document.getElementById(id);
      expect(btn, `#${id} must exist`).not.toBeNull();
      expect(btn.tagName.toLowerCase()).toBe("button");
    }

    // 인계 무효 안내 영역도 정적 마크업에 존재한다.
    expect(document.getElementById("handoffInvalid"), "#handoffInvalid must exist").not.toBeNull();
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

    // 기대 푸터 컨트롤들이 모두 포커스 가능하게 문서에 존재한다.
    const expectedIds = ["msg", "sendBtn", "passBtn", "reviseBtn"];
    for (const id of expectedIds) {
      expect(order.indexOf(id), `#${id} must be focusable in the document`).toBeGreaterThanOrEqual(
        0,
      );
    }

    // 푸터 컨트롤은 정확히 DOM 소스 순서(메시지 → 말하기 → 확정 → 패스 → 수정)로 등장한다.
    const positions = expectedIds.map((id) => order.indexOf(id));
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
    // 명시적 순서도 확인: 메시지 입력이 가장 먼저, 수정 버튼이 가장 나중.
    expect(order.indexOf("msg")).toBeLessThan(order.indexOf("sendBtn"));
    expect(order.indexOf("sendBtn")).toBeLessThan(order.indexOf("passBtn"));
    expect(order.indexOf("passBtn")).toBeLessThan(order.indexOf("reviseBtn"));
  });

  it("상태/안내 메시지 영역이 aria-live 라이브 영역을 제공한다 (Req 11.6)", () => {
    const liveRegionIds = ["connStatus", "handoffInvalid", "story", "side", "notice", "busy"];
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

  it("esc()가 < > & 를 이스케이프해 원문 태그가 해석되지 않는다 (Req 3.4, 4.3)", () => {
    // 정적 마크업은 JS를 실행하지 않으므로, 이스케이프 보증은 순수 esc()로 직접 검증한다.
    const out = esc("<b>&");

    // 원문 꺾쇠는 결과에 그대로 남지 않는다.
    expect(out.includes("<")).toBe(false);
    expect(out.includes(">")).toBe(false);
    // 엔티티 형태로 변환된다.
    expect(out).toContain("&lt;");
    expect(out).toContain("&gt;");
    expect(out).toContain("&amp;");
    // 정확한 출력.
    expect(out).toBe("&lt;b&gt;&amp;");

    // 이스케이프된 텍스트를 컨테이너에 innerHTML로 넣어도 <b> 요소가 생성되지 않는다.
    const probe = document.createElement("div");
    probe.innerHTML = out;
    expect(probe.querySelector("b")).toBeNull();
    expect(probe.textContent).toBe("<b>&");
  });

  it("세션 종료 안내가 한국어 문구이며 #notice 영역에 표시할 수 있다 (Req 9.3)", () => {
    // 한국어 종료 안내 문구.
    expect(SESSION_ENDED_MESSAGE).toMatch(/[가-힣]/);

    // 종료 안내를 노출할 라이브 영역(#notice)이 정적 마크업에 존재한다.
    const notice = document.getElementById("notice");
    expect(notice, "#notice must exist").not.toBeNull();

    // 문구를 주입하면 사용자에게 노출된다.
    notice.hidden = false;
    notice.textContent = SESSION_ENDED_MESSAGE;
    expect(notice.textContent).toBe(SESSION_ENDED_MESSAGE);
    expect(notice.textContent.length).toBeGreaterThan(0);
  });
});
