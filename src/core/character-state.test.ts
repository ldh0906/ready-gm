import { describe, expect, it } from "vitest";
import {
  applyCharacterDeltas,
  makeCharacterState,
  toVisibleCharacterState,
  type CharacterDelta,
} from "./character-state.js";

describe("Character State", () => {
  it("normalizes optional state collections", () => {
    const state = makeCharacterState({
      characterId: "char-1",
      resources: { focus: 2 },
    });

    expect(state.conditions).toEqual([]);
    expect(state.inventory).toEqual([]);
    expect(state.resources).toEqual({ focus: 2 });
    expect(state.relationships).toEqual({});
    expect(state.personalClocks).toEqual([]);
    expect(state.memories).toEqual([]);
    expect(state.flags).toEqual({});
  });

  it("applies valid character deltas without mutating the input states", () => {
    const states = [
      makeCharacterState({
        characterId: "char-1",
        resources: { focus: 2 },
      }),
    ];
    const deltas: CharacterDelta[] = [
      { type: "add_condition", characterId: "char-1", condition: "겁에 질림", severity: 2, reason: "공포 장면" },
      { type: "add_inventory", characterId: "char-1", item: "녹슨 열쇠", tags: ["key"], reason: "상자 발견" },
      { type: "spend_resource", characterId: "char-1", resource: "focus", amount: 1, reason: "집중 소모" },
      { type: "add_memory", characterId: "char-1", text: "벽화 뒤에서 아이의 이름을 들었다.", salience: 3, reason: "단서" },
    ];

    const result = applyCharacterDeltas(states, deltas);

    expect(result.rejected).toEqual([]);
    expect(result.applied).toEqual(deltas);
    expect(states[0]?.conditions).toEqual([]);
    const updated = result.states[0]!;
    expect(updated.conditions).toEqual([{ name: "겁에 질림", severity: 2, reason: "공포 장면" }]);
    expect(updated.inventory).toEqual([{ name: "녹슨 열쇠", tags: ["key"], reason: "상자 발견" }]);
    expect(updated.resources.focus).toBe(1);
    expect(updated.memories).toEqual([{ text: "벽화 뒤에서 아이의 이름을 들었다.", salience: 3, reason: "단서" }]);
  });

  it("rejects deltas for unknown characters and invalid resource spends", () => {
    const states = [makeCharacterState({ characterId: "char-1", resources: { focus: 1 } })];
    const deltas: CharacterDelta[] = [
      { type: "add_condition", characterId: "ghost", condition: "부상", reason: "없는 캐릭터" },
      { type: "spend_resource", characterId: "char-1", resource: "focus", amount: 2, reason: "과소비" },
      { type: "spend_resource", characterId: "char-1", resource: "focus", amount: 0, reason: "무효" },
    ];

    const result = applyCharacterDeltas(states, deltas);

    expect(result.applied).toEqual([]);
    expect(result.rejected.map((entry) => entry.reason)).toEqual([
      "UNKNOWN_CHARACTER",
      "INSUFFICIENT_RESOURCE",
      "INVALID_AMOUNT",
    ]);
    expect(result.states[0]?.resources.focus).toBe(1);
  });

  it("updates relationships and advances personal clocks within bounds", () => {
    const states = [
      makeCharacterState({
        characterId: "char-1",
        relationships: { npc_1: { targetId: "npc_1", attitude: "wary", reason: "첫 만남" } },
        personalClocks: [{ id: "fear", name: "공포", value: 1, max: 3 }],
      }),
    ];

    const result = applyCharacterDeltas(states, [
      { type: "update_relationship", characterId: "char-1", targetId: "npc_1", attitude: "hostile", reason: "거짓말 발각" },
      { type: "advance_personal_clock", characterId: "char-1", clockId: "fear", ticks: 5, reason: "공포 고조" },
    ]);

    expect(result.rejected).toEqual([]);
    expect(result.states[0]?.relationships.npc_1).toEqual({
      targetId: "npc_1",
      attitude: "hostile",
      reason: "거짓말 발각",
    });
    expect(result.states[0]?.personalClocks[0]?.value).toBe(3);
  });

  describe("toVisibleCharacterState (player-visible projection)", () => {
    const fullState = () =>
      makeCharacterState({
        characterId: "char-1",
        conditions: [{ name: "부상", severity: 2, reason: "낙석" }],
        inventory: [{ name: "밧줄", tags: ["도구"], reason: "습득" }],
        resources: { 기력: 3 },
        relationships: { npc_1: { targetId: "npc_1", attitude: "hostile", reason: "배신" } },
        personalClocks: [{ id: "curse", name: "저주", value: 1, max: 4 }],
        memories: [{ text: "GM만 아는 비밀", salience: 5, reason: "은닉" }],
        flags: { marked: true },
      });

    it("includes conditions/inventory/resources/personal clocks and the display name", () => {
      const visible = toVisibleCharacterState(fullState(), "고블린 사냥꾼");
      expect(visible).toEqual({
        characterId: "char-1",
        name: "고블린 사냥꾼",
        conditions: [{ name: "부상", severity: 2 }],
        inventory: [{ name: "밧줄", tags: ["도구"] }],
        resources: { 기력: 3 },
        personalClocks: [{ id: "curse", name: "저주", value: 1, max: 4 }],
      });
    });

    it("excludes GM-only material: memories, flags, relationships, and reasons", () => {
      const visible = toVisibleCharacterState(fullState(), "x");
      const serialized = JSON.stringify(visible);
      expect(serialized).not.toContain("비밀");
      expect(serialized).not.toContain("marked");
      expect(serialized).not.toContain("hostile");
      expect(serialized).not.toContain("reason");
    });

    it("shares no references with the source state", () => {
      const source = fullState();
      const visible = toVisibleCharacterState(source, "x");
      visible.resources["기력"] = 99;
      visible.inventory[0]?.tags.push("mutated");
      visible.personalClocks[0]!.value = 4;
      expect(source.resources["기력"]).toBe(3);
      expect(source.inventory[0]?.tags).toEqual(["도구"]);
      expect(source.personalClocks[0]?.value).toBe(1);
    });
  });
});
