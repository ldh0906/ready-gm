import { describe, expect, it } from "vitest";
import { fnv1a32, mulberry32, seededPick, seededShuffle } from "./seeded-random.js";

describe("seeded-random", () => {
  it("keeps the existing FNV-1a + mulberry32 sequence stable", () => {
    const random = mulberry32(fnv1a32("room:player"));

    expect([random(), random(), random()]).toEqual([
      0.005484995897859335,
      0.6297398218885064,
      0.1345235442277044,
    ]);
  });

  it("shuffles deterministically without mutating the input", () => {
    const items = ["a", "b", "c", "d", "e"];

    expect(seededShuffle(items, "seed-1")).toEqual(["a", "d", "b", "c", "e"]);
    expect(seededShuffle(items, "seed-1")).toEqual(["a", "d", "b", "c", "e"]);
    expect(items).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("picks a deterministic prefix of the seeded shuffle", () => {
    expect(seededPick(["a", "b", "c", "d", "e"], 3, "seed-1")).toEqual(["a", "d", "b"]);
    expect(seededPick(["a", "b"], 5, "seed-1")).toEqual(["a", "b"]);
    expect(seededPick(["a", "b"], 0, "seed-1")).toEqual([]);
  });
});
