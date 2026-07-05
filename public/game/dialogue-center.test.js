// @vitest-environment happy-dom
// @ts-nocheck
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createInitialState, reduce } from "./logic.js";
import { createStoryView } from "./views/story.js";

function turnStateWithChat({ chatLog = [], chatHistory = [] } = {}) {
  return {
    roomId: "r1",
    roundNumber: 2,
    phase: "free_chat",
    readiness: [],
    actionHistory: [],
    chatLog,
    chatHistory,
    checks: [],
    rollingChecks: [],
    narrativeContext: [],
  };
}

function storyHarness(narrationEntries) {
  document.body.innerHTML = '<section id="story"></section><button id="newStoryBtn"></button><section id="sceneCard"></section>';
  const state = { ...createInitialState(), narrationEntries };
  const storyEl = document.getElementById("story");
  createStoryView({
    els: {
      storyEl,
      newStoryBtn: document.getElementById("newStoryBtn"),
      sceneCardEl: document.getElementById("sceneCard"),
    },
    helpers: {
      textSpan: (className, text) => {
        const span = document.createElement("span");
        span.className = className;
        span.textContent = text;
        return span;
      },
      isNearBottom: () => true,
      stickToBottom: () => {},
      prefersReducedMotion: () => false,
      now: () => 0,
    },
    getState: () => state,
  }).renderStory();
  return storyEl;
}

describe("game dialogue center routing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("routes in-character TURN_STATE chat to narrationEntries and OOC chat to chatEntries", () => {
    const state = reduce(createInitialState(), {
      type: "TURN_STATE",
      state: turnStateWithChat({
        chatLog: [
          {
            playerId: "p1",
            characterName: "알렉스",
            displayName: "라면",
            text: "누구 있어요?",
            ts: "2026-07-04T00:00:00.000Z",
            inCharacter: true,
          },
          {
            playerId: "p2",
            characterName: "보린",
            text: "잠깐 쉬죠",
            ts: "2026-07-04T00:00:01.000Z",
          },
        ],
      }),
    });

    expect(state.chatCount).toBe(2);
    expect(state.chatEntries).toHaveLength(1);
    expect(state.chatEntries[0].text).toBe("잠깐 쉬죠");
    expect(state.narrationEntries).toContainEqual({
      kind: "dialogue",
      roundNumber: 2,
      speaker: "알렉스",
      displayName: "라면",
      text: "누구 있어요?",
    });
  });

  it("seeds reconnect chatHistory with only OOC chat in the side panel", () => {
    const state = reduce(createInitialState(), {
      type: "TURN_STATE",
      state: turnStateWithChat({
        chatHistory: [
          {
            playerId: "p1",
            characterName: "알렉스",
            text: "들리나요?",
            ts: "2026-07-04T00:00:00.000Z",
            inCharacter: true,
          },
          {
            playerId: "p2",
            characterName: "보린",
            text: "OOC 메모",
            ts: "2026-07-04T00:00:01.000Z",
          },
        ],
      }),
    });

    expect(state.chatEntries).toHaveLength(1);
    expect(state.chatEntries[0].text).toBe("OOC 메모");
    expect(state.chatEntries.some((c) => c.text === "들리나요?")).toBe(false);
  });

  it("renders dialogue lines immediately without a GM label or typewriter", () => {
    vi.spyOn(window, "setTimeout");
    const storyEl = storyHarness([
      { kind: "dialogue", roundNumber: 2, speaker: "알렉스", text: "누구 있어요?" },
      { kind: "dialogue", roundNumber: 2, text: "대답해 봐요." },
    ]);

    const lines = storyEl.querySelectorAll(".line.say");
    expect(lines).toHaveLength(2);
    expect(lines[0].textContent).toBe("알렉스 「누구 있어요?」");
    expect(lines[1].textContent).toBe("누군가 「대답해 봐요.」");
    expect(storyEl.textContent).not.toContain("[GM ·");
    expect(window.setTimeout).not.toHaveBeenCalled();
  });
});
