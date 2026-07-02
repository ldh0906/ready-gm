// @ts-nocheck
/**
 * Unit tests for Game_Play_App player-visible character state view model
 * (Living Character Sheet surfacing).
 *
 * Covers:
 * - createInitialState starts with an empty characterStates list
 * - reduce(TURN_STATE) absorbs turn_state.characterStates and preserves the
 *   prior snapshot when a turn_state carries none (reconnect resync included)
 * - describeCharacterState normalizes conditions/inventory/resources/personal
 *   clocks against malformed payloads
 */
import { describe, it, expect } from "vitest";
import { reduce, describeCharacterState, createInitialState } from "./logic.js";

const handoff = { roomId: "r1", hostPlayerId: "h1", token: "" };

const visibleState = () => ({
  characterId: "c1",
  name: "고블린 사냥꾼",
  conditions: [{ name: "부상", severity: 2 }],
  inventory: [{ name: "밧줄", tags: ["도구"] }],
  resources: { 기력: 3 },
  personalClocks: [{ id: "curse", name: "저주", value: 1, max: 4 }],
});

describe("game-play character states — reduce(TURN_STATE)", () => {
  it("starts with an empty character state list", () => {
    expect(createInitialState(handoff).characterStates).toEqual([]);
  });

  it("absorbs characterStates carried on a turn_state", () => {
    const s0 = createInitialState(handoff);
    const s1 = reduce(s0, {
      type: "TURN_STATE",
      state: { roundNumber: 1, phase: "free_chat", characterStates: [visibleState()] },
    });
    expect(s1.characterStates).toEqual([visibleState()]);
  });

  it("preserves the prior snapshot when a turn_state carries none", () => {
    const s0 = createInitialState(handoff);
    const s1 = reduce(s0, {
      type: "TURN_STATE",
      state: { roundNumber: 1, phase: "free_chat", characterStates: [visibleState()] },
    });
    const s2 = reduce(s1, { type: "TURN_STATE", state: { roundNumber: 2, phase: "ready_check" } });
    expect(s2.characterStates).toEqual([visibleState()]);
  });
});

describe("game-play character states — describeCharacterState", () => {
  it("passes through a well-formed visible state", () => {
    const described = describeCharacterState(visibleState());
    expect(described).toEqual({
      characterId: "c1",
      name: "고블린 사냥꾼",
      conditions: [{ name: "부상", severity: 2 }],
      inventory: [{ name: "밧줄", tags: ["도구"] }],
      resources: [{ key: "기력", value: 3 }],
      personalClocks: [{ name: "저주", value: 1, max: 4 }],
    });
  });

  it("normalizes malformed payloads without throwing", () => {
    const described = describeCharacterState({
      characterId: 42,
      name: null,
      conditions: [{ name: "  " }, { name: "탈진", severity: "no" }, null],
      inventory: [{ name: "", tags: "notags" }, { name: "칼" }],
      resources: { 기력: "많이", 행운: 2, "": 1 },
      personalClocks: [{ name: "저주", value: 99, max: 4 }, { name: "", max: 3 }],
    });
    expect(described.characterId).toBe("42");
    expect(described.name).toBe("");
    expect(described.conditions).toEqual([{ name: "탈진", severity: null }]);
    expect(described.inventory).toEqual([{ name: "칼", tags: [] }]);
    expect(described.resources).toEqual([{ key: "행운", value: 2 }]);
    expect(described.personalClocks).toEqual([{ name: "저주", value: 4, max: 4 }]);
  });

  it("returns empty collections for a non-object input", () => {
    const described = describeCharacterState(undefined);
    expect(described.conditions).toEqual([]);
    expect(described.inventory).toEqual([]);
    expect(described.resources).toEqual([]);
    expect(described.personalClocks).toEqual([]);
  });
});
