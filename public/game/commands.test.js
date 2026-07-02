// @ts-nocheck
/**
 * Property-based tests for Game_Play_App command builders and input-lock predicate.
 * Feature: game-play
 *
 * Covers:
 * - Property 8: 입력 잠금은 phase가 resolving 또는 ended일 때에만 참이다
 * - Property 9: 명령 빌더는 올바른 JSON을 만들고 빈 입력을 거부한다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  isInputLocked,
  buildChatCommand,
  buildConfirmCommand,
  buildReviseCommand,
  buildPassCommand,
  buildRollCheckCommand,
  Phase,
} from "./logic.js";

describe("game-play property tests — commands", () => {
  it("Property 8: 입력 잠금은 phase가 resolving 또는 ended일 때에만 참이다", () => {
    // Feature: game-play, Property 8: 입력 잠금은 phase가 resolving 또는 ended일 때에만 참이다
    const phaseGen = fc.oneof(
      fc.constantFrom(Phase.FREE_CHAT, Phase.READY_CHECK, Phase.RESOLVING, Phase.ROLLING, Phase.ENDED),
      fc.string(),
      fc.constant(null),
      fc.constant(undefined),
    );
    fc.assert(
      fc.property(phaseGen, (phase) => {
        const expected = phase === Phase.RESOLVING || phase === Phase.ROLLING || phase === Phase.ENDED;
        expect(isInputLocked(phase)).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 9: 명령 빌더는 올바른 JSON을 만들고 빈 입력을 거부한다", () => {
    // Feature: game-play, Property 9: 명령 빌더는 올바른 JSON을 만들고 빈 입력을 거부한다
    // 빈/공백만/특수문자 포함 비공백 입력.
    const ws = fc.stringOf(fc.constantFrom(" ", "\t", "\n"), { maxLength: 4 });
    const inputGen = fc.oneof(
      fc.constant(""),
      ws,
      fc.tuple(ws, fc.fullUnicodeString({ minLength: 1 }), ws).map(([a, b, c]) => a + b + c),
      fc.fullUnicodeString(),
    );

    fc.assert(
      fc.property(inputGen, (input) => {
        const trimmed = String(input).trim();
        const isBlank = trimmed.length === 0;

        const chat = buildChatCommand(input);
        const confirm = buildConfirmCommand(input);
        const revise = buildReviseCommand(input);
        const roll = buildRollCheckCommand(input);

        if (isBlank) {
          expect(chat).toBeNull();
          expect(confirm).toBeNull();
          expect(revise).toBeNull();
          expect(roll).toBeNull();
        } else {
          expect(chat).toStrictEqual({ type: "chat", text: trimmed });
          expect(confirm).toStrictEqual({ type: "confirm", action: trimmed });
          expect(revise).toStrictEqual({ type: "revise", action: trimmed });
          expect(roll).toStrictEqual({ type: "roll_check", checkId: trimmed });
        }

        // 패스는 입력과 무관하게 항상 유효.
        expect(buildPassCommand()).toStrictEqual({ type: "pass" });
      }),
      { numRuns: 100 },
    );
  });
});
