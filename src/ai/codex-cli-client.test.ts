import { describe, it, expect } from "vitest";
import {
  CodexCliAiGmClient,
  extractJsonBlock,
  parseTokensUsed,
  type CodexRunner,
} from "./codex-cli-client.js";

describe("extractJsonBlock", () => {
  it("returns a bare JSON object unchanged", () => {
    expect(extractJsonBlock('{"narration":"안녕"}')).toBe('{"narration":"안녕"}');
  });

  it("unwraps a ```json fenced block", () => {
    const fenced = '```json\n{"narration":"한국어"}\n```';
    expect(extractJsonBlock(fenced)).toBe('{"narration":"한국어"}');
  });

  it("extracts the JSON body when surrounded by prose", () => {
    const noisy = 'Here is the result:\n{"a":1,"b":2}\nThanks!';
    expect(extractJsonBlock(noisy)).toBe('{"a":1,"b":2}');
  });
});

describe("parseTokensUsed", () => {
  it("parses the comma-formatted total Codex prints", () => {
    expect(parseTokensUsed("...\ntokens used\n13,531\n")).toBe(13531);
  });

  it("returns 0 when no token line is present", () => {
    expect(parseTokensUsed("no tokens here")).toBe(0);
  });
});

describe("CodexCliAiGmClient", () => {
  it("invokes the runner with the read-only, low-effort exec flags and returns extracted JSON", async () => {
    let captured: { args: readonly string[]; prompt: string } | undefined;
    const run: CodexRunner = (input) => {
      captured = input;
      return Promise.resolve({
        stdout: "tokens used\n1,200\n",
        lastMessage: '```json\n{"narration":"한국어 도입부"}\n```',
      });
    };
    const client = new CodexCliAiGmClient({ run });

    const res = await client.complete({
      tier: "premium",
      prompt: { system: "GM", user: "opening" },
      budget: 4000,
    });

    expect(res.model).toBe("gpt-5.5");
    expect(res.text).toBe('{"narration":"한국어 도입부"}');
    expect(res.usage.outputTokens).toBe(1200);
    // The prompt combines system + user, fed via the runner (stdin in prod).
    expect(captured?.prompt).toBe("GM\n\nopening");
    expect(captured?.args).toContain("exec");
    expect(captured?.args).toContain("read-only");
    expect(captured?.args).toEqual(expect.arrayContaining(["-m", "gpt-5.5"]));
    expect(captured?.args).toEqual(
      expect.arrayContaining(["-c", "model_reasoning_effort=low"]),
    );
  });

  it("maps every tier to the single allowed model by default", async () => {
    const models: string[] = [];
    const run: CodexRunner = () =>
      Promise.resolve({ stdout: "", lastMessage: "{}" });
    const client = new CodexCliAiGmClient({
      model: "gpt-5.5",
      run: (input) => {
        models.push(input.args[input.args.indexOf("-m") + 1] as string);
        return run(input);
      },
    });

    await client.complete({ tier: "fast", prompt: { user: "a" }, budget: 1 });
    await client.complete({ tier: "standard", prompt: { user: "b" }, budget: 1 });
    await client.complete({ tier: "premium", prompt: { user: "c" }, budget: 1 });

    expect(models).toEqual(["gpt-5.5", "gpt-5.5", "gpt-5.5"]);
  });
});
