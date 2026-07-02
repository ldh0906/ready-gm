// @vitest-environment happy-dom
// @ts-nocheck
/**
 * Integration tests for Game_Play_App side-effect wiring — Task 6.4.
 * Feature: game-play
 *
 * Approach (real execution of the page, mirroring public/lobby/wiring.test.js):
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
 *   - window.__gameConnect       : connect(roomId, token, handlers) -> { send, close }
 *   - window.__gameNow           : Date.now replacement (countdown)
 *   - window.__gameSetInterval   : setInterval injection (countdown)
 *   - window.__gameClearInterval : clearInterval injection (countdown)
 * NOTE: the page reads `const connect = window.__gameConnect || defaultConnect`
 * at module top-level, so __gameConnect MUST be set before loadPage(). The page
 * also uses the global setTimeout for reconnect (RECONNECT_INTERVAL_MS=3000),
 * so the reconnect test uses vi.useFakeTimers(). Countdown timers are injected
 * via a manual harness so no real intervals leak across tests.
 *
 * Covers (integration, not property):
 * - Req 2.1: 유효 인계 시 connect 어댑터가 roomId로 호출, onOpen → 연결 활성 표시
 * - Req 2.2 / 5.1: turn_state → 라운드/단계/준비/채팅 반영, 입력 활성
 * - Req 3.x / 4.3: narration 렌더 + HTML 이스케이프(원문 태그 미해석), kind 스타일
 * - Req 4.2 / 4.3: 라이브 chat_message → characterName 귀속 표시
 * - Req 5.4: ready_check 카운트다운 잔여 초 표시, 단계 변경 시 숨김
 * - Req 6.x / 6.6: 말하기·확정·패스 전송 + 입력 필드 비우기 + 본인 로컬 에코
 * - Req 7.3: 입력 잠금(resolving) 동안 명령 미전송
 * - Req 8.1 / 8.3 / 8.4: 끊김 표시 + 고정 간격 재연결 + 끊김 동안 미전송
 * - Req 9.4: 세션 종료 안내 + 입력 비활성 + 추가 네비게이션 미수행
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { SESSION_ENDED_MESSAGE, CONNECTION_LOST_MESSAGE } from "./logic.js";

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
 * 주입 훅(window.__game*)은 호출 전에 이미 설정되어 있어야 한다.
 * @param {{ url?: string }} [opts]
 */
