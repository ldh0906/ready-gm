// @ts-nocheck
/**
 * Property-based tests for Game_Play_App chat append-new-only view model.
 * Feature: game-play
 *
 * Covers:
 * - Property 5: 채팅 로그는 새 항목만 추가하고 축소 시 리셋한다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { appendNewChats } from "./logic.js";

const chatEntryGen = fc.record({
  playerId: fc.string(),
  characterName: fc.string(),
  text: fc.fullUnicodeString(),
  ts: fc.string(),
});

describe("game-play property tests — chat", () => {
  it("Property 5: 채팅 로그는 새 항목만 추가하고 축소 시 리셋한다", () => {
    // Feature: game-play, Property 5: 채팅 로그는 새 항목만 추가하고 축소 시 리셋한다
    // prevCount: 음수/0/양수 모두, chatLog: prevCount보다 길거나 짧은(축소) 목록(0 길이 포함).
    const prevCountGen = fc.integer({ min: -3, max: 30 });
    const chatLogGen = fc.array(chatEntryGen, { minLength: 0, maxLength: 30 });

    fc.assert(
      fc.property(prevCountGen, chatLogGen, (prevCount, chatLog) => {
        const { entries, nextCount } = appendNewChats(prevCount, chatLog);

        // nextCount는 항상 chatLog 길이.
        expect(nextCount).toBe(chatLog.length);

        // prevCount<=0(또는 축소)는 0으로 보고 전체를, 아니면 prevCount 이후만 새 항목.
        const effectivePrev = prevCount > 0 ? prevCount : 0;
        const start = chatLog.length >= effectivePrev ? effectivePrev : 0;
        expect(entries).toStrictEqual(chatLog.slice(start));
      }),
      { numRuns: 100 },
    );
  });
});
