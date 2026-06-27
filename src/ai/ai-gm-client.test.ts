import { describe, it, expect } from "vitest";
import { FakeAiGmClient, makeTokenUsage, type CompleteRequest } from "./ai-gm-client.js";

describe("makeTokenUsage", () => {
  it("fills unspecified fields with zero", () => {
    expect(makeTokenUsage()).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it("preserves provided fields and extra provider passthrough", () => {
    const usage = makeTokenUsage({ inputTokens: 10, reasoningTokens: 5 });
    expect(usage.inputTokens).toBe(10);
    expect(usage.outputTokens).toBe(0);
    expect(usage.reasoningTokens).toBe(5);
  });
});

describe("FakeAiGmClient", () => {
  it("records each request and reports model as fake-<tier> by default", async () => {
    const client = new FakeAiGmClient();
    const req: CompleteRequest = {
      tier: "premium",
      prompt: { user: "hello" },
      budget: 1000,
    };

    const res = await client.complete(req);

    expect(client.calls).toEqual([req]);
    expect(res.model).toBe("fake-premium");
    expect(res.text).toBe("");
    expect(res.usage).toEqual(makeTokenUsage());
  });

  it("uses the configured responder and modelForTier", async () => {
    const client = new FakeAiGmClient({
      modelForTier: (tier) => `model-${tier}`,
      responder: (r) => ({ text: `tier=${r.tier}`, usage: { outputTokens: 9 } }),
    });

    const res = await client.complete({ tier: "fast", prompt: { user: "x" }, budget: 500 });

    expect(res.model).toBe("model-fast");
    expect(res.text).toBe("tier=fast");
    expect(res.usage.outputTokens).toBe(9);
  });
});
