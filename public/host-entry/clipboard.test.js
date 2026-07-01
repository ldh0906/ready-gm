// @ts-nocheck
/**
 * Property-based tests for Host_Entry_App clipboard copy adapter.
 * Feature: frontend-applications
 *
 * Covers:
 * - Property 13: 복사 동작은 초대 링크 전체를 클립보드에 기록한다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { copyInviteLink } from "./logic.js";

describe("frontend-applications property tests — clipboard copy", () => {
  it("Property 13: 복사 동작은 초대 링크 전체를 클립보드에 기록한다", async () => {
    // Feature: frontend-applications, Property 13: 복사 동작은 초대 링크 전체를 클립보드에 기록한다
    await fc.assert(
      fc.asyncProperty(fc.string(), async (inviteLink) => {
        const recorded = [];
        const clipboard = {
          writeText: (text) => {
            recorded.push(text);
            return Promise.resolve();
          },
        };

        const ok = await copyInviteLink(inviteLink, clipboard);

        // 복사 성공을 반환한다.
        expect(ok).toBe(true);
        // 클립보드 어댑터에 전달된 값은 inviteLink 전체와 정확히 일치한다.
        expect(recorded).toHaveLength(1);
        expect(recorded[0]).toBe(inviteLink);
      }),
      { numRuns: 100 },
    );
  });
});
