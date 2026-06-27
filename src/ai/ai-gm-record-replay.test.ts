import { describe, it, expect } from "vitest";
import { InMemoryEventSink } from "../observability/event-sink.js";
import type { AiCallEvent, AiOutputEvent } from "../observability/events.js";
import { FakeAiGmClient, type CompleteRequest, type Prompt } from "./ai-gm-client.js";
import {
  CorpusMissError,
  InMemoryCorpusStore,
  RecordReplayAiGmClient,
  createRecordReplayClient,
  fingerprint,
  type CorpusEntry,
} from "./ai-gm-record-replay.js";

const PROMPT: Prompt = { system: "You are the GM.", user: "Narrate the scene." };

function req(overrides: Partial<CompleteRequest> = {}): CompleteRequest {
  return { tier: "standard", prompt: PROMPT, budget: 1000, ...overrides };
}

describe("fingerprint", () => {
  it("is stable: the same request yields the same fingerprint", () => {
    expect(fingerprint(req())).toBe(fingerprint(req()));
  });

  it("is insensitive to property insertion order in the prompt", () => {
    const a = req({ prompt: { system: "s", user: "u" } });
    const b = req({ prompt: { user: "u", system: "s" } });
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it("differs when the tier differs", () => {
    expect(fingerprint(req({ tier: "fast" }))).not.toBe(fingerprint(req({ tier: "premium" })));
  });

  it("differs when the prompt differs", () => {
    const a = req({ prompt: { user: "one" } });
    const b = req({ prompt: { user: "two" } });
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it("differs when the budget differs", () => {
    expect(fingerprint(req({ budget: 100 }))).not.toBe(fingerprint(req({ budget: 200 })));
  });

  it("distinguishes absent vs present system preamble", () => {
    const withSystem = req({ prompt: { system: "s", user: "u" } });
    const withoutSystem = req({ prompt: { user: "u" } });
    expect(fingerprint(withSystem)).not.toBe(fingerprint(withoutSystem));
  });
});

describe('RecordReplayAiGmClient mode "off"', () => {
  it("is a pure passthrough to the delegate (behaviour unchanged)", async () => {
    const delegate = new FakeAiGmClient({ responder: () => ({ text: "live" }) });
    const client = new RecordReplayAiGmClient({ delegate }); // default mode

    const res = await client.complete(req());

    expect(res.text).toBe("live");
    expect(res.model).toBe("fake-standard");
    expect(delegate.calls).toHaveLength(1);
  });
});

describe('RecordReplayAiGmClient mode "record"', () => {
  it("passes through to the delegate and captures an entry with a stable fingerprint", async () => {
    const delegate = new FakeAiGmClient({
      responder: () => ({ text: "captured", usage: { inputTokens: 11, outputTokens: 7 } }),
    });
    const corpus = new InMemoryCorpusStore();
    const client = new RecordReplayAiGmClient({ delegate, mode: "record", corpus });

    const res = await client.complete(req());

    expect(res.text).toBe("captured");
    expect(delegate.calls).toHaveLength(1);
    expect(corpus.size).toBe(1);

    const entry = corpus.entries()[0] as CorpusEntry;
    expect(entry.fingerprint).toBe(fingerprint(req()));
    expect(entry.request).toEqual(req());
    expect(entry.response.text).toBe("captured");
    expect(entry.response.usage.inputTokens).toBe(11);
    expect(entry.response.usage.outputTokens).toBe(7);
  });

  it("captures distinct fingerprints for distinct requests", async () => {
    const delegate = new FakeAiGmClient({ responder: (r) => ({ text: r.prompt.user }) });
    const corpus = new InMemoryCorpusStore();
    const client = new RecordReplayAiGmClient({ delegate, mode: "record", corpus });

    await client.complete(req({ prompt: { user: "alpha" } }));
    await client.complete(req({ prompt: { user: "beta" } }));

    const fps = corpus.entries().map((e) => e.fingerprint);
    expect(new Set(fps).size).toBe(2);
  });

  it("emits ai_call and ai_output QA events when a sink is provided", async () => {
    const usage = { inputTokens: 100, outputTokens: 42, cacheReadTokens: 1, cacheWriteTokens: 2 };
    const delegate = new FakeAiGmClient({ responder: () => ({ text: "안녕하세요", usage }) });
    const corpus = new InMemoryCorpusStore();
    const sink = new InMemoryEventSink();
    const client = new RecordReplayAiGmClient({
      delegate,
      mode: "record",
      corpus,
      sink,
      correlation: { sessionId: "room-1", roundNo: 3 },
    });

    await client.complete(req());
    await sink.flush();

    const events = sink.queryByRound("room-1", 3);
    expect(events.map((e) => e.eventType).sort()).toEqual(["ai_call", "ai_output"]);

    const aiCall = events.find((e) => e.eventType === "ai_call") as AiCallEvent;
    expect(aiCall.model).toBe("fake-standard");
    expect(aiCall.usage).toEqual(usage); // verbatim passthrough (R18.4)

    const aiOutput = events.find((e) => e.eventType === "ai_output") as AiOutputEvent;
    expect(aiOutput.rawOutput).toBe("안녕하세요"); // raw output captured (R18.6)
  });

  it("requires a corpus", () => {
    const delegate = new FakeAiGmClient();
    expect(() => new RecordReplayAiGmClient({ delegate, mode: "record" })).toThrow(/corpus/);
  });
});

describe('RecordReplayAiGmClient mode "replay"', () => {
  it("returns the recorded response WITHOUT invoking the delegate", async () => {
    // Record against one delegate, replay against a fresh, never-called delegate.
    const recordDelegate = new FakeAiGmClient({ responder: () => ({ text: "from-corpus" }) });
    const corpus = new InMemoryCorpusStore();
    const recorder = new RecordReplayAiGmClient({
      delegate: recordDelegate,
      mode: "record",
      corpus,
    });
    await recorder.complete(req());

    const replayDelegate = new FakeAiGmClient({ responder: () => ({ text: "LIVE-SHOULD-NOT-RUN" }) });
    const player = new RecordReplayAiGmClient({ delegate: replayDelegate, mode: "replay", corpus });

    const res = await player.complete(req());

    expect(res.text).toBe("from-corpus");
    expect(replayDelegate.calls).toHaveLength(0); // delegate never called on a hit
  });

  it("throws CorpusMissError on a miss by default (gap flagged)", async () => {
    const delegate = new FakeAiGmClient();
    const corpus = new InMemoryCorpusStore();
    const player = new RecordReplayAiGmClient({ delegate, mode: "replay", corpus });

    await expect(player.complete(req())).rejects.toBeInstanceOf(CorpusMissError);
    expect(delegate.calls).toHaveLength(0);
  });

  it("carries the fingerprint and request on the CorpusMissError", async () => {
    const delegate = new FakeAiGmClient();
    const corpus = new InMemoryCorpusStore();
    const player = new RecordReplayAiGmClient({ delegate, mode: "replay", corpus });

    const request = req();
    await expect(player.complete(request)).rejects.toMatchObject({
      fingerprint: fingerprint(request),
      request,
    });
  });

  it("falls back to the delegate on a miss when configured, recording the result", async () => {
    const delegate = new FakeAiGmClient({ responder: () => ({ text: "fallback-live" }) });
    const corpus = new InMemoryCorpusStore();
    const player = new RecordReplayAiGmClient({
      delegate,
      mode: "replay",
      corpus,
      fallbackToDelegateOnMiss: true,
    });

    const res = await player.complete(req());

    expect(res.text).toBe("fallback-live");
    expect(delegate.calls).toHaveLength(1);
    expect(corpus.size).toBe(1); // the gap was filled

    // A subsequent replay of the same request now hits the corpus.
    const delegate2 = new FakeAiGmClient({ responder: () => ({ text: "SHOULD-NOT-RUN" }) });
    const player2 = new RecordReplayAiGmClient({ delegate: delegate2, mode: "replay", corpus });
    const res2 = await player2.complete(req());
    expect(res2.text).toBe("fallback-live");
    expect(delegate2.calls).toHaveLength(0);
  });

  it("requires a corpus", () => {
    const delegate = new FakeAiGmClient();
    expect(() => new RecordReplayAiGmClient({ delegate, mode: "replay" })).toThrow(/corpus/);
  });
});

describe("InMemoryCorpusStore", () => {
  it("returns the most recent response when a fingerprint is re-recorded", async () => {
    const corpus = new InMemoryCorpusStore();
    corpus.append({ fingerprint: "fp", request: req(), response: makeResponse("first") });
    corpus.append({ fingerprint: "fp", request: req(), response: makeResponse("second") });

    expect(corpus.find("fp")?.text).toBe("second");
    expect(corpus.entries()).toHaveLength(2); // append-only history preserved
  });

  it("returns undefined for an unknown fingerprint", () => {
    expect(new InMemoryCorpusStore().find("nope")).toBeUndefined();
  });
});

describe("createRecordReplayClient", () => {
  it("returns the bare delegate for off mode with no sink (zero wrapping)", () => {
    const delegate = new FakeAiGmClient();
    expect(createRecordReplayClient({ delegate })).toBe(delegate);
  });

  it("wraps the delegate when a mode is active", () => {
    const delegate = new FakeAiGmClient();
    const corpus = new InMemoryCorpusStore();
    const client = createRecordReplayClient({ delegate, mode: "record", corpus });
    expect(client).toBeInstanceOf(RecordReplayAiGmClient);
  });
});

function makeResponse(text: string) {
  return {
    model: "fake-standard",
    text,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
}
