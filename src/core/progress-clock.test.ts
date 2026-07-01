import { describe, it, expect } from "vitest";
import {
  advanceClock,
  clockRemaining,
  isClockComplete,
  makeClock,
} from "./progress-clock.js";

describe("makeClock", () => {
  it("normalizes max to >= 1 and clamps the initial value", () => {
    expect(makeClock({ id: "c", name: "n", scope: "scene", max: 0, onComplete: "x" }).max).toBe(1);
    expect(
      makeClock({ id: "c", name: "n", scope: "scene", max: 6, value: 99, onComplete: "x" }).value,
    ).toBe(6);
    expect(
      makeClock({ id: "c", name: "n", scope: "scene", max: 6, value: -5, onComplete: "x" }).value,
    ).toBe(0);
  });

  it("defaults value to 0 and truncates fractional inputs", () => {
    const clock = makeClock({ id: "c", name: "n", scope: "front", max: 8.9, value: 3.7, onComplete: "x" });
    expect(clock.value).toBe(3);
    expect(clock.max).toBe(8);
  });

  it("throws on a non-finite max", () => {
    expect(() => makeClock({ id: "c", name: "n", scope: "scene", max: NaN, onComplete: "x" })).toThrow();
  });

  it("carries an optional consequence and preserves it across advance", () => {
    const made = makeClock({ id: "c", name: "n", scope: "front", max: 4, value: 3, onComplete: "x", consequence: "봉인이 깨진다." });
    expect(made.consequence).toBe("봉인이 깨진다.");
    expect(advanceClock(made, 1).consequence).toBe("봉인이 깨진다.");
  });

  it("omits consequence when not provided", () => {
    const made = makeClock({ id: "c", name: "n", scope: "scene", max: 4, onComplete: "x" });
    expect(made.consequence).toBeUndefined();
  });
});

describe("advanceClock", () => {
  const base = makeClock({ id: "crypt_alert", name: "묘지 경계도", scope: "scene", max: 6, value: 2, onComplete: "skeleton_patrol_arrives" });

  it("advances by 1 by default and clamps at max", () => {
    expect(advanceClock(base).value).toBe(3);
    expect(advanceClock(base, 10).value).toBe(6);
  });

  it("rewinds with a negative delta, clamped at 0", () => {
    expect(advanceClock(base, -1).value).toBe(1);
    expect(advanceClock(base, -10).value).toBe(0);
  });

  it("does not mutate the input clock", () => {
    advanceClock(base, 3);
    expect(base.value).toBe(2);
  });

  it("treats a non-finite delta as 0", () => {
    expect(advanceClock(base, Number.POSITIVE_INFINITY).value).toBe(2);
  });
});

describe("isClockComplete / clockRemaining", () => {
  it("reports completion at or past max", () => {
    const clock = makeClock({ id: "c", name: "n", scope: "front", max: 4, value: 4, onComplete: "x" });
    expect(isClockComplete(clock)).toBe(true);
    expect(clockRemaining(clock)).toBe(0);
  });

  it("reports remaining segments before completion", () => {
    const clock = makeClock({ id: "c", name: "n", scope: "front", max: 8, value: 3, onComplete: "x" });
    expect(isClockComplete(clock)).toBe(false);
    expect(clockRemaining(clock)).toBe(5);
  });
});
