/**
 * Selects which local-CLI {@link AiGmClient} backs the AI GM, based on an
 * environment variable, so a developer can swap the GM's brain between the
 * OpenAI Codex CLI and the Claude Code CLI without touching wiring code.
 *
 * Set `AI_GM_CLI=claude` to drive the GM with `claude -p`; anything else (or
 * unset) keeps the existing default of `codex exec`. The chosen adapter is
 * still injected through the provider-agnostic {@link AiGmClient} port, so the
 * rest of the engine is unaffected (design.md "AI GM", Requirement 16.2).
 */
import type { AiGmClient } from "./ai-gm-client.js";
import { CodexCliAiGmClient } from "./codex-cli-client.js";
import { ClaudeCliAiGmClient } from "./claude-cli-client.js";

/** The local CLI providers that can back the AI GM. */
export type CliProvider = "codex" | "claude";

/** Default provider when `AI_GM_CLI` is unset or unrecognised. */
const DEFAULT_PROVIDER: CliProvider = "codex";

/** Codex `model_reasoning_effort` levels. */
type CodexEffort = "minimal" | "low" | "medium" | "high";
const CODEX_EFFORTS: readonly CodexEffort[] = ["minimal", "low", "medium", "high"];
/**
 * Default Codex reasoning effort. `low` is the cost-effective lever (the
 * original default); Codex (gpt-5.5) is also markedly cheaper per call than the
 * Claude path. Override with `CODEX_REASONING_EFFORT` (e.g. `medium`/`high`).
 */
const DEFAULT_CODEX_EFFORT: CodexEffort = "low";

/**
 * Resolve the configured CLI provider from an environment record. The lookup is
 * case-insensitive and trims surrounding whitespace; unknown values fall back to
 * {@link DEFAULT_PROVIDER}.
 */
export function resolveCliProvider(env: Record<string, string | undefined>): CliProvider {
  const raw = env.AI_GM_CLI?.trim().toLowerCase();
  return raw === "claude" || raw === "codex" ? raw : DEFAULT_PROVIDER;
}

/**
 * Resolve the Codex reasoning effort from `CODEX_REASONING_EFFORT`
 * (case-insensitive); unknown/unset values fall back to {@link DEFAULT_CODEX_EFFORT}.
 */
export function resolveCodexEffort(env: Record<string, string | undefined>): CodexEffort {
  const raw = env.CODEX_REASONING_EFFORT?.trim().toLowerCase();
  return CODEX_EFFORTS.includes(raw as CodexEffort) ? (raw as CodexEffort) : DEFAULT_CODEX_EFFORT;
}

/**
 * Build the local-CLI {@link AiGmClient} selected by `AI_GM_CLI`. Codex uses
 * `gpt-5.5` at `CODEX_REASONING_EFFORT` (default `low`); Claude uses `sonnet`.
 */
export function createCliAiGmClient(
  env: Record<string, string | undefined> = {},
): AiGmClient {
  switch (resolveCliProvider(env)) {
    case "claude":
      return new ClaudeCliAiGmClient();
    case "codex":
    default:
      return new CodexCliAiGmClient({ reasoningEffort: resolveCodexEffort(env) });
  }
}
