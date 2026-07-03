import { describe, expect, it } from "vitest";
import {
  deriveRoundMemories,
  selectMemoryContext,
  validateMemoryWrite,
  type MemoryRecord,
} from "./memory-record.js";

function record(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: "mem-1",
    roomId: "room-1",
    kind: "player_choice",
    summary: "요약",
    salience: 0.5,
    visibility: "player_visible",
    sourceEventIds: ["round-1"],
    ...overrides,
  };
}

describe("validateMemoryWrite — fail-closed memory write validation", () => {
  it("accepts a well-formed write and trims the summary", () => {
    const result = validateMemoryWrite({
      kind: "npc_change",
      summary: "  사제가 파티를 경계하기 시작했다  ",
      salience: 0.7,
      visibility: "gm_only",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.summary).toBe("사제가 파티를 경계하기 시작했다");
    }
  });

  it("rejects unknown kinds", () => {
    const result = validateMemoryWrite({
      kind: "raw_transcript",
      summary: "x",
      salience: 0.5,
      visibility: "gm_only",
    });
    expect(result).toEqual({ ok: false, reason: "UNKNOWN_KIND" });
  });

  it("rejects out-of-range or non-finite salience", () => {
    for (const salience of [-0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = validateMemoryWrite({
        kind: "tone_note",
        summary: "x",
        salience,
        visibility: "gm_only",
      });
      expect(result).toEqual({ ok: false, reason: "INVALID_SALIENCE" });
    }
  });

  it("rejects invalid visibility and empty or transcript-sized summaries", () => {
    expect(
      validateMemoryWrite({ kind: "tone_note", summary: "x", salience: 0.5, visibility: "public" }),
    ).toEqual({ ok: false, reason: "INVALID_VISIBILITY" });
    expect(
      validateMemoryWrite({ kind: "tone_note", summary: "  ", salience: 0.5, visibility: "gm_only" }),
    ).toEqual({ ok: false, reason: "INVALID_SUMMARY" });
    expect(
      validateMemoryWrite({
        kind: "tone_note",
        summary: "x".repeat(301),
        salience: 0.5,
        visibility: "gm_only",
      }),
    ).toEqual({ ok: false, reason: "INVALID_SUMMARY" });
  });

  it("rejects non-object writes", () => {
    expect(validateMemoryWrite("remember this")).toEqual({ ok: false, reason: "INVALID_WRITE" });
  });
});

describe("deriveRoundMemories — deterministic per-round Memory Clerk", () => {
  it("derives discovered-clue, npc-change, player-choice and safety records", () => {
    const records = deriveRoundMemories({
      roomId: "room-1",
      roundNumber: 3,
      appliedBlackboardDeltas: [
        { type: "reveal_clue", clueId: "small_footprints", reason: "조사 성공" },
        { type: "npc_reveal", npcId: "npc_priest", reason: "예배당에 등장" },
        { type: "npc_location", npcId: "npc_priest", location: "chapel", reason: "도주" },
      ],
      confirmedActions: [{ characterName: "Ada", actionText: "문양을 조사한다" }],
      safetyFlags: ["고어 수위 낮춰달라"],
    });

    expect(records.map((r) => r.kind)).toEqual([
      "discovered_clue",
      "npc_change",
      "npc_change",
      "player_choice",
      "safety_preference",
    ]);
    // Safety signals outrank everything; clues outrank NPC changes and choices.
    const byKind = new Map(records.map((r) => [r.kind, r]));
    expect(byKind.get("safety_preference")!.salience).toBeGreaterThan(
      byKind.get("discovered_clue")!.salience,
    );
    expect(byKind.get("discovered_clue")!.visibility).toBe("player_visible");
    expect(byKind.get("npc_change")!.visibility).toBe("gm_only");
    expect(records.every((r) => r.sourceEventIds.includes("round-3"))).toBe(true);
  });

  it("derives nothing from an empty round", () => {
    expect(deriveRoundMemories({ roomId: "room-1", roundNumber: 1 })).toEqual([]);
  });
});

describe("selectMemoryContext — salience-ordered budget guard", () => {
  it("selects the highest-salience records under the record budget", () => {
    const records = [
      record({ id: "a", salience: 0.2, summary: "낮음" }),
      record({ id: "b", salience: 0.9, summary: "높음" }),
      record({ id: "c", salience: 0.6, summary: "중간" }),
    ];
    const selected = selectMemoryContext(records, { maxRecords: 2, maxChars: 1000 });
    expect(selected.map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("drops duplicates, expired records, and respects the char budget", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const records = [
      record({ id: "dup-1", salience: 0.9, summary: "같은 요약" }),
      record({ id: "dup-2", salience: 0.8, summary: "같은 요약" }),
      record({ id: "expired", salience: 0.95, summary: "만료됨", expiresAt: past }),
      record({ id: "long", salience: 0.7, summary: "긴 요약 ".repeat(50) }),
      record({ id: "short", salience: 0.6, summary: "짧은 요약" }),
    ];
    const selected = selectMemoryContext(records, { maxRecords: 5, maxChars: 20 });
    expect(selected.map((r) => r.id)).toEqual(["dup-1", "short"]);
  });
});
