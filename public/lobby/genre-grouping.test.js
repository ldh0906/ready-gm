// @ts-nocheck
/**
 * Unit + property tests for Room_Lobby_App genre taxonomy / grouping.
 * Feature: room-lobby (custom scenario combobox — genre ordering)
 *
 * Covers the pure functions in logic.js:
 * - scenarioGenreGroupId: keyword substring match across genre/category, fallback to "other"
 * - groupScenariosByGenre: canonical group order, similar genres adjacent, empty groups omitted,
 *   stable within-group order, non-array → []
 * - scenarioMetaSegments: non-empty segments in fixed order
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  GENRE_GROUPS,
  GENRE_OTHER_GROUP,
  scenarioGenreGroupId,
  groupScenariosByGenre,
  scenarioMetaSegments,
} from "./logic.js";

describe("room-lobby — scenarioGenreGroupId", () => {
  it("matches a keyword in the genre string (substring) → that group id", () => {
    expect(scenarioGenreGroupId({ genre: "하이 판타지", category: "" })).toBe("fantasy");
    expect(scenarioGenreGroupId({ genre: "코즈믹 호러", category: "" })).toBe("mystery");
    expect(scenarioGenreGroupId({ genre: "로맨틱 코미디", category: "" })).toBe("comedy");
  });

  it("matches a keyword in the category string when genre does not match", () => {
    expect(scenarioGenreGroupId({ genre: "드라마", category: "던전 탐험" })).toBe("fantasy");
    expect(scenarioGenreGroupId({ genre: "현대극", category: "사건 수사" })).toBe("mystery");
  });

  it("evaluates groups in canonical order (first matching group wins)", () => {
    // "모험"(fantasy) appears before "추리"(mystery) is checked → fantasy wins
    // because fantasy is the earlier group in GENRE_GROUPS.
    expect(scenarioGenreGroupId({ genre: "모험 추리", category: "" })).toBe("fantasy");
  });

  it("falls back to 'other' when no keyword matches", () => {
    expect(scenarioGenreGroupId({ genre: "로맨스", category: "일상" })).toBe("other");
    expect(scenarioGenreGroupId({ genre: "", category: "" })).toBe("other");
  });

  it("never throws on bad input and returns 'other'", () => {
    expect(scenarioGenreGroupId(null)).toBe("other");
    expect(scenarioGenreGroupId(undefined)).toBe("other");
    expect(scenarioGenreGroupId(42)).toBe("other");
    expect(scenarioGenreGroupId({})).toBe("other");
    expect(scenarioGenreGroupId({ genre: 123, category: [] })).toBe("other");
  });
});

describe("room-lobby — groupScenariosByGenre", () => {
  it("non-array input → []", () => {
    expect(groupScenariosByGenre(null)).toEqual([]);
    expect(groupScenariosByGenre(undefined)).toEqual([]);
    expect(groupScenariosByGenre("nope")).toEqual([]);
    expect(groupScenariosByGenre({})).toEqual([]);
  });

  it("empty list → []", () => {
    expect(groupScenariosByGenre([])).toEqual([]);
  });

  it("groups scenarios and omits empty groups, only mystery present", () => {
    const scns = [
      { id: "a", genre: "호러" },
      { id: "b", genre: "미스터리" },
    ];
    const groups = groupScenariosByGenre(scns);
    expect(groups.map((g) => g.id)).toEqual(["mystery"]);
    expect(groups[0].label).toBe("호러·미스터리");
    expect(groups[0].description).toBe("불안과 수수께끼 속에서 단서를 좇는 이야기.");
    expect(groups[0].scenarios.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("orders groups canonically (fantasy → mystery → comedy → other) regardless of input order", () => {
    const scns = [
      { id: "c1", genre: "코미디" },
      { id: "o1", genre: "로맨스" },
      { id: "m1", genre: "호러" },
      { id: "f1", genre: "판타지" },
    ];
    const groups = groupScenariosByGenre(scns);
    expect(groups.map((g) => g.id)).toEqual(["fantasy", "mystery", "comedy", "other"]);
  });

  it("keeps similar genres adjacent: two fantasy scenarios cluster together even if interleaved in input", () => {
    const scns = [
      { id: "f1", genre: "판타지" },
      { id: "m1", genre: "미스터리" },
      { id: "f2", genre: "던전" },
    ];
    const groups = groupScenariosByGenre(scns);
    const flatIds = groups.flatMap((g) => g.scenarios.map((s) => s.id));
    // f1 and f2 are adjacent in the flattened order (same fantasy group).
    expect(flatIds).toEqual(["f1", "f2", "m1"]);
  });

  it("preserves stable input (catalog) order within a group", () => {
    const scns = [
      { id: "f1", genre: "판타지" },
      { id: "f2", genre: "판타지" },
      { id: "f3", genre: "판타지" },
    ];
    const groups = groupScenariosByGenre(scns);
    expect(groups[0].scenarios.map((s) => s.id)).toEqual(["f1", "f2", "f3"]);
  });

  it("routes unmatched scenarios to the 'other' group last", () => {
    const scns = [
      { id: "o1", genre: "로맨스" },
      { id: "f1", genre: "판타지" },
    ];
    const groups = groupScenariosByGenre(scns);
    expect(groups.map((g) => g.id)).toEqual(["fantasy", "other"]);
    const other = groups.find((g) => g.id === "other");
    expect(other.label).toBe(GENRE_OTHER_GROUP.label);
    expect(other.description).toBe(GENRE_OTHER_GROUP.description);
    expect(other.scenarios.map((s) => s.id)).toEqual(["o1"]);
  });

  it("property: output groups are always a subset of canonical order, never empty, and preserve count", () => {
    const canonicalOrder = [...GENRE_GROUPS.map((g) => g.id), GENRE_OTHER_GROUP.id];
    const scenarioGen = fc.record({
      id: fc.string(),
      genre: fc.oneof(fc.constantFrom("판타지", "호러", "코미디", "로맨스", ""), fc.string()),
      category: fc.oneof(fc.constantFrom("던전", "수사", "소동", ""), fc.string()),
    });
    fc.assert(
      fc.property(fc.array(scenarioGen), (scns) => {
        const groups = groupScenariosByGenre(scns);
        // Every group has ≥1 scenario.
        for (const g of groups) expect(g.scenarios.length).toBeGreaterThanOrEqual(1);
        // Group ids appear in canonical order (monotonic indices).
        const idxs = groups.map((g) => canonicalOrder.indexOf(g.id));
        const sorted = [...idxs].sort((a, b) => a - b);
        expect(idxs).toEqual(sorted);
        // Total scenarios preserved.
        const total = groups.reduce((n, g) => n + g.scenarios.length, 0);
        expect(total).toBe(scns.length);
      }),
    );
  });
});

describe("room-lobby — scenarioMetaSegments", () => {
  it("returns non-empty segments in fixed order", () => {
    expect(
      scenarioMetaSegments({ genre: "판타지", category: "탐험", system: "d20", form: "원샷" }),
    ).toEqual(["장르: 판타지", "구성요소: 탐험", "시스템: d20", "형식: 원샷"]);
  });

  it("omits empty/whitespace segments", () => {
    expect(scenarioMetaSegments({ genre: "미스터리", category: "", system: "  ", form: "" })).toEqual([
      "장르: 미스터리",
    ]);
  });

  it("non-object input → []", () => {
    expect(scenarioMetaSegments(null)).toEqual([]);
    expect(scenarioMetaSegments(undefined)).toEqual([]);
    expect(scenarioMetaSegments("x")).toEqual([]);
  });
});
