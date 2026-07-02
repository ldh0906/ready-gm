import { describe, expect, it } from "vitest";
import { extractJsonObject, normalizeModelJson } from "./json-extract.js";

describe("extractJsonObject — coordinator-boundary JSON normalization", () => {
  it("returns a pure JSON object unchanged", () => {
    const raw = '{"narration": "밤이 깊었다.", "endingReached": false}';
    expect(extractJsonObject(raw)).toBe(raw);
  });

  it("returns only the FIRST object when two objects are present", () => {
    const raw = '{"a": 1} {"b": 2}';
    expect(extractJsonObject(raw)).toBe('{"a": 1}');
  });

  it("skips prose braces before the object and ignores braces inside strings", () => {
    const raw = 'Here is my decision {sort of}: {"narration": "문이 {쾅} 닫혔다.", "x": "a } b"} done';
    const extracted = extractJsonObject(raw);
    expect(extracted).not.toBeNull();
    expect(JSON.parse(extracted!)).toEqual({ narration: "문이 {쾅} 닫혔다.", x: "a } b" });
  });

  it("fails closed (null) on truncated JSON that never balances", () => {
    expect(extractJsonObject('{"narration": "잘리')).toBeNull();
    expect(extractJsonObject('{"a": {"b": 1}')).toBeNull();
  });

  it("prefers a fenced JSON block and ignores trailing text after the fence", () => {
    const raw = '설명입니다.\n```json\n{"attributes": {"Might": 2}}\n```\n추가 설명 {진짜} 끝.';
    expect(JSON.parse(extractJsonObject(raw)!)).toEqual({ attributes: { Might: 2 } });
  });

  it("handles escaped quotes inside strings", () => {
    const raw = '{"say": "그는 \\"멈춰\\"라고 외쳤다 }"} trailing';
    expect(JSON.parse(extractJsonObject(raw)!)).toEqual({ say: '그는 "멈춰"라고 외쳤다 }' });
  });
});

describe("normalizeModelJson", () => {
  it("passes unextractable text through unchanged so parse errors stay honest", () => {
    expect(normalizeModelJson("no json here")).toBe("no json here");
    expect(normalizeModelJson('{"truncated": ')).toBe('{"truncated": ');
  });

  it("unwraps prose-wrapped objects for the strict parser", () => {
    expect(JSON.parse(normalizeModelJson('prose {"ok": true} more'))).toEqual({ ok: true });
  });
});