async function loadPage(opts = {}) {
  const url = opts.url || "https://localhost/game/?roomId=r1&hostPlayerId=h1";
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

/**
 * 핸들러를 캡처하고 send 페이로드를 기록하는 가짜 채널 어댑터.
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

/**
 * 카운트다운 setInterval/clearInterval 주입용 수동 타이머 하니스.
 * 실제 인터벌이 테스트 간 누수되지 않도록 모든 테스트에서 주입한다.
 */
function makeManualTimers() {
  let nextId = 1;
  const intervals = new Map();
  return {
    setInterval: (fn) => {
      const id = nextId++;
      intervals.set(id, fn);
      return id;
    },
    clearInterval: (id) => {
      intervals.delete(id);
    },
    /** 등록된 모든 인터벌 콜백을 1회 발화한다. */
    tick: () => {
      for (const fn of intervals.values()) fn();
    },
    get count() {
      return intervals.size;
    },
  };
}

/** 기본 turn_state 페이로드(free_chat, 2인 readiness, 채팅 1건). */
function baseTurnState(overrides = {}) {
  return {
    type: "turn_state",
    state: {
      roomId: "r1",
      roundNumber: 1,
      phase: "free_chat",
      readiness: [
        { playerId: "h1", status: "ready", actionKind: null, actionText: null },
        { playerId: "p2", status: "not_ready", actionKind: null, actionText: null },
      ],
      chatLog: [{ playerId: "p2", characterName: "엘프", text: "안녕", ts: "t" }],
      checks: [],
      // 오프닝 서사가 이미 전달된 일반 진행 상태를 모사한다(오프닝 대기 입력 잠금 해제).
      narrativeContext: [{ round: 1, text: "도입부 서사" }],
      readyCheckDeadline: null,
      readyCheckTimeoutMs: 90000,
      resolutionRequested: false,
      ...overrides,
    },
  };
}

function clearHooks() {
  delete window.__gameConnect;
  delete window.__gameNow;
  delete window.__gameSetInterval;
  delete window.__gameClearInterval;
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

describe("game-play integration tests — side-effect wiring", () => {
  it("유효 인계 시 connect가 roomId로 호출되고 onOpen → 연결 활성 표시 (Req 2.1)", async () => {
    const fake = makeFakeConnect();
    const timers = makeManualTimers();
    window.__gameConnect = fake.connect;
    window.__gameSetInterval = timers.setInterval;
    window.__gameClearInterval = timers.clearInterval;

    await loadPage({ url: "https://localhost/game/?roomId=r1&hostPlayerId=h1" });
    await flush();

    // 채널 연결이 roomId "r1"로 시작된다(Req 2.1).
    expect(fake.calls.length).toBeGreaterThanOrEqual(1);
    expect(fake.calls[0].roomId).toBe("r1");

    const connStatus = document.getElementById("connStatus");
    // onOpen 전에는 활성 표시가 아니다.
    expect(connStatus.classList.contains("active")).toBe(false);

    fake.handlers.onOpen();
    await flush();

    // onOpen → 연결 활성 표시.
    expect(connStatus.classList.contains("active")).toBe(true);
    expect(connStatus.textContent).toBe("실시간 연결됨");
  });

  it("turn_state → 라운드/단계/준비/채팅이 반영되고 입력이 활성화된다 (Req 2.2, 5.1)", async () => {
    const fake = makeFakeConnect();
    const timers = makeManualTimers();
    window.__gameConnect = fake.connect;
    window.__gameSetInterval = timers.setInterval;
    window.__gameClearInterval = timers.clearInterval;

    await loadPage();
    await flush();

    fake.handlers.onOpen();
    fake.handlers.onMessage(baseTurnState());
    await flush();

    // 헤더: 라운드 / 단계 / 준비 X/total (Req 5.1, 5.2).
    expect(document.getElementById("round").textContent).toBe("1");
    expect(document.getElementById("phase").textContent).toBe("free_chat");
    expect(document.getElementById("ready").textContent).toBe("준비 1/2");

    // 채팅 로그가 사이드바에 귀속·표시된다.
    const side = document.getElementById("side");
    expect(side.textContent).toContain("엘프");
    expect(side.textContent).toContain("안녕");

    // 연결 활성 + free_chat 턴 수신 후 입력 활성화(Req 7.2).
    expect(document.getElementById("msg").disabled).toBe(false);
    expect(document.getElementById("sendBtn").disabled).toBe(false);
    expect(document.getElementById("passBtn").disabled).toBe(false);
  });

  it("narration → GM 서사 패널에 추가되고 HTML이 이스케이프된다(kind 스타일 포함) (Req 3.1, 3.4, 4.3)", async () => {
    const fake = makeFakeConnect();
    const timers = makeManualTimers();
    window.__gameConnect = fake.connect;
    window.__gameSetInterval = timers.setInterval;
    window.__gameClearInterval = timers.clearInterval;

    await loadPage();
    await flush();

    fake.handlers.onOpen();
    fake.handlers.onMessage({
      type: "narration",
      roomId: "r1",
      narration: { kind: "opening", roundNumber: 1, text: "<b>위험</b> & 어둠" },
    });
    await flush();

    const story = document.getElementById("story");
    // 텍스트는 보이되, 원문 <b> 태그는 요소로 렌더되지 않는다(이스케이프).
    expect(story.textContent).toContain("위험");
    expect(story.textContent).toContain("어둠");
    // 이스케이프되었으므로 원문 꺾쇠가 텍스트로 남는다.
    expect(story.textContent).toContain("<b>");
    // 실제 <b> 요소가 생성되지 않았다(주입 방지).
    expect(story.querySelector("b")).toBeNull();
    // kind 스타일 클래스가 적용된 서사 항목이 존재한다.
    expect(story.querySelector(".gm.opening")).not.toBeNull();
  });

  it("라이브 chat_message → characterName 귀속으로 사이드바에 추가된다 (Req 4.2, 4.3)", async () => {
    const fake = makeFakeConnect();
    const timers = makeManualTimers();
    window.__gameConnect = fake.connect;
    window.__gameSetInterval = timers.setInterval;
    window.__gameClearInterval = timers.clearInterval;

    await loadPage();
    await flush();

    fake.handlers.onOpen();
    fake.handlers.onMessage({
      type: "chat_message",
      roomId: "r1",
      message: { playerId: "p2", characterName: "드워프", text: "공격!", ts: "t" },
    });
    await flush();

    const side = document.getElementById("side");
    expect(side.textContent).toContain("드워프");
    expect(side.textContent).toContain("공격!");
    // characterName은 굵게(<b>) 귀속 표시된다.
    const bold = Array.from(side.querySelectorAll("b")).map((b) => b.textContent);
    expect(bold).toContain("드워프");
  });

  it("ready_check 카운트다운이 잔여 초를 표시하고, 단계가 바뀌면 숨겨진다 (Req 5.4)", async () => {
    const fake = makeFakeConnect();
    const timers = makeManualTimers();
    const base = 1_700_000_000_000;
    let nowMs = base;
    window.__gameNow = () => nowMs;
    window.__gameConnect = fake.connect;
    window.__gameSetInterval = timers.setInterval;
    window.__gameClearInterval = timers.clearInterval;

    await loadPage();
    await flush();

    fake.handlers.onOpen();
    // ready_check 단계 + 30초 뒤 마감.
    fake.handlers.onMessage(
      baseTurnState({
        phase: "ready_check",
        readyCheckDeadline: new Date(base + 30000).toISOString(),
      }),
    );
    await flush();

    const countdown = document.getElementById("countdown");
    expect(countdown.hidden).toBe(false);
    expect(countdown.textContent).toContain("30초");

    // 10초 경과 후 카운트다운 타이머가 발화하면 잔여 초가 갱신된다.
    nowMs = base + 10000;
    timers.tick();
    expect(countdown.hidden).toBe(false);
    expect(countdown.textContent).toContain("20초");

    // 단계가 ready_check가 아니게 되면 카운트다운은 숨겨진다.
    fake.handlers.onMessage(baseTurnState({ phase: "free_chat" }));
    await flush();
    expect(countdown.hidden).toBe(true);
  });

  it("말하기·확정·패스 명령 전송 + 입력 필드 비우기 + 행동 로그(이름) 동기화 표시 (Req 6.1, 6.2, 6.3, 6.6)", async () => {
    const fake = makeFakeConnect();
    const timers = makeManualTimers();
    window.__gameConnect = fake.connect;
    window.__gameSetInterval = timers.setInterval;
    window.__gameClearInterval = timers.clearInterval;

    await loadPage();
    await flush();

    fake.handlers.onOpen();
    fake.handlers.onMessage(baseTurnState());
    await flush();

    const msg = document.getElementById("msg");
    const side = document.getElementById("side");

    // 대사("")는 채팅으로 전송 + 입력 비우기. 채팅은 서버 echo이므로 로컬 에코 없음.
    msg.value = '"안녕하세요"';
    document.getElementById("sendBtn").click();
    await flush();
    expect(fake.sent).toContainEqual({ type: "chat", text: "안녕하세요" });
    expect(msg.value).toBe("");

    // 따옴표 없는 행동은 확정으로 전송 + 입력 비우기.
    msg.value = "문을 연다";
    document.getElementById("sendBtn").click();
    await flush();
    expect(fake.sent).toContainEqual({ type: "confirm", action: "문을 연다" });
    expect(msg.value).toBe("");
    // 서버가 h1의 확정 행동을 readiness에 실어(이름 포함) 브로드캐스트하면, 사이드바 행동 로그에
    // "캐릭터이름(방입장이름) 행동 확정: …" 형식으로 전원에게 동기화되어 표시된다(코드 아님).
    fake.handlers.onMessage(
      baseTurnState({
        readiness: [
          {
            playerId: "h1",
            status: "ready",
            actionKind: "confirmed_action",
            actionText: "문을 연다",
            characterName: "알렉스",
            displayName: "라면",
          },
          { playerId: "p2", status: "not_ready", actionKind: null, actionText: null },
        ],
      }),
    );
    await flush();
    expect(side.textContent).toContain("문을 연다");
    expect(side.textContent).toContain("알렉스(라면)");
    expect(side.textContent).not.toContain("h1");

    // 패스: {type:"pass"} 전송. 서버가 패스를 readiness에 실어 브로드캐스트하면 행동 로그에
    // "캐릭터이름(방입장이름) — 패스"가 동기화되어 표시된다.
    document.getElementById("passBtn").click();
    await flush();
    expect(fake.sent).toContainEqual({ type: "pass" });
    fake.handlers.onMessage(
      baseTurnState({
        readiness: [
          {
            playerId: "h1",
            status: "ready",
            actionKind: "pass",
            actionText: null,
            characterName: "알렉스",
            displayName: "라면",
          },
          { playerId: "p2", status: "not_ready", actionKind: null, actionText: null },
        ],
      }),
    );
    await flush();
    expect(side.textContent).toContain("패스");
  });

  it("입력 잠금(resolving) 동안에는 명령을 전송하지 않는다 (Req 7.3)", async () => {
    const fake = makeFakeConnect();
    const timers = makeManualTimers();
    window.__gameConnect = fake.connect;
    window.__gameSetInterval = timers.setInterval;
    window.__gameClearInterval = timers.clearInterval;

    await loadPage();
    await flush();

    fake.handlers.onOpen();
    fake.handlers.onMessage(baseTurnState({ phase: "resolving" }));
    await flush();

    // resolving이면 입력 컨트롤이 비활성이다(Req 7.1).
    expect(document.getElementById("sendBtn").disabled).toBe(true);
    expect(document.getElementById("msg").disabled).toBe(true);

    const before = fake.sent.length;
    const msg = document.getElementById("msg");
    msg.value = "보내면 안 됨";
    document.getElementById("sendBtn").click();
    await flush();

    // 잠금 동안 클릭해도 아무 명령도 전송되지 않는다.
    expect(fake.sent.length).toBe(before);
  });

  it("끊김 표시 + 고정 간격 재연결, 끊김 동안 명령 미전송 (Req 8.1, 8.3, 8.4)", async () => {
    vi.useFakeTimers();
    const fake = makeFakeConnect();
    const timers = makeManualTimers();
    window.__gameConnect = fake.connect;
    window.__gameSetInterval = timers.setInterval;
    window.__gameClearInterval = timers.clearInterval;

    await loadPage();
    await flush();

    fake.handlers.onOpen();
    fake.handlers.onMessage(baseTurnState());
    await flush();
    expect(fake.calls.length).toBe(1);

    // 끊김 통지 → CONNECTION_LOST 표시.
    fake.handlers.onClose();
    await flush();

    const connStatus = document.getElementById("connStatus");
    expect(connStatus.classList.contains("active")).toBe(false);
    expect(connStatus.textContent).toBe(CONNECTION_LOST_MESSAGE);

    // 끊긴 동안에는 명령을 전송하지 않는다(Req 8.4).
    const before = fake.sent.length;
    const msg = document.getElementById("msg");
    msg.value = "끊긴 동안";
    document.getElementById("sendBtn").click();
    await flush();
    expect(fake.sent.length).toBe(before);

    // 고정 간격(RECONNECT_INTERVAL_MS≈3000) 경과 → connect 재호출(Req 8.1).
    await vi.advanceTimersByTimeAsync(3000);
    await flush();
    expect(fake.calls.length).toBe(2);
    expect(fake.calls[1].roomId).toBe("r1");
  });

  it("세션 종료(turn_state ended) → 종료 안내 + 입력 비활성 + 추가 네비게이션 미수행 (Req 9.4)", async () => {
    const fake = makeFakeConnect();
    const timers = makeManualTimers();
    window.__gameConnect = fake.connect;
    window.__gameSetInterval = timers.setInterval;
    window.__gameClearInterval = timers.clearInterval;

    await loadPage();
    await flush();

    const beforePath = window.location.pathname;
    let assignSpy = null;
    try {
      assignSpy = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    } catch {
      assignSpy = null;
    }

    fake.handlers.onOpen();
    fake.handlers.onMessage(baseTurnState());
    await flush();
    // 종료 전에는 입력이 활성.
    expect(document.getElementById("sendBtn").disabled).toBe(false);

    // 종료 전이.
    fake.handlers.onMessage(baseTurnState({ phase: "ended" }));
    await flush();

    // 종료 안내가 노출된다(Req 9.3 문구 재사용).
    const notice = document.getElementById("notice");
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toBe(SESSION_ENDED_MESSAGE);

    // 입력 컨트롤이 비활성으로 유지된다(Req 9.2).
    expect(document.getElementById("msg").disabled).toBe(true);
    expect(document.getElementById("sendBtn").disabled).toBe(true);
    expect(document.getElementById("passBtn").disabled).toBe(true);

    // 종착 화면이므로 추가 네비게이션을 수행하지 않는다(Req 9.4).
    if (assignSpy) expect(assignSpy).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(beforePath);
  });

  it("세션 종료(closing narration) → 종료 안내가 표시되고 입력이 비활성화된다 (Req 9.4)", async () => {
    const fake = makeFakeConnect();
    const timers = makeManualTimers();
    window.__gameConnect = fake.connect;
    window.__gameSetInterval = timers.setInterval;
    window.__gameClearInterval = timers.clearInterval;

    await loadPage();
    await flush();

    fake.handlers.onOpen();
    fake.handlers.onMessage(baseTurnState());
    await flush();

    // closing narration → 세션 종료.
    fake.handlers.onMessage({
      type: "narration",
      roomId: "r1",
      narration: { kind: "closing", roundNumber: 9, text: "모험은 여기서 끝난다." },
    });
    await flush();

    const notice = document.getElementById("notice");
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toBe(SESSION_ENDED_MESSAGE);
    expect(document.getElementById("sendBtn").disabled).toBe(true);
  });

  it("narration의 clocks 페이로드가 진행 시계 게이지로 렌더된다(노출 시나리오)", async () => {
    const fake = makeFakeConnect();
    const timers = makeManualTimers();
    window.__gameConnect = fake.connect;
    window.__gameSetInterval = timers.setInterval;
    window.__gameClearInterval = timers.clearInterval;

    await loadPage();
    await flush();

    const clocksEl = document.getElementById("clocks");
    // 초기에는 시계가 없으므로 숨겨져 있다.
    expect(clocksEl.hidden).toBe(true);

    fake.handlers.onOpen();
    fake.handlers.onMessage({
      type: "narration",
      roomId: "r1",
      narration: {
        kind: "resolution",
        roundNumber: 1,
        text: "결과",
        clocks: [
          { name: "묘지 경계도", value: 6, max: 6 },
          { name: "의식 완성", value: 3, max: 8 },
        ],
      },
    });
    await flush();

    // 시계 영역이 노출되고 두 게이지가 렌더된다.
    expect(clocksEl.hidden).toBe(false);
    expect(clocksEl.textContent).toContain("묘지 경계도 6/6");
    expect(clocksEl.textContent).toContain("의식 완성 3/8");

    const gauges = clocksEl.querySelectorAll(".clock-gauge");
    expect(gauges.length).toBe(2);
    // 첫 시계(6/6): 6칸 모두 채워짐 + full 상태 클래스.
    const first = clocksEl.querySelectorAll(".clock")[0];
    expect(first.classList.contains("full")).toBe(true);
    expect(first.querySelectorAll(".seg").length).toBe(6);
    expect(first.querySelectorAll(".seg.on").length).toBe(6);
    // 둘째 시계(3/8): 8칸 중 3칸만 채워짐.
    const second = clocksEl.querySelectorAll(".clock")[1];
    expect(second.classList.contains("full")).toBe(false);
    expect(second.querySelectorAll(".seg").length).toBe(8);
    expect(second.querySelectorAll(".seg.on").length).toBe(3);
  });

  it("기본 connect는 /ws URL에 관전자 playerId를 포함한다(joined 플레이어 본인 식별자)", async () => {
    // __gameConnect를 주입하지 않아 실제 defaultConnect(new WebSocket(...)) 경로가 실행된다.
    // 글로벌 WebSocket을 스텁해 생성 URL을 캡처한다.
    const timers = makeManualTimers();
    window.__gameSetInterval = timers.setInterval;
    window.__gameClearInterval = timers.clearInterval;

    const urls = [];
    const OriginalWebSocket = window.WebSocket;
    class FakeWebSocket {
      constructor(url) {
        urls.push(url);
        this.onopen = null;
        this.onmessage = null;
        this.onclose = null;
      }
      send() {}
      close() {}
    }
    window.WebSocket = FakeWebSocket;
    try {
      // 캐릭터 화면 인계: 과거 URL token이 있어도 /ws에는 싣지 않는다.
      await loadPage({ url: "https://localhost/game/?roomId=r1&playerId=p2&hostPlayerId=h1&token=t9" });
      await flush();

      expect(urls.length).toBeGreaterThanOrEqual(1);
      const url = urls[0];
      expect(url).toContain("/ws?");
      const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
      // 관전자 playerId(=p2)가 그대로 실린다(host h1로 취급되지 않음).
      expect(params.get("playerId")).toBe("p2");
      // room/player 식별은 남기되 bearer token은 URL credential로 남기지 않는다.
      expect(params.get("roomId")).toBe("r1");
      expect(params.get("token")).toBeNull();
    } finally {
      window.WebSocket = OriginalWebSocket;
    }
  });

  it("기본 connect는 playerId가 없으면 /ws URL에 hostPlayerId로 폴백한다(로비 호스트 인계)", async () => {
    const timers = makeManualTimers();
    window.__gameSetInterval = timers.setInterval;
    window.__gameClearInterval = timers.clearInterval;

    const urls = [];
    const OriginalWebSocket = window.WebSocket;
    class FakeWebSocket {
      constructor(url) {
        urls.push(url);
        this.onopen = null;
        this.onmessage = null;
        this.onclose = null;
      }
      send() {}
      close() {}
    }
    window.WebSocket = FakeWebSocket;
    try {
      // 로비 호스트 인계: playerId 없음, hostPlayerId만 존재.
      await loadPage({ url: "https://localhost/game/?roomId=r1&hostPlayerId=h1" });
      await flush();

      expect(urls.length).toBeGreaterThanOrEqual(1);
      const params = new URLSearchParams(urls[0].slice(urls[0].indexOf("?") + 1));
      // playerId가 비어 있으므로 effectivePlayerId는 hostPlayerId(=h1)로 폴백한다.
      expect(params.get("playerId")).toBe("h1");
      expect(params.get("roomId")).toBe("r1");
    } finally {
      window.WebSocket = OriginalWebSocket;
    }
  });
});
