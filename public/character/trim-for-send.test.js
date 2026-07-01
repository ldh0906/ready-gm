// @ts-nocheck
/**
 * Property-based tests for Character_Sheet_App 전송 정규화(trimForSend).
 * Feature: character-sheet
 *
 * Covers:
 * - Property 11: 전송 정규화는 내부 공백을 보존한다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { trimForSend } from "./logic.js";

// ECMAScript String.prototype.trim()이 제거하는(그리고 /\s/가 매칭하는) 공백 문자들.
const whitespaceChar = fc.constantFrom(" ", "\t", "\n", "\r", "\f", "\v", "\u00a0");

// 비어 있을 수도 있는 앞뒤 공백 런(연속 공백 문자열).
const edgeWhitespace = fc.array(whitespaceChar, { maxLength: 5 }).map((chars) => chars.join(""));

// 비어 있지 않은 내부 공백 런(토큰 사이를 잇는 진짜 내부 공백).
const internalWhitespace = fc
  .array(whitespaceChar, { minLength: 1, maxLength: 4 })
  .map((chars) => chars.join(""));

// 공백을 포함하지 않는 비어 있지 않은 토큰(앞뒤·내부 어디에도 공백 없음).
const token = fc
  .string({ minLength: 1, maxLength: 8 })
  .map((s) => s.replace(/\s/gu, "x"));

// 앞뒤로 공백이 없고 내부에 공백을 포함할 수 있는 "코어" 문자열.
// 토큰들을 비어 있지 않은 내부 공백 런으로 이어 붙여, 코어는 절대 공백으로 시작/끝나지 않고
// 토큰이 2개 이상이면 반드시 내부 공백을 포함한다.
const core = fc.array(token, { minLength: 1, maxLength: 5 }).chain((tokens) =>
  fc
    .array(internalWhitespace, { minLength: tokens.length - 1, maxLength: tokens.length - 1 })
    .map((seps) => {
      let result = tokens[0];
      for (let i = 1; i < tokens.length; i += 1) {
        result += seps[i - 1] + tokens[i];
      }
      return result;
    }),
);

describe("character-sheet property tests — 전송 정규화는 내부 공백을 보존한다", () => {
  it("Property 11: 전송 정규화는 내부 공백을 보존한다", () => {
    // Feature: character-sheet, Property 11: 전송 정규화는 내부 공백을 보존한다
    // 앞뒤 공백·내부 공백을 포함한 임의 문자열에 대해 trimForSend는 앞뒤 공백만 제거하고
    // 내부 공백은 모두 보존한다(결과는 입력을 트림한 것과 같고 내부 코어를 그대로 포함한다).
    fc.assert(
      fc.property(edgeWhitespace, core, edgeWhitespace, (leading, coreValue, trailing) => {
        const input = leading + coreValue + trailing;
        const result = trimForSend(input);

        // 앞뒤 공백만 제거한 코어와 정확히 일치한다(내부 공백 보존).
        expect(result).toBe(coreValue);
        // 표준 트림과 동치다.
        expect(result).toBe(input.trim());
        // 내부 코어를 부분 문자열로 그대로 포함한다.
        expect(result.includes(coreValue)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 11: trimForSend는 임의 문자열에 대해 앞뒤 공백만 제거한다", () => {
    // Feature: character-sheet, Property 11: 전송 정규화는 내부 공백을 보존한다
    // 구조 없는 임의 문자열에 대해서도 trimForSend는 String.prototype.trim()과 동치이며,
    // 멱등(한 번 트림한 값을 다시 트림해도 불변)이다.
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = trimForSend(s);
        expect(result).toBe(s.trim());
        // 멱등성: 이미 트림된 결과를 다시 트림해도 변하지 않는다.
        expect(trimForSend(result)).toBe(result);
      }),
      { numRuns: 100 },
    );
  });
});
