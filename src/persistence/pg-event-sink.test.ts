import { describe, expect, it } from "vitest";
import { makeAiCallEvent, makeDiceRollEvent, type QaEvent } from "../observability/events.js";
import { FakePgClient } from "./fake-pg.js";
import { PgEventSink } from "./pg-event-sink.js";

const gens = (id: string, iso: string) => ({
  generateId: () => id,
  now: () => new Date(iso),
});

const diceEvent = makeDiceRollEvent(
  { sessionId: "room-1", roundNo: 1 },
  {
    roller: "dice-service",
    expression: "uniform[-4,4]",
    range: { min: -4, max: 4 },
    rawValues: [1],
    result: 1,
    seed: 7,
  },
  gens("evt-1", "2024-01-02T03:04:05.000Z"),
);

describe("PgEventSink.emit", () => {
  it("writes a parameterized insert and is observable via flush", async () => {
    const db = new FakePgClient();
    const sink = new PgEventSink(db);

    sink.emit(diceEvent);
    await sink.flush();

    expect(db.calls).toHaveLength(1);
    const call = db.calls[0];
    expect(call.text).toContain("INSERT INTO qa_events");
    expect(call.text).toContain("$6::jsonb");
    expect(call.values?.[0]).toBe("evt-1");
    expect(call.values?.[1]).toBe("room-1");
    expect(call.values?.[2]).toBe(1);
    expect(call.values?.[3]).toBe("dice_roll");
    expect(call.values?.[5]).toBe(JSON.stringify(diceEvent));
  });

  it("never throws and stays drainable when the database rejects", async () => {
    const db = new FakePgClient().enqueueError(new Error("db down"));
    const sink = new PgEventSink(db);

    expect(() => sink.emit(diceEvent)).not.toThrow();
    await expect(sink.flush()).resolves.toBeUndefined();
  });
});

describe("PgEventSink queries", () => {
  it("queryBySession selects ordered by ts and maps payloads", async () => {
    const aiEvent = makeAiCallEvent(
      { sessionId: "room-1", roundNo: 2 },
      { model: "gpt", usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 } },
      gens("evt-2", "2024-01-02T03:04:06.000Z"),
    );
    const db = new FakePgClient().enqueueRows([{ payload: diceEvent }, { payload: aiEvent }]);
    const sink = new PgEventSink(db);

    const events: QaEvent[] = await sink.queryBySession("room-1");

    expect(db.lastCall!.text).toContain("WHERE session_id = $1");
    expect(db.lastCall!.text).toContain("ORDER BY ts ASC, seq ASC");
    expect(db.lastCall!.values).toEqual(["room-1"]);
    expect(events.map((e) => e.eventId)).toEqual(["evt-1", "evt-2"]);
  });

  it("queryByRound filters by session and round", async () => {
    const db = new FakePgClient().enqueueRows([{ payload: diceEvent }]);
    const sink = new PgEventSink(db);

    const events = await sink.queryByRound("room-1", 1);

    expect(db.lastCall!.text).toContain("session_id = $1 AND round_no = $2");
    expect(db.lastCall!.text).toContain("ORDER BY ts ASC, seq ASC");
    expect(db.lastCall!.values).toEqual(["room-1", 1]);
    expect(events).toEqual([diceEvent]);
  });
});
