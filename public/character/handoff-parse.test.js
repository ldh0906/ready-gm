// @ts-nocheck
/**
 * Property-based test for Character_Sheet_App handoff parsing / validation.
 * Feature: character-sheet
 *
 * Covers:
 * - Property 1: 인계 파싱과 검증, 무효 시 요청 차단
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseHandoff, isHandoffValid, reduce, createInitialState } from "./logic.js";

// 앞뒤에 붙을 수 있는 임의 공백(스페이스·탭·개행). 키 값이 공백만일 수도 있게 한다.
const wsGen = fc.stringOf(fc.constantFrom(" ", "\t", "\n", "\r"), { maxLength: 3 });

// 핵심 값(비어 있을 수 있음). 특수문자가 섞여도 URLSearchParams 인코딩으로 안전히 왕복한다.
const coreGen = fc.string({ maxLength: 10 });

// 앞뒤 공백이 붙은 값(공백만인 경우 포함).
const paddedValueGen = fc.tuple(wsGen, coreGen, wsGen).map(([a, b, c]) => a + b + c);

// 한 인계 키: 부재(undefined) 또는 앞뒤 공백이 붙은 값. nil로 키 부재 조합을 생성한다.
const fieldGen = fc.option(paddedValueGen, { nil: undefined });

// roomId·playerId·token 각각 부재/공백/값 조합.
const handoffFieldsGen = fc.record({
  roomId: fieldGen,
  playerId: fieldGen,
  token: fieldGen,
});

/**
 * 인계 필드 명세로 쿼리 문자열을 만든다. URLSearchParams로 인코딩하여
 * parseHandoff가 동일 문자열을 디코드해 트림하도록 한다(왕복 보존).
 */
function buildSearch(fields) {
  const params = new URLSearchParams();
  if (fields.roomId !== undefined) params.set("roomId", fields.roomId);
  if (fields.playerId !== undefined) params.set("playerId", fields.playerId);
  if (fields.token !== undefined) params.set("token", fields.token);
  const query = params.toString();
  return query ? "?" + query : "";
}

describe("character-sheet property tests — handoff parsing / validation", () => {
  it("Property 1: 인계 파싱과 검증, 무효 시 요청 차단", () => {
    // Feature: character-sheet, Property 1: 인계 파싱과 검증, 무효 시 요청 차단
    fc.assert(
      fc.property(handoffFieldsGen, (fields) => {
        const search = buildSearch(fields);
        const parsed = parseHandoff(search);

        // parseHandoff는 각 값을 트림한 결과로(부재 키는 빈 문자열로) 추출한다. (요구사항 1.1)
        const expectedRoomId = fields.roomId === undefined ? "" : fields.roomId.trim();
        const expectedPlayerId = fields.playerId === undefined ? "" : fields.playerId.trim();
        const expectedToken = fields.token === undefined ? "" : fields.token.trim();
        expect(parsed.roomId).toBe(expectedRoomId);
        expect(parsed.playerId).toBe(expectedPlayerId);
        expect(parsed.token).toBe(expectedToken);

        // isHandoffValid는 트림된 roomId·playerId가 둘 다 비어 있지 않을 때에만 true다. (요구사항 1.3)
        const expectedValid = expectedRoomId.length >= 1 && expectedPlayerId.length >= 1;
        expect(isHandoffValid(parsed)).toBe(expectedValid);

        // 인계를 HANDOFF_PARSED로 reduce 한다.
        const initial = createInitialState({ roomId: "", playerId: "", token: "" });
        const next = reduce(initial, { type: "HANDOFF_PARSED", handoff: parsed });
        expect(next.handoffValid).toBe(expectedValid);

        // 인계가 무효이면 어떤 요청 단계도 loading으로 진입하지 않는다. (요구사항 1.3)
        if (!expectedValid) {
          expect(next.schemaArea).not.toBe("loading");
          expect(next.proposal).not.toBe("loading");
          expect(next.record).not.toBe("loading");
          expect(next.confirm).not.toBe("loading");
        }
      }),
      { numRuns: 100 },
    );
  });
});
