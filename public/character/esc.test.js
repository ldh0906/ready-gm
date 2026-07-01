// @ts-nocheck
/**
 * Property-based tests for Character_Sheet_App HTML 이스케이프(esc).
 * Feature: character-sheet
 *
 * Covers:
 * - Property 12: 텍스트는 HTML로 해석되지 않게 이스케이프된다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { esc } from "./logic.js";

/**
 * esc가 만든 출력을 디코드한다(텍스트 의미 보존 검증용).
 * esc는 단일 패스로 `&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`로 치환하므로,
 * 디코드는 `&lt;`·`&gt;`를 먼저 되돌린 뒤 마지막에 `&amp;`를 되돌려야 정확히 역변환된다.
 * @param {string} html
 * @returns {string}
 */
function decode(html) {
  return html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// `<`·`>`·`&`·이모지·따옴표·한글·공백 등을 포함하는 풍부한 문자열 생성기.
const SPECIAL_CHARS = fc.constantFrom(
  "<",
  ">",
  "&",
  '"',
  "'",
  "😀",
  "🎲",
  "💥",
  "한",
  "あ",
  " ",
  "\n",
  "\t",
  "a",
  "&amp;",
  "&lt;",
  "<script>",
);

const richString = fc
  .array(fc.oneof(SPECIAL_CHARS, fc.string()))
  .map((parts) => parts.join(""));

const anyString = fc.oneof(richString, fc.string(), fc.fullUnicodeString());

describe("character-sheet property tests — HTML 이스케이프(esc)", () => {
  it("Property 12: 텍스트는 HTML로 해석되지 않게 이스케이프된다", () => {
    // Feature: character-sheet, Property 12: 텍스트는 HTML로 해석되지 않게 이스케이프된다
    // 임의 문자열(<·>·&·이모지 포함)에 대해 esc 출력에는 이스케이프되지 않은 <·>·&가 없고,
    // 출력을 디코드하면 원래 문자열과 같다(텍스트 의미 보존).
    fc.assert(
      fc.property(anyString, (input) => {
        const output = esc(input);

        // --- < 와 > 는 출력에 리터럴로 존재하지 않는다(모두 엔티티로 이스케이프됨) ---
        expect(output.includes("<")).toBe(false);
        expect(output.includes(">")).toBe(false);

        // --- 모든 & 는 유효한 엔티티(&amp; / &lt; / &gt;)의 일부다(이스케이프되지 않은 & 없음) ---
        const withoutEntities = output.replace(/&(amp|lt|gt);/g, "");
        expect(withoutEntities.includes("&")).toBe(false);

        // --- 디코드하면 원래 문자열과 정확히 같다(텍스트 의미 보존) ---
        expect(decode(output)).toBe(input);
      }),
      { numRuns: 100 },
    );
  });
});
