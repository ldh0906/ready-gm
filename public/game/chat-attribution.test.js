// @vitest-environment happy-dom
// @ts-nocheck
/**
 * Integration tests for chat attribution rendering — `characterName(displayName)`.
 * Feature: game-play (chat displayName attribution)
 *
 * The backend now puts an optional `displayName` on each chat entry (alongside
 * `characterName`). The side log should render `characterName(displayName)`
 * (e.g. "알렉스(라면)") when a non-empty `displayName` is present AND it differs
 * from `characterName`; otherwise it renders just `characterName`.
 *
 * Approach mirrors integration.test.js: load the page's static <body> markup,
 * extract the inline module to a sibling temp file so `./logic.js` resolves,
 * dynamically import it to run the REAL wiring against the live DOM, then drive
 * turn_state / chat_message events through the injected fake channel.
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

async function loadPage(opts = {}) {
  const url = opts.url || "https://localhost/game/?roomId=r1&hostPlayerId=h1";
  if (window.happyDOM && typeof window.happyDOM.setURL === "function") {
    window.happyDOM.setURL(url);
  }
  document.body.innerHTML = bodyMarkup;
  const tmpPath = join(here, `__chat_attr_tmp_${tempCounter++}.js`);
  writeFileSync(tmpPath, inlineModuleSource, "utf8");
  tempFiles.push(tmpPath);
  await import(/* @vite-ignore */ pathToFileURL(tmpPath).href);
}

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

function makeFakeConnect() {
  const calls = [];
  const sent = [];
  let handlers = null;
  const connect = (roomId, token, h) => {
    calls.push({ roomId, token });
    handlers = h;
    return { send: (obj) => sent.push(obj), close: () => {} };
  };
  return {
    connect,
    calls,
    sent,
    get handlers() {
      return handlers;
    },
  };
}

function makeManualTimers() {
  let nextId = 1;
  const intervals = new Map();
  return {
    setInterval: (fn) => {
      const id = nextId++;
      intervals.set(id, fn);
      return id;
    },
    clearInterval: (id) => intervals.delete(id),
  };
}

/** turn_state carrying a single chat entry (overrides merged into the entry). */
function turnStateWithChat(entry) {
  return {
    type: "turn_state",
    state: {
      roomId: "r1",
      roundNumber: 1,
      phase: "free_chat",
      readiness: [{ playerId: "h1", status: "ready", actionKind: null, actionText: null }],
      chatLog: [entry],
      checks: [],
      narrativeContext: [],
      readyCheckDeadline: null,
      readyCheckTimeoutMs: 90000,
      resolutionRequested: false,
    },
  };
}

function clearHooks() {
  delete window.__gameConnect;
  delete window.__gameNow;
  delete window.__gameSetInterval;
  delete window.__gameClearInterval;
}

async function bootWithChat(entry) {
  const fake = makeFakeConnect();
  const timers = makeManualTimers();
  window.__gameConnect = fake.connect;
  window.__gameSetInterval = timers.setInterval;
  window.__gameClearInterval = timers.clearInterval;
  await loadPage();
  await flush();
  fake.handlers.onOpen();
  fake.handlers.onMessage(turnStateWithChat(entry));
  await flush();
  return fake;
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

describe("game-play chat attribution — characterName(displayName)", () => {
  it("displayName이 있고 characterName과 다르면 '알렉스' + '(라면)'을 함께 표시한다", async () => {
    await bootWithChat({ playerId: "p2", characterName: "알렉스", displayName: "라면", text: "안녕" });

    const side = document.getElementById("side");
    // 캐릭터 이름은 굵게 귀속된다.
    const bold = Array.from(side.querySelectorAll("b")).map((b) => b.textContent);
    expect(bold).toContain("알렉스");
    // 합류 표시 이름은 .chat-handle 안에 "(라면)"으로 표시된다.
    const handle = side.querySelector(".chat-handle");
    expect(handle).not.toBeNull();
    expect(handle.textContent).toBe("(라면)");
    // 본문 텍스트도 그대로 표시된다.
    expect(side.textContent).toContain("안녕");
  });

  it("displayName이 없으면 characterName만 표시하고 .chat-handle은 없다", async () => {
    await bootWithChat({ playerId: "p2", characterName: "알렉스", text: "안녕" });

    const side = document.getElementById("side");
    const bold = Array.from(side.querySelectorAll("b")).map((b) => b.textContent);
    expect(bold).toContain("알렉스");
    expect(side.querySelector(".chat-handle")).toBeNull();
    expect(side.textContent).toContain("안녕");
  });

  it("displayName이 빈 문자열/공백이면 .chat-handle을 만들지 않는다", async () => {
    await bootWithChat({ playerId: "p2", characterName: "알렉스", displayName: "   ", text: "안녕" });

    const side = document.getElementById("side");
    expect(side.querySelector(".chat-handle")).toBeNull();
    expect(side.textContent).toContain("알렉스");
  });

  it("displayName이 characterName과 같으면 괄호 부분을 표시하지 않는다", async () => {
    await bootWithChat({ playerId: "p2", characterName: "알렉스", displayName: "알렉스", text: "안녕" });

    const side = document.getElementById("side");
    expect(side.querySelector(".chat-handle")).toBeNull();
    expect(side.textContent).not.toContain("(알렉스)");
  });

  it("displayName의 HTML은 이스케이프되어 요소로 해석되지 않는다", async () => {
    await bootWithChat({
      playerId: "p2",
      characterName: "알렉스",
      displayName: "<img src=x onerror=alert(1)>",
      text: "안녕",
    });

    const side = document.getElementById("side");
    const handle = side.querySelector(".chat-handle");
    expect(handle).not.toBeNull();
    // 주입된 태그가 실제 요소로 만들어지지 않는다(이스케이프).
    expect(side.querySelector("img")).toBeNull();
    // 원문 꺾쇠가 텍스트로 남는다.
    expect(handle.textContent).toContain("<img");
  });

  it("라이브 chat_message 경로에서도 동일하게 귀속 표시한다", async () => {
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
      message: { playerId: "p2", characterName: "알렉스", displayName: "라면", text: "안녕", ts: "t" },
    });
    await flush();

    const side = document.getElementById("side");
    const handle = side.querySelector(".chat-handle");
    expect(handle).not.toBeNull();
    expect(handle.textContent).toBe("(라면)");
    expect(side.textContent).toContain("알렉스");
    expect(side.textContent).toContain("안녕");
  });
});
