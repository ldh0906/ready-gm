import { describe, it, expect } from "vitest";
import {
  ClaudeCliAiGmClient,
  parseClaudeOutput,
  type ClaudeRunner,
} from "./claude-cli-client.js";

describe("parseClaudeOutput", () => {
  it("extracts the result text and maps verbatim usage", () => {
    const stdout = JSON.stringify({
      type: "result",
      result: '{"narration":"한국어 도입부"}',
      usage: {
        input_tokens: 120,
        output_tokens: 45,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 5,
      },
    });

    const { text, usage } = parseClaudeOutput(stdout);

    expect(text).toBe('{"narration":"한국어 도입부"}');
    expect(usage.inputTokens).toBe(120);
    expect(usage.outputTokens).toBe(45);
    expect(usage.cacheReadTokens).toBe(10);
    expect(usage.cacheWriteTokens).toBe(5);
  });

  it("falls back to raw output with zero usage when not the expected envelope", () => {
    const { text, usage } = parseClaudeOutput("some CLI error text");
    expect(text).toBe("some CLI error text");
    expect(usage.inputTokens).toBe(0);
    expect(usage.outputTokens).toBe(0);
  });
});

describe("ClaudeCliAiGmClient", () => {
  it("invokes the runner in print/json mode and returns extracted JSON", async () => {
    let captured: { args: readonly string[]; prompt: string } | undefined;
    const run: ClaudeRunner = (input) => {
      captured = input;
      return Promise.resolve({
        stdout: JSON.stringify({
          result: '```json\n{"narration":"한국어"}\n```',
          usage: { input_tokens: 7, output_tokens: 3 },
        }),
      });
    };
    const client = new ClaudeCliAiGmClient({ run });

    const res = await client.complete({
      tier: "premium",
      prompt: { system: "GM", user: "opening" },
      budget: 4000,
    });

    expect(res.model).toBe("sonnet");
    expect(res.text).toBe('{"narration":"한국어"}');
    expect(res.usage.inputTokens).toBe(7);
    expect(res.usage.outputTokens).toBe(3);
    // The prompt combines system + user, fed via the runner (stdin in prod).
    expect(captured?.prompt).toBe("GM\n\nopening");
    expect(captured?.args).toContain("-p");
    expect(captured?.args).toEqual(expect.arrayContaining(["--output-format", "json"]));
    expect(captured?.args).toEqual(expect.arrayContaining(["--model", "sonnet"]));
  });

  it("maps every tier to the single configured model by default", async () => {
    const models: string[] = [];
    const client = new ClaudeCliAiGmClient({
      model: "opus",
      run: (input) => {
        models.push(input.args[input.args.indexOf("--model") + 1] as string);
        return Promise.resolve({ stdout: JSON.stringify({ result: "{}" }) });
      },
    });

    await client.complete({ tier: "fast", prompt: { user: "a" }, budget: 1 });
    await client.complete({ tier: "standard", prompt: { user: "b" }, budget: 1 });
    await client.complete({ tier: "premium", prompt: { user: "c" }, budget: 1 });

    expect(models).toEqual(["opus", "opus", "opus"]);
  });
});
