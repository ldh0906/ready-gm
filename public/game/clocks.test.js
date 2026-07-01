// @ts-nocheck
/**
 * Unit tests for Game_Play_App Progress Clock view model.
 * Feature: game-play (clock gauge surfacing)
 *
 * Covers:
 * - eventToAction passes narration.clocks through (and omits when absent)
 * - reduce(NARRATION) stores the latest clock snapshot, preserving prior when absent
 * - describeClock normalizes/clamps value and max against malformed payloads
 */
import { describe, it, expect } from "vitest";
import { eventToAction, reduce, describeClock, createInitialState } from "./logic.js";

const handoff = { roomId: "r1", hostPlayerId: "h1", token: "" };

describe("game-play clocks — eventToAction", () => {
  it("passes narration.clocks through when present", () => {
    const action = eventToAction({
      type: "narration",
      narration: { kind: "resolution", roundNumber: 2, text: "t", clocks: [{ name: "경계", value: 2, max: 6 }] },
    });
    expect(action.clocks).toEqual([{ name: "경계", value: 2, max: 6 }]);
  });

  it("leaves clocks undefined when the payload has none", () => {
    const action = eventToAction({
      type: "narration",
      narration: { kind: "resolution", roundNumber: 2, text: "t" },
    });
    expect(action.clocks).toBeUndefined();
  });
});

describe("game-play clocks — reduce(NARRATION)", () => {
  it("stores the latest clock snapshot", () => {
    const s0 = createInitialState(handoff);
    const s1 = reduce(s0, {
      type: "NARRATION",
      kind: "resolution",
      roundNumber: 1,
      text: "t",
      clocks: [{ name: "경계", value: 3, max: 6 }],
    });
    expect(s1.clocks).toEqual([{ name: "경계", value: 3, max: 6 }]);
  });

  it("preserves prior clocks when a narration carries none", () => {
    const s0 = createInitialState(handoff);
    const s1 = reduce(s0, { type: "NARRATION", kind: "resolution", roundNumber: 1, text: "t", clocks: [{ name: "경계", value: 3, max: 6 }] });
    const s2 = reduce(s1, { type: "NARRATION", kind: "resolution", roundNumber: 2, text: "u" });
    expect(s2.clocks).toEqual([{ name: "경계", value: 3, max: 6 }]);
  });

  it("starts with an empty clock list", () => {
    expect(createInitialState(handoff).clocks).toEqual([]);
  });
});

describe("game-play clocks — describeClock", () => {
  it("passes through a well-formed clock", () => {
    expect(describeClock({ name: "경계", value: 2, max: 6 })).toEqual({ name: "경계", value: 2, max: 6 });
  });

  it("clamps value into [0, max] and truncates", () => {
    expect(describeClock({ name: "x", value: 99, max: 6 })).toEqual({ name: "x", value: 6, max: 6 });
    expect(describeClock({ name: "x", value: -5, max: 6 })).toEqual({ name: "x", value: 0, max: 6 });
    expect(describeClock({ name: "x", value: 3.9, max: 6 })).toEqual({ name: "x", value: 3, max: 6 });
  });

  it("normalizes a non-positive or non-finite max to 0", () => {
    expect(describeClock({ name: "x", value: 1, max: 0 })).toEqual({ name: "x", value: 0, max: 0 });
    expect(describeClock({ name: "x", value: 1, max: NaN })).toEqual({ name: "x", value: 0, max: 0 });
  });

  it("coerces a missing name to an empty string", () => {
    expect(describeClock({ value: 1, max: 4 }).name).toBe("");
  });
});
