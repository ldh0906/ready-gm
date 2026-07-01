// @ts-nocheck
/**
 * Unit tests for scenario-character-cards dealt-hand support in logic.js.
 * Feature: scenario-character-cards
 *
 * Covers:
 * - buildCardsRequest: URL/method/headers shape (with/without token)
 * - parseCardHand: valid array, blank/missing ids filtered, non-array → []
 * - reduce CARD_HAND_RESOLVED: replaces characterCards, new schema identity,
 *   clears stale selectedCardId, keeps valid selection, no-op for non-card schema
 * - reduce CONFIRM_RESULT "CARD_TAKEN": not confirmed, CARD_TAKEN notice, inputs preserved
 */
import { describe, it, expect } from "vitest";
import {
  buildCardsRequest,
  parseCardHand,
  reduce,
  createInitialState,
  RecordRejection,
  RECORD_REJECTION_MESSAGES,
} from "./logic.js";

/** 카드 기반 활성 스키마를 가진 상태를 만든다(초기 상태 위에 덮어쓴다). */
function cardBasedState(overrides = {}) {
  const base = createInitialState({ roomId: "r1", playerId: "p1", token: "t", ticket: "" });
  return {
    ...base,
    activeSchema: {
      sections: [{ id: "narrative", label: "서사" }],
      narrativeFields: [
        { id: "name", label: "이름", guidance: "", sectionId: "narrative", maxLength: 100 },
      ],
      traits: [],
      characterCards: [
        { id: "c1", roleLabel: "전사", premise: "p1" },
        { id: "c2", roleLabel: "마법사", premise: "p2" },
        { id: "c3", roleLabel: "도적", premise: "p3" },
      ],
    },
    ...overrides,
  };
}

describe("buildCardsRequest", () => {
  it("토큰이 있으면 x-playtest-token 헤더를 싣고 올바른 URL/메서드를 만든다", () => {
    const req = buildCardsRequest("r1", "p1", "secret");
    expect(req).toEqual({
      url: "/rooms/r1/players/p1/cards",
      method: "GET",
      headers: { "x-playtest-token": "secret" },
    });
  });

  it("토큰이 비어 있으면 헤더를 싣지 않는다", () => {
    const req = buildCardsRequest("r1", "p1", "");
    expect(req.headers).toEqual({});
    expect(req.method).toBe("GET");
  });

  it("roomId·playerId를 URL 인코딩한다", () => {
    const req = buildCardsRequest("a/b", "p q", "");
    expect(req.url).toBe("/rooms/a%2Fb/players/p%20q/cards");
  });
});

describe("parseCardHand", () => {
  it("유효한 카드 배열을 정규화해 반환한다(premise·backstoryGuidance 보존)", () => {
    const cards = parseCardHand({
      cards: [
        { id: "c1", roleLabel: "전사", premise: "용감함", backstoryGuidance: "배경" },
        { id: "c2", roleLabel: "마법사", premise: "" },
      ],
    });
    expect(cards).toEqual([
      { id: "c1", roleLabel: "전사", premise: "용감함", backstoryGuidance: "배경" },
      { id: "c2", roleLabel: "마법사", premise: "" },
    ]);
  });

  it("id·roleLabel이 비었거나(공백) 누락된 원소는 방어적으로 걸러낸다", () => {
    const cards = parseCardHand({
      cards: [
        { id: "  ", roleLabel: "전사", premise: "" },
        { id: "c2", roleLabel: "   ", premise: "" },
        { roleLabel: "마법사", premise: "" },
        { id: "c4", premise: "" },
        null,
        "nope",
        { id: "ok", roleLabel: "도적", premise: "" },
      ],
    });
    expect(cards).toEqual([{ id: "ok", roleLabel: "도적", premise: "" }]);
  });

  it("cards가 배열이 아니거나 본문이 무효이면 빈 배열을 반환한다(절대 던지지 않음)", () => {
    expect(parseCardHand({ cards: [] })).toEqual([]);
    expect(parseCardHand({ cards: "x" })).toEqual([]);
    expect(parseCardHand({})).toEqual([]);
    expect(parseCardHand(null)).toEqual([]);
    expect(parseCardHand(undefined)).toEqual([]);
    expect(parseCardHand(42)).toEqual([]);
  });
});

describe("reduce CARD_HAND_RESOLVED", () => {
  it("characterCards를 분배 손패로 교체하고 새 스키마 객체 정체성을 갖는다", () => {
    const state = cardBasedState();
    const hand = [
      { id: "h1", roleLabel: "사제", premise: "" },
      { id: "h2", roleLabel: "궁수", premise: "" },
      { id: "h3", roleLabel: "기사", premise: "" },
    ];
    const next = reduce(state, { type: "CARD_HAND_RESOLVED", cards: hand });
    expect(next.activeSchema).not.toBe(state.activeSchema);
    expect(next.activeSchema.characterCards).toEqual(hand);
    // 나머지 스키마 속성은 보존된다.
    expect(next.activeSchema.narrativeFields).toBe(state.activeSchema.narrativeFields);
  });

  it("selectedCardId가 새 손패에 없으면 null로 비운다", () => {
    const state = cardBasedState({ selectedCardId: "c2" });
    const hand = [
      { id: "h1", roleLabel: "사제", premise: "" },
      { id: "h2", roleLabel: "궁수", premise: "" },
    ];
    const next = reduce(state, { type: "CARD_HAND_RESOLVED", cards: hand });
    expect(next.selectedCardId).toBeNull();
  });

  it("selectedCardId가 새 손패에 있으면 유지한다", () => {
    const state = cardBasedState({ selectedCardId: "h2" });
    const hand = [
      { id: "h1", roleLabel: "사제", premise: "" },
      { id: "h2", roleLabel: "궁수", premise: "" },
    ];
    const next = reduce(state, { type: "CARD_HAND_RESOLVED", cards: hand });
    expect(next.selectedCardId).toBe("h2");
  });

  it("카드 기반이 아닌 스키마에서는 무변화(no-op)다", () => {
    const base = createInitialState({ roomId: "r1", playerId: "p1", token: "t", ticket: "" });
    // 기본 스키마는 characterCards가 빈 배열 → 카드 기반 아님.
    const next = reduce(base, {
      type: "CARD_HAND_RESOLVED",
      cards: [{ id: "h1", roleLabel: "사제", premise: "" }],
    });
    expect(next).toBe(base);
  });

  it("다른 상태(narrativeValues 등)는 보존한다", () => {
    const state = cardBasedState({ narrativeValues: { name: "용사" } });
    const next = reduce(state, {
      type: "CARD_HAND_RESOLVED",
      cards: [{ id: "h1", roleLabel: "사제", premise: "" }],
    });
    expect(next.narrativeValues).toEqual({ name: "용사" });
  });
});

describe("reduce CONFIRM_RESULT CARD_TAKEN", () => {
  it("확정되지 않고 CARD_TAKEN 안내를 표시하며 입력을 보존한다", () => {
    const state = cardBasedState({
      selectedCardId: "c2",
      narrativeValues: { name: "용사" },
      confirmed: false,
    });
    const next = reduce(state, { type: "CONFIRM_RESULT", result: RecordRejection.CARD_TAKEN });
    expect(next.confirmed).toBe(false);
    expect(next.notice).toBe(RECORD_REJECTION_MESSAGES.CARD_TAKEN);
    expect(next.narrativeValues).toEqual({ name: "용사" });
    // 선택은 reduce 단계에서 보존된다(후속 doCards가 손패 갱신 시 비운다).
    expect(next.selectedCardId).toBe("c2");
  });
});
