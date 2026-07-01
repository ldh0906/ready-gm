// @ts-nocheck
/**
 * Property-based tests for Room_Lobby_App clipboard copy adapter.
 * Feature: room-lobby
 *
 * Covers:
 * - Property 16: 복사 동작은 초대 링크 전체를 그대로 기록한다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { copyInviteLink } from "./logic.js";

// 특수문자·이모지·매우 긴 문자열을 포함하는 초대 링크.
const linkGen = fc.oneof(
  fc.string(),
  fc.fullUnicodeString({ maxLength: 2048 }),
  fc.constantFrom(
    "https://ready-gm/r/abc",
    "https://ready-gm/r/한글토큰?x=1#frag",
    "https://ready-gm/r/😀-emoji-token",
    "x".repeat(5000),
  ),
);

describe("room-lobby property tests — clipboard", () => {
  it("Property 16: 복사 동작은 초대 링크 전체를 그대로 기록한다", () => {
    // Feature: room-lobby, Property 16: 복사 동작은 초대 링크 전체를 그대로 기록한다
    fc.assert(
      fc.asyncProperty(linkGen, async (link) => {
        // 모킹된 어댑터는 전달된 값을 그대로 기록한다.
        let recorded;
        const ok = await copyInviteLink(link, {
          writeText: (text) => {
            recorded = text;
          },
        });
        expect(ok).toBe(true);
        // 잘림·변형·공백 추가 없이 링크 전체와 정확히 일치.
        expect(recorded).toBe(link);

        // 어댑터가 없으면 false.
        expect(await copyInviteLink(link, null)).toBe(false);
        expect(await copyInviteLink(link, undefined)).toBe(false);
        // writeText가 없는 어댑터도 false.
        expect(await copyInviteLink(link, {})).toBe(false);
        // 예외를 던지는 어댑터는 false.
        expect(
          await copyInviteLink(link, {
            writeText: () => {
              throw new Error("denied");
            },
          }),
        ).toBe(false);
        // reject 하는 비동기 어댑터도 false.
        expect(
          await copyInviteLink(link, { writeText: () => Promise.reject(new Error("denied")) }),
        ).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
