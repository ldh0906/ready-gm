// @vitest-environment happy-dom
// @ts-nocheck
/**
 * Integration tests for Room_Lobby_App side-effect wiring — Task 7.4.
 * Feature: room-lobby
 *
 * Approach (real execution of the page, mirroring host-entry/wiring.test.js):
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
 *   - window.__lobbyFetch              : fetch impl
 *   - window.__lobbyNewAbortController : AbortController factory
 *   - window.__lobbyConnect            : connect(roomId, token, handlers) -> { send, close }
 *   - window.__lobbyClipboard          : clipboard adapter
 * NOTE: the page reads `const connect = window.__lobbyConnect || defaultConnect`
 * at module top-level, so __lobbyConnect MUST be set before loadPage().
 *
 * Covers (integration, not property):
 * - Req 6.1: 유효 인계 시 connect 어댑터가 roomId로 호출, onOpen → 연결 활성 표시
 * - Req 5.4: scenario_set 이벤트 → 시나리오 제목/소개 갱신, player_list_updated → 로스터 렌더
 * - Req 6.4: onClose → 연결 끊김 표시 + 고정 간격 재연결(connect 재호출)
 * - Req 8.4 / 9.1: 10초 경과 시 AbortController가 fetch를 취소 → invite timeout 메시지
 * - Req 9.2 / 9.3 / 9.4: 타임아웃/네트워크/서버(5xx)/404 한국어 메시지가 서로 구분됨
 * - Req 8.6: 세션 시작 후 30초 미전이 → 시작 타임아웃 오류 + 재활성
 * - Req 3.4: 클립보드 실패 → 수동 복사 폴백(#copyFallback) 노출
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import {
  ERROR_MESSAGES,
  CONNECTION_LOST_MESSAGE,
  SESSION_START_TIMEOUT_MESSAGE,
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
 * 주입 훅(window.__lobby*)은 호출 전에 이미 설정되어 있어야 한다.
 * @param {{ url?: string }} [opts]
 */
