import { describe, it, expect } from "vitest";
import {
  createCliAiGmClient,
  resolveCliProvider,
  resolveCodexEffort,
} from "./cli-client-factory.js";
import { CodexCliAiGmClient } from "./codex-cli-client.js";
import { ClaudeCliAiGmClient } from "./claude-cli-client.js";

describe("resolveCliProvider", () => {
  it("defaults to codex when AI_GM_CLI is unset", () => {
    expect(resolveCliProvider({})).toBe("codex");
  });

  it("selects claude (case-insensitive, trimmed)", () => {
    expect(resolveCliProvider({ AI_GM_CLI: "  Claude " })).toBe("claude");
  });

  it("selects codex explicitly", () => {
    expect(resolveCliProvider({ AI_GM_CLI: "codex" })).toBe("codex");
  });

  it("falls back to codex for unknown values", () => {
    expect(resolveCliProvider({ AI_GM_CLI: "gemini" })).toBe("codex");
  });
});

describe("createCliAiGmClient", () => {
  it("builds a Codex client by default", () => {
    expect(createCliAiGmClient({})).toBeInstanceOf(CodexCliAiGmClient);
  });

  it("builds a Claude client when AI_GM_CLI=claude", () => {
    expect(createCliAiGmClient({ AI_GM_CLI: "claude" })).toBeInstanceOf(ClaudeCliAiGmClient);
  });
});

describe("resolveCodexEffort", () => {
  it("defaults to low when unset", () => {
    expect(resolveCodexEffort({})).toBe("low");
  });

  it("accepts the known effort levels (case-insensitive, trimmed)", () => {
    expect(resolveCodexEffort({ CODEX_REASONING_EFFORT: "medium" })).toBe("medium");
    expect(resolveCodexEffort({ CODEX_REASONING_EFFORT: " High " })).toBe("high");
    expect(resolveCodexEffort({ CODEX_REASONING_EFFORT: "MINIMAL" })).toBe("minimal");
  });

  it("falls back to low for unknown values", () => {
    expect(resolveCodexEffort({ CODEX_REASONING_EFFORT: "turbo" })).toBe("low");
  });
});
