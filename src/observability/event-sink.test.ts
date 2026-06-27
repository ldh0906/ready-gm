import { describe, it, expect } from "vitest";
import {
  buildEnvelope,
  makeDiceRollEvent,
  makeStateMutationEvent,
  makeAiCallEvent,
  makeRoundTimingEvent,
  makeAiOutputEvent,
  type EnvelopeGenerators,
  type QaEvent,
} from "./events.js";
import { NoopEventSink, InMemoryEventSink, type EventSink } from "./event-sink.js";

/** Deterministic generators: incrementing ids and a fixed clock base. */
function fixedGenerators(idPrefix = "evt", baseMs = 1_000): EnvelopeGenerators {
  let n = 0;
  let t = baseMs;
  return {
    generateId: () => `${idPrefix}-${n++}`,
    now: () => new Date(t++),
  };
}

describe("event envelope", () => {
  it("populates the full correlation envelope from injectable generators", () => {
    const env = buildEnvelope({ sessionId: "room-1", roundNo: 3 }, "dice_roll", {
      generateId: () => "fixed-id",
      now: () => new Date("2024-01-02T03:04:05.000Z"),
    });
    expect(env).toEqual({
      sessionId: "room-1",
      roundNo: 3,
      eventId: "fixed-id",
      timestamp: "2024-01-02T03:04:05.000Z",
      eventType: "dice_roll",
    });
  });

  it("uses real generators by default (unique id, ISO timestamp)", () => {
    const a = buildEnvelope({ sessionId: "s", roundNo: 1 }, "ai_call");
    const b = buildEnvelope({ sessionId: "s", roundNo: 1 }, "ai_call");
    expect(a.eventId).not.toBe(b.eventId);
    expect(Number.isNaN(Date.parse(a.timestamp))).toBe(false);
  });
});

describe("the five event shapes", () => {
  const corr = { sessionId: "room-1", roundNo: 2 };
  const gen = () => fixedGenerators();

  it("builds a dice_roll event with a recorded seed", () => {
    const e = makeDiceRollEvent(
      corr,
      {
        roller: "dice_service",
        expression: "uniform[-4,4]",
        range: { min: -4, max: 4 },
        rawValues: [2],
        result: 2,
        seed: 123456,
      },
      gen(),
    );
    expect(e.eventType).toBe("dice_roll");
    expect(e.seed).toBe(123456);
    expect(e.result).toBe(2);
    expect(e.range).toEqual({ min: -4, max: 4 });
    expect(e.sessionId).toBe("room-1");
    expect(e.roundNo).toBe(2);
  });

  it("builds a state_mutation event with proposed and applied diffs", () => {
    const e = makeStateMutationEvent(
      corr,
      {
        proposedDiff: [{ target: "char:1.hp", from: 10, to: 4 }],
        appliedDiff: [{ target: "char:1.hp", from: 10, to: 6 }],
      },
      gen(),
    );
    expect(e.eventType).toBe("state_mutation");
    expect(e.proposedDiff).toEqual([{ target: "char:1.hp", from: 10, to: 4 }]);
    expect(e.appliedDiff).toEqual([{ target: "char:1.hp", from: 10, to: 6 }]);
  });

  it("builds an ai_call event preserving verbatim usage passthrough", () => {
    const e = makeAiCallEvent(
      corr,
      {
        model: "gpt-x",
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 10,
          cacheWriteTokens: 5,
          providerSpecificField: "kept",
        },
      },
      gen(),
    );
    expect(e.eventType).toBe("ai_call");
    expect(e.model).toBe("gpt-x");
    expect(e.usage.inputTokens).toBe(100);
    expect(e.usage.cacheWriteTokens).toBe(5);
    expect(e.usage.providerSpecificField).toBe("kept");
  });

  it("builds a round_timing event deriving latencyMs", () => {
    const e = makeRoundTimingEvent(
      corr,
      {
        allReadyAt: "2024-01-01T00:00:00.000Z",
        narrationReturnedAt: "2024-01-01T00:00:02.500Z",
      },
      gen(),
    );
    expect(e.eventType).toBe("round_timing");
    expect(e.latencyMs).toBe(2500);
  });

  it("builds an ai_output event, omitting failureReason when not failed", () => {
    const ok = makeAiOutputEvent(
      corr,
      { rawOutput: "정상 출력", validationPassed: true },
      gen(),
    );
    expect(ok.eventType).toBe("ai_output");
    expect(ok.validationPassed).toBe(true);
    expect("failureReason" in ok).toBe(false);

    const bad = makeAiOutputEvent(
      corr,
      { rawOutput: "garbage", validationPassed: false, failureReason: "schema mismatch" },
      gen(),
    );
    expect(bad.validationPassed).toBe(false);
    expect(bad.failureReason).toBe("schema mismatch");
  });
});