async function loadPage(opts = {}) {
  const url = opts.url || "https://localhost/lobby/?roomId=r1&hostPlayerId=h1";
  // location/handoff 주입: 모듈 top-level이 location.search를 읽는다.
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
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

/**
 * 핸들러를 캡처하고 send 페이로드를 기록하는 가짜 채널 어댑터를 만든다.
 * connect(roomId, token, handlers) -> { send, close }
 */
function makeFakeConnect() {
  const calls = [];
  const sent = [];
  let handlers = null;
  let closed = 0;
  const connect = (roomId, token, h) => {
    calls.push({ roomId, token });
    handlers = h;
    return {
      send: (obj) => sent.push(obj),
      close: () => {
        closed += 1;
      },
    };
  };
  return {
    connect,
    calls,
    sent,
    get handlers() {
      return handlers;
    },
    get closed() {
      return closed;
    },
  };
}

/** 신호 abort 시 AbortError로 reject 하고, 그 전까지는 영원히 pending인 fetch. */
function makeAbortableFetch() {
  let aborted = false;
  const fetchImpl = (_url, options) =>
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
  return {
    fetchImpl,
    get aborted() {
      return aborted;
    },
  };
}

function clearHooks() {
  delete window.__lobbyFetch;
  delete window.__lobbyNewAbortController;
  delete window.__lobbyConnect;
  delete window.__lobbyClipboard;
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

describe("room-lobby integration tests — side-effect wiring", () => {
  it("유효 인계 시 connect가 roomId로 호출되고, onOpen/이벤트가 화면에 반영된다 (Req 6.1, 5.4)", async () => {
    const fake = makeFakeConnect();
    // REST는 이 테스트에서 관심 밖이므로 영원히 pending인 fetch를 둔다.
    window.__lobbyFetch = () => new Promise(() => {});
    window.__lobbyNewAbortController = () => new AbortController();
    window.__lobbyConnect = fake.connect;
    window.__lobbyClipboard = undefined;

    await loadPage({ url: "https://localhost/lobby/?roomId=r1&hostPlayerId=h1" });
    await flush();

    // 채널 연결이 roomId로 시작된다(Req 6.1).
    expect(fake.calls.length).toBeGreaterThanOrEqual(1);
    expect(fake.calls[0].roomId).toBe("r1");

    const connectionStatus = document.getElementById("connectionStatus");
    // onOpen → 연결 활성 표시(Req 6.3 표시, 6.1 흐름).
    expect(connectionStatus.classList.contains("active")).toBe(false);
    fake.handlers.onOpen();
    await flush();
    expect(connectionStatus.classList.contains("active")).toBe(true);

    // player_list_updated → 로스터 렌더(이름이 #roster에 나타난다).
    fake.handlers.onMessage({
      type: "player_list_updated",
      players: [{ id: "h1", displayName: "방장유저", isHost: true }],
    });
    await flush();
    const roster = document.getElementById("roster");
    expect(roster.textContent).toContain("방장유저");

    // scenario_set → 시나리오 제목/소개 갱신(Req 5.4).
    fake.handlers.onMessage({
      type: "scenario_set",
      scenarioId: "s1",
      title: "잃어버린 동굴",
      summary: "어두운 동굴을 탐험하는 이야기.",
    });
    await flush();
    expect(document.getElementById("scenarioTitleText").textContent).toBe("잃어버린 동굴");
    expect(document.getElementById("scenarioSummaryText").textContent).toBe(
      "어두운 동굴을 탐험하는 이야기.",
    );
  });

  it("연결이 끊기면 끊김 메시지를 표시하고 고정 간격으로 재연결한다 (Req 6.4)", async () => {
    vi.useFakeTimers();
    const fake = makeFakeConnect();
    window.__lobbyFetch = () => new Promise(() => {});
    window.__lobbyNewAbortController = () => new AbortController();
    window.__lobbyConnect = fake.connect;
    window.__lobbyClipboard = undefined;

    await loadPage();
    await flush();

    expect(fake.calls.length).toBe(1);

    // 끊김 통지 → CONNECTION_LOST 표시 + 재연결 예약.
    fake.handlers.onClose();
    await flush();

    const connectionStatus = document.getElementById("connectionStatus");
    expect(connectionStatus.classList.contains("active")).toBe(false);
    expect(connectionStatus.textContent).toBe(CONNECTION_LOST_MESSAGE);

    // 고정 간격(RECONNECT_INTERVAL_MS≈3000) 경과 → connect 재호출.
    await vi.advanceTimersByTimeAsync(3000);
    await flush();
    expect(fake.calls.length).toBe(2);
    expect(fake.calls[1].roomId).toBe("r1");
  });

  it("10초 타임아웃: 응답이 없으면 AbortController가 fetch를 취소하고 초대 영역에 timeout 메시지를 표시한다 (Req 8.4, 9.1)", async () => {
    vi.useFakeTimers();
    const fake = makeFakeConnect();
    const abortable = makeAbortableFetch();
    window.__lobbyFetch = abortable.fetchImpl;
    window.__lobbyNewAbortController = () => new AbortController();
    window.__lobbyConnect = fake.connect;
    window.__lobbyClipboard = undefined;

    await loadPage();
    await flush();

    // 초대 요청이 전송되어 로딩 인디케이터가 표시된 상태.
    expect(document.getElementById("inviteLoading").hidden).toBe(false);

    // 10초 경과 → setTimeout 발화 → controller.abort() → fetch reject(AbortError).
    await vi.advanceTimersByTimeAsync(10000);
    await flush();

    expect(abortable.aborted).toBe(true);
    const inviteError = document.getElementById("inviteError");
    expect(inviteError.hidden).toBe(false);
    expect(inviteError.textContent).toBe(ERROR_MESSAGES.invite.timeout);
    // 로딩 인디케이터는 해제된다(Req 8.3 흐름).
    expect(document.getElementById("inviteLoading").hidden).toBe(true);
  });

  it("오류 메시지 구분: 404/5xx/네트워크 실패가 서로 다른 한국어 메시지를 표시한다 (Req 9.2, 9.3, 9.4)", async () => {
    // 동일한 초대 요청 경로를 서로 다른 실패로 구동해 표시 문구가 구분됨을 확인한다.
    async function runWith(fetchImpl) {
      const fake = makeFakeConnect();
      window.__lobbyFetch = fetchImpl;
      window.__lobbyNewAbortController = () => new AbortController();
      window.__lobbyConnect = fake.connect;
      window.__lobbyClipboard = undefined;
      await loadPage();
      await flush();
      const text = document.getElementById("inviteError").textContent;
      clearHooks();
      // 다음 실행을 위해 문서를 초기화한다.
      document.documentElement.innerHTML = "<head></head><body></body>";
      return text;
    }

    const notfoundText = await runWith(() => Promise.resolve({ ok: false, status: 404 }));
    const serverText = await runWith(() => Promise.resolve({ ok: false, status: 503 }));
    const networkText = await runWith(() => Promise.reject(new TypeError("Failed to fetch")));

    // 각 표시 문구는 logic.js의 해당 한국어 상수와 정확히 일치한다.
    expect(notfoundText).toBe(ERROR_MESSAGES.invite.notfound);
    expect(serverText).toBe(ERROR_MESSAGES.invite.server);
    expect(networkText).toBe(ERROR_MESSAGES.invite.network);

    // 세 문구는 서로 구분된다(중복 없음).
    const distinct = new Set([notfoundText, serverText, networkText]);
    expect(distinct.size).toBe(3);
  });

  it("세션 시작 타임아웃: 30초 내 세션 활성 전이가 없으면 시작 타임아웃 오류 + 재활성 (Req 8.6)", async () => {
    vi.useFakeTimers();
    const fake = makeFakeConnect();
    // REST는 영원히 pending(abort 시 AbortError) — 세션 시작 경로에 영향 없음.
    const abortable = makeAbortableFetch();
    window.__lobbyFetch = abortable.fetchImpl;
    window.__lobbyNewAbortController = () => new AbortController();
    window.__lobbyConnect = fake.connect;
    window.__lobbyClipboard = undefined;

    await loadPage();
    await flush();

    // 세션 시작 활성 조건을 실시간 이벤트로 충족시킨다:
    // 연결 활성 + 로스터 ≥ 1 + 시나리오 확정.
    fake.handlers.onOpen();
    fake.handlers.onMessage({
      type: "player_list_updated",
      players: [{ id: "h1", displayName: "방장", isHost: true }],
    });
    fake.handlers.onMessage({
      type: "scenario_set",
      scenarioId: "s1",
      title: "시나리오",
      summary: "요약",
    });
    await flush();

    const startBtn = document.getElementById("startBtn");
    expect(startBtn.disabled).toBe(false);

    // 세션 시작 클릭 → START_SESSION 1회 전송 + 시작 인디케이터 표시.
    startBtn.click();
    await flush();

    expect(fake.sent.length).toBe(1);
    expect(fake.sent[0]).toEqual({ type: "START_SESSION", from: "h1" });
    expect(document.getElementById("sessionStarting").hidden).toBe(false);
    expect(startBtn.disabled).toBe(true);

    // 30초 경과(세션 활성 전이 없음) → START_SESSION_TIMEOUT.
    await vi.advanceTimersByTimeAsync(30000);
    await flush();

    const startError = document.getElementById("startError");
    expect(startError.hidden).toBe(false);
    expect(startError.textContent).toBe(SESSION_START_TIMEOUT_MESSAGE);
    // 시작 인디케이터 해제 + 재시도 가능(버튼 재활성).
    expect(document.getElementById("sessionStarting").hidden).toBe(true);
    expect(startBtn.disabled).toBe(false);
  });

  it("클립보드 실패: writeText가 거부되면 수동 복사 폴백(#copyFallback)이 노출된다 (Req 3.4)", async () => {
    const fake = makeFakeConnect();
    // URL에 따라 invite/room/scenarios 성공 응답을 돌려준다.
    window.__lobbyFetch = (url) => {
      if (typeof url === "string" && url.endsWith("/invite")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ inviteLink: "https://ready-gm/r/tok-1" }),
        });
      }
      if (typeof url === "string" && url === "/scenarios") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ scenarios: [] }),
        });
      }
      // 방 정보 해석(/rooms/tok-1)
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ maxPlayers: 5, scenarioId: "s1" }),
      });
    };
    window.__lobbyNewAbortController = () => new AbortController();
    window.__lobbyConnect = fake.connect;
    // writeText가 항상 거부 → copyInviteLink false → 폴백 노출.
    window.__lobbyClipboard = { writeText: () => Promise.reject(new Error("denied")) };

    await loadPage();
    await flush();

    // 초대 성공 후 수동 복사 입력에 전체 링크가 채워지고 복사 버튼이 활성화된다.
    const manualCopy = document.getElementById("manualCopy");
    expect(manualCopy.value).toBe("https://ready-gm/r/tok-1");
    const copyBtn = document.getElementById("copyBtn");
    expect(copyBtn.disabled).toBe(false);

    // 폴백은 복사 시도 전에는 숨겨져 있다.
    const copyFallback = document.getElementById("copyFallback");
    expect(copyFallback.hidden).toBe(true);

    // 복사 시도 → 실패 → 폴백 노출.
    copyBtn.click();
    await flush();

    expect(copyFallback.hidden).toBe(false);
    // 수동 복사용 입력은 여전히 전체 링크를 보유한다(직접 선택·복사 가능).
    expect(manualCopy.value).toBe("https://ready-gm/r/tok-1");
  });

  it("character_setup 수신 시 viewer의 playerId를 담아 /character/로 1회 이동한다 (멀티플레이어 흐름)", async () => {
    const fake = makeFakeConnect();
    // REST는 이 테스트에서 관심 밖이므로 영원히 pending인 fetch를 둔다.
    window.__lobbyFetch = () => new Promise(() => {});
    window.__lobbyNewAbortController = () => new AbortController();
    window.__lobbyConnect = fake.connect;
    window.__lobbyClipboard = undefined;

    // 입장 플레이어 신원(playerId)으로 로비에 들어온다(hostPlayerId 없음).
    await loadPage({ url: "https://localhost/lobby/?roomId=r1&playerId=p9&token=secret" });
    await flush();

    // location.assign을 가로채 이동 대상을 캡처한다(로비는 location.assign 패턴 사용).
    const assignSpy = vi.spyOn(window.location, "assign").mockImplementation(() => {});

    // 서버가 호스트 시작을 전원에게 브로드캐스트 → 각자 자기 캐릭터 시트로 이동.
    fake.handlers.onMessage({ type: "character_setup" });
    await flush();

    expect(assignSpy).toHaveBeenCalledTimes(1);
    const target = assignSpy.mock.calls[0][0];
    expect(target.startsWith("/character/?")).toBe(true);
    const params = new URLSearchParams(target.slice(target.indexOf("?") + 1));
    expect(params.get("roomId")).toBe("r1");
    // viewer 신원 = playerId(호스트 아님).
    expect(params.get("playerId")).toBe("p9");
    expect(params.get("token")).toBe("secret");
    expect(params.has("hostPlayerId")).toBe(false);

    // 반복 수신해도 추가 이동은 없다(1회 보장).
    fake.handlers.onMessage({ type: "character_setup" });
    await flush();
    expect(assignSpy).toHaveBeenCalledTimes(1);
  });

  it("비호스트 viewer: 시작 버튼을 숨기고 대기 안내를 보이며, 역할 배지는 '플레이어'다 (호스트 전용 시작)", async () => {
    const fake = makeFakeConnect();
    window.__lobbyFetch = () => new Promise(() => {});
    window.__lobbyNewAbortController = () => new AbortController();
    window.__lobbyConnect = fake.connect;
    window.__lobbyClipboard = undefined;

    // 입장 플레이어 신원(playerId만)으로 로비에 들어온다(hostPlayerId 없음).
    await loadPage({ url: "https://localhost/lobby/?roomId=r1&playerId=p9&token=secret" });
    await flush();

    // 시작 조건을 모두 충족시켜도 비호스트는 시작 버튼이 활성화되지 않는다.
    fake.handlers.onOpen();
    fake.handlers.onMessage({
      type: "player_list_updated",
      players: [
        { id: "h1", displayName: "방장", isHost: true },
        { id: "p9", displayName: "나", isHost: false },
      ],
    });
    fake.handlers.onMessage({
      type: "scenario_set",
      scenarioId: "s1",
      title: "시나리오",
      summary: "요약",
    });
    await flush();

    const startActions = document.getElementById("startActions");
    const startBtn = document.getElementById("startBtn");
    const startWaiting = document.getElementById("startWaiting");
    const roleBadge = document.getElementById("roleBadge");

    // 시작 컨트롤은 숨겨지고, 버튼은 비활성, 대기 안내가 노출된다.
    expect(startActions.hidden).toBe(true);
    expect(startBtn.disabled).toBe(true);
    expect(startWaiting.hidden).toBe(false);
    expect(startWaiting.textContent).toContain("기다리고");
    expect(roleBadge.textContent).toBe("로비 · 플레이어");
  });

  it("호스트 viewer: 시작 버튼을 보이고, 조건 충족 시 활성화되며, 역할 배지는 '호스트'다", async () => {
    const fake = makeFakeConnect();
    window.__lobbyFetch = () => new Promise(() => {});
    window.__lobbyNewAbortController = () => new AbortController();
    window.__lobbyConnect = fake.connect;
    window.__lobbyClipboard = undefined;

    // 호스트 신원(hostPlayerId)으로 로비에 들어온다.
    await loadPage({ url: "https://localhost/lobby/?roomId=r1&hostPlayerId=h1" });
    await flush();

    const roleBadge = document.getElementById("roleBadge");
    const startActions = document.getElementById("startActions");
    const startWaiting = document.getElementById("startWaiting");
    // 로스터 도착 전에도 인계 휴리스틱으로 호스트 인식 → 배지/시작 영역 노출.
    expect(roleBadge.textContent).toBe("로비 · 호스트");
    expect(startActions.hidden).toBe(false);
    expect(startWaiting.hidden).toBe(true);

    // 시작 조건 충족 → 시작 버튼 활성화.
    fake.handlers.onOpen();
    fake.handlers.onMessage({
      type: "player_list_updated",
      players: [{ id: "h1", displayName: "방장", isHost: true }],
    });
    fake.handlers.onMessage({
      type: "scenario_set",
      scenarioId: "s1",
      title: "시나리오",
      summary: "요약",
    });
    await flush();

    const startBtn = document.getElementById("startBtn");
    expect(startBtn.disabled).toBe(false);
  });
});
