import { describe, it, expect } from "vitest";
import { makeEngineConfig } from "../core/config.js";
import type { ModelTier, RequestType } from "../core/types.js";
import { InMemoryEventSink } from "../observability/event-sink.js";
import type { AiCallEvent } from "../observability/events.js";
import { FakeAiGmClient, type Prompt } from "./ai-gm-client.js";
import { AiGmRouter } from "./ai-gm-router.js";

const REQUEST_TYPES: RequestType[] = ["opening", "attributes", "resolution", "ending"];
const PROMPT: Prompt = { system: "You are the GM.", user: "Narrate the scene." };

describe("AiGmRouter model-tier routing", () => {
  it("routes each request type to its configured model tier", async () => {
    const config = makeEngineConfig();
    const client = new FakeAiGmClient();
    const router = new AiGmRouter({ client, config });

    for (const rt of REQUEST_TYPES) {
      await router.complete(rt, PROMPT);
    }

    // Each call to the client received the tier configured for that request type.
    expect(client.calls.map((c) => c.tier)).toEqual(
      REQUEST_TYPES.map((rt) => config.modelTiers[rt]),
    );
  });

  it("honours a custom modelTiers config when resolving the tier", async () => {
    const tiers: Record<RequestType, ModelTier> = {
      opening: "fast",
      attributes: "standard",
      resolution: "premium",
      ending: "standard",
    };
    const config = makeEngineConfig({ modelTiers: tiers });
    const client = new FakeAiGmClient();
    const router = new AiGmRouter({ client, config });

    for (const rt of REQUEST_TYPES) {
      const res = await router.complete(rt, PROMPT);
      expect(router.tierFor(rt)).toBe(tiers[rt]);
      // FakeAiGmClient reports the model as `fake-<tier>`, proving the client
      // was invoked with the configured tier.
      expect(res.model).toBe(`fake-${tiers[rt]}`);
    }

    expect(client.calls.map((c) => c.tier)).toEqual(REQUEST_TYPES.map((rt) => tiers[rt]));
  });

  it("passes the configured token budget to the client and allows overrides", async () => {
    const config = makeEngineConfig();
    const client = new FakeAiGmClient();
    const router = new AiGmRouter({ client, config });

    await router.complete("resolution", PROMPT);
    expect(client.calls[0]?.budget).toBe(config.tokenBudgets.resolution);

    await router.complete("resolution", PROMPT, 123);
    expect(client.calls[1]?.budget).toBe(123);
  });
});

describe("AiGmRouter ai_call instrumentation", () => {
  it("emits an ai_call event with model + usage when a sink is provided", async () => {
    const config = makeEngineConfig();
    const usage = {
      inputTokens: 100,
      outputTokens: 42,
      cacheReadTokens: 7,
      cacheWriteTokens: 3,
    };
    const client = new FakeAiGmClient({ responder: () => ({ text: "안녕하세요", usage }) });
    const sink = new InMemoryEventSink();
    const router = new AiGmRouter({
      client,
      config,
      sink,
      correlation: { sessionId: "room-1", roundNo: 5 },
    });

    await router.complete("opening", PROMPT);
    await sink.flush();

    const events = sink.queryByRound("room-1", 5);
    expect(events).toHaveLength(1);
    const event = events[0] as AiCallEvent;
    expect(event.eventType).toBe("ai_call");
    expect(event.model).toBe(`fake-${config.modelTiers.opening}`);
    expect(event.usage).toEqual(usage); // verbatim passthrough (R18.4)
    expect(event.sessionId).toBe("room-1");
    expect(event.roundNo).toBe(5);
  });

  it("emits one ai_call event per call", async () => {
    const config = makeEngineConfig();
    const client = new FakeAiGmClient();
    const sink = new InMemoryEventSink();
    const router = new AiGmRouter({
      client,
      config,
      sink,
      correlation: { sessionId: "room-2", roundNo: 1 },
    });

    for (const rt of REQUEST_TYPES) {
      await router.complete(rt, PROMPT);
    }
    await sink.flush();

    const events = sink.queryBySession("room-2");
    expect(events).toHaveLength(REQUEST_TYPES.length);
    expect(events.every((e) => e.eventType === "ai_call")).toBe(true);
    expect((events as AiCallEvent[]).map((e) => e.model)).toEqual(
      REQUEST_TYPES.map((rt) => `fake-${config.modelTiers[rt]}`),
    );
  });

  it("does not emit and does not fail the call when no sink is provided", async () => {
    const config = makeEngineConfig();
    const client = new FakeAiGmClient({ responder: () => ({ text: "ok" }) });
    const router = new AiGmRouter({ client, config });

    const res = await router.complete("ending", PROMPT);
    expect(res.text).toBe("ok");
    expect(client.calls).toHaveLength(1);
  });

  it("never lets a throwing sink alter the completion result", async () => {
    const config = makeEngineConfig();
    const client = new FakeAiGmClient({ responder: () => ({ text: "result" }) });
    const throwingSink = {
      emit() {
        throw new Error("sink boom");
      },
    };
    const router = new AiGmRouter({
      client,
      config,
      sink: throwingSink,
      correlation: { sessionId: "room-3", roundNo: 2 },
    });

    const res = await router.complete("attributes", PROMPT);
    expect(res.text).toBe("result");
    expect(res.model).toBe(`fake-${config.modelTiers.attributes}`);
  });
});