describe("NoopEventSink", () => {
  it("accepts events without doing anything or throwing", () => {
    const sink = new NoopEventSink();
    const e = makeAiCallEvent(
      { sessionId: "s", roundNo: 1 },
      {
        model: "m",
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    );
    expect(() => sink.emit(e)).not.toThrow();
  });
});

describe("InMemoryEventSink", () => {
  /** Helper to build a dice_roll event at a specific timestamp. */
  function diceAt(sessionId: string, roundNo: number, isoTime: string, id: string): QaEvent {
    return makeDiceRollEvent(
      { sessionId, roundNo },
      {
        roller: "dice_service",
        expression: "uniform[-4,4]",
        range: { min: -4, max: 4 },
        rawValues: [0],
        result: 0,
        seed: 1,
      },
      { generateId: () => id, now: () => new Date(isoTime) },
    );
  }

  it("emit is non-blocking: events are not visible until flush() drains them", async () => {
    const sink = new InMemoryEventSink();
    sink.emit(diceAt("room-1", 1, "2024-01-01T00:00:00.000Z", "a"));
    // Deferred to a microtask, so nothing is buffered synchronously.
    expect(sink.size).toBe(0);
    await sink.flush();
    expect(sink.size).toBe(1);
  });

  it("queryBySession returns the session's events in timestamp then insertion order", async () => {
    const sink = new InMemoryEventSink();
    // Emit out of time order; one shares a timestamp to exercise the tie-break.
    sink.emit(diceAt("room-1", 1, "2024-01-01T00:00:02.000Z", "late"));
    sink.emit(diceAt("room-1", 1, "2024-01-01T00:00:01.000Z", "early"));
    sink.emit(diceAt("room-1", 2, "2024-01-01T00:00:01.000Z", "tie-second")); // same ts as "early"
    sink.emit(diceAt("other-room", 1, "2024-01-01T00:00:00.000Z", "other"));
    await sink.flush();

    const events = sink.queryBySession("room-1");
    expect(events.map((e) => e.eventId)).toEqual(["early", "tie-second", "late"]);
  });

  it("queryByRound narrows to a single round in time order", async () => {
    const sink = new InMemoryEventSink();
    sink.emit(diceAt("room-1", 1, "2024-01-01T00:00:02.000Z", "r1-late"));
    sink.emit(diceAt("room-1", 1, "2024-01-01T00:00:01.000Z", "r1-early"));
    sink.emit(diceAt("room-1", 2, "2024-01-01T00:00:00.000Z", "r2"));
    await sink.flush();

    expect(sink.queryByRound("room-1", 1).map((e) => e.eventId)).toEqual(["r1-early", "r1-late"]);
    expect(sink.queryByRound("room-1", 2).map((e) => e.eventId)).toEqual(["r2"]);
  });

  it("is best-effort: a throwing consumer never propagates and events still buffer", async () => {
    const sink = new InMemoryEventSink({
      onEvent: () => {
        throw new Error("consumer blew up");
      },
    });
    expect(() => sink.emit(diceAt("room-1", 1, "2024-01-01T00:00:00.000Z", "x"))).not.toThrow();
    await expect(sink.flush()).resolves.toBeUndefined();
    // Storage happens regardless of the consumer throwing.
    expect(sink.queryBySession("room-1").map((e) => e.eventId)).toEqual(["x"]);
  });

  it("flush() resolves immediately when there is nothing pending", async () => {
    const sink = new InMemoryEventSink();
    await expect(sink.flush()).resolves.toBeUndefined();
  });

  it("satisfies the EventSink interface (assignable, returns void)", () => {
    const sink: EventSink = new InMemoryEventSink();
    const result = sink.emit(
      diceAt("room-1", 1, "2024-01-01T00:00:00.000Z", "v"),
    );
    expect(result).toBeUndefined();
  });
});
