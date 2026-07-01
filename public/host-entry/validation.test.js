// @ts-nocheck
/**
 * Property-based tests for Host_Entry_App validation / submit logic.
 * Feature: frontend-applications
 *
 * Covers:
 * - Property 1: 공백 표시 이름은 거부되고 요청을 보내지 않는다
 * - Property 2: 유효 제출은 트림된 이름을 전송하고 원본 입력을 보존한다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  createInitialState,
  reduce,
  validateDisplayName,
  buildCreateRoomRequest,
  Phase,
  VALIDATION_MESSAGE,
} from "./logic.js";

// 다양한 공백 문자(스페이스/탭/개행/캐리지리턴/폼피드/세로탭/전각 공백 U+3000/NBSP).
const wsChar = fc.constantFrom(" ", "\t", "\n", "\r", "\f", "\v", "\u3000", "\u00a0");
// 빈 문자열도 포함되도록 minLength 미지정(기본 0).
const whitespaceOnly = fc.stringOf(wsChar);

// 트림 후에도 살아남는 비공백 문자(한글/비-ASCII/이모지/기호 포함).
const nonWsChar = fc.constantFrom(
  "a", "b", "Z", "9", "_", "-", "#",
  "가", "나", "힣", "한", "글",
  "é", "ü", "π", "😀",
);
const nonWsCore = fc.stringOf(nonWsChar, { minLength: 1 });
const token = fc.string();

describe("frontend-applications property tests — validation & submit", () => {
  it("Property 1: 공백 표시 이름은 거부되고 요청을 보내지 않는다", () => {
    // Feature: frontend-applications, Property 1: 공백 표시 이름은 거부되고 요청을 보내지 않는다
    fc.assert(
      fc.property(whitespaceOnly, token, (ws, tok) => {
        const state = { ...createInitialState(tok), displayNameInput: ws };
        const next = reduce(state, { type: "SUBMIT" });

        // 요청 미발송: phase가 submitting으로 바뀌지 않고 그대로 유지된다.
        expect(next.phase).not.toBe(Phase.SUBMITTING);
        expect(next.phase).toBe(state.phase);
        // 입력값 보존.
        expect(next.displayNameInput).toBe(ws);
        // 입력 인접 검증 안내 메시지가 설정된다(non-null).
        expect(next.validationMessage).not.toBeNull();
        expect(next.validationMessage).toBe(VALIDATION_MESSAGE);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 2: 유효 제출은 트림된 이름을 전송하고 원본 입력을 보존한다", () => {
    // Feature: frontend-applications, Property 2: 유효 제출은 트림된 이름을 전송하고 원본 입력을 보존한다
    fc.assert(
      fc.property(whitespaceOnly, nonWsCore, whitespaceOnly, token, (lead, core, trail, tok) => {
        const raw = lead + core + trail; // 앞뒤 임의 공백 + 트림 후 1자 이상인 본문.

        // 트림 결과는 정확히 본문(core)과 같다.
        const { valid, trimmed } = validateDisplayName(raw);
        expect(valid).toBe(true);
        expect(trimmed).toBe(core);

        // 요청 바디의 displayName은 트림된 값과 정확히 일치한다.
        const req = buildCreateRoomRequest(trimmed, tok);
        const body = JSON.parse(req.body);
        expect(body.displayName).toBe(trimmed);

        // 유효 제출을 reduce 해도 원본 입력값(raw)은 그대로 보존된다.
        const state = { ...createInitialState(tok), displayNameInput: raw };
        const next = reduce(state, { type: "SUBMIT" });
        expect(next.phase).toBe(Phase.SUBMITTING);
        expect(next.displayNameInput).toBe(raw);
      }),
      { numRuns: 100 },
    );
  });
});
