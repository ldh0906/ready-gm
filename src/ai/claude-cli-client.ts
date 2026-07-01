/**
 * Claude CLI-backed {@link AiGmClient} — drives the AI GM with the locally
 * installed Claude Code CLI (`claude -p`) instead of a hosted API binding.
 *
 * This is the sibling of {@link import("./codex-cli-client.js").CodexCliAiGmClient}:
 * the engine talks to the model only through the {@link AiGmClient} port, so this
 * adapter lets a developer "plug their Claude CLI into the GM slot" for an
 * end-to-end playtest. Each {@link complete} call invokes `claude` once in
 * non-interactive (headless / "print") mode:
 *
 *   claude -p --output-format json --model <model>
 *
 * The prompt is fed on STDIN (so large prompts never hit command-line length
 * limits), and the structured result is read from the single JSON object the CLI
 * prints to stdout. That JSON carries both the agent's final text (`result`) and
 * verbatim token usage (`usage`), so — unlike Codex — there is no temp output
 * file to manage and no log-scraping for the token total.
 *
 * No tools are granted, so the GM agent only generates text and cannot modify
 * the repository (mirroring the read-only posture of the Codex adapter).
 *
 * The actual process spawn is injected as {@link ClaudeRunner} so the adapter is
 * unit-testable without invoking the real CLI.
 */
import { spawn } from "node:child_process";
import type { ModelTier } from "../core/types.js";
import type { TokenUsage } from "../observability/events.js";
import {
  makeTokenUsage,
  type AiGmClient,
  type AiResponse,
  type CompleteRequest,
} from "./ai-gm-client.js";
import { extractJsonBlock } from "./codex-cli-client.js";

/** Result of one `claude -p` invocation. */
export interface ClaudeRunResult {
  /** Combined stdout/stderr — expected to contain the `--output-format json` object. */
  readonly stdout: string;
}

/** Injectable process runner; the default spawns the real `claude` CLI. */
export type ClaudeRunner = (input: {
  readonly args: readonly string[];
  readonly prompt: string;
}) => Promise<ClaudeRunResult>;

/** Options controlling {@link ClaudeCliAiGmClient}. */
export interface ClaudeCliClientOptions {
  /**
   * Map a request tier to a Claude model name/alias. Defaults to a constant
   * {@link ClaudeCliClientOptions.model} for every tier.
   */
  modelForTier?: (tier: ModelTier) => string;
  /** The single model/alias used for all tiers. Default `"sonnet"`. */
  model?: string;
  /** Injectable runner (defaults to the real `claude -p` spawn). */
  run?: ClaudeRunner;
}

/** Default Claude model alias (the CLI resolves it to the current Sonnet). */
const DEFAULT_MODEL = "sonnet";

/** Shape of the relevant fields in Claude's `--output-format json` object. */
interface ClaudeJsonOutput {
  readonly result?: unknown;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_read_input_tokens?: number;
    readonly cache_creation_input_tokens?: number;
  };
}

/**
 * Parse the `--output-format json` object Claude prints. Returns the agent's
 * final text (the `result` field) and verbatim token usage mapped onto the
 * engine's {@link TokenUsage} shape. Falls back to treating the whole output as
 * the text when it is not the expected JSON envelope (e.g. an error string).
 */
export function parseClaudeOutput(stdout: string): { text: string; usage: TokenUsage } {
  // `--output-format json` prints a single JSON object to stdout. Parse it
  // directly — do NOT fence-scan first, since the `result` field may itself
  // contain a ```json block that a fence scan would wrongly latch onto.
  const trimmed = stdout.trim();
  let parsed: ClaudeJsonOutput | undefined;
  try {
    parsed = JSON.parse(trimmed) as ClaudeJsonOutput;
  } catch {
    parsed = undefined;
  }

  if (parsed === undefined || typeof parsed.result !== "string") {
    // Not the expected envelope — surface the raw output as the text so the
    // coordinator's own JSON extraction/validation can report a clean error.
    return { text: trimmed, usage: makeTokenUsage() };
  }

  const u = parsed.usage ?? {};
  const usage = makeTokenUsage({
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  });
  return { text: parsed.result, usage };
}

/**
 * An {@link AiGmClient} that fulfils completions by shelling out to `claude -p`.
 */
export class ClaudeCliAiGmClient implements AiGmClient {
  private readonly modelForTier: (tier: ModelTier) => string;
  private readonly run: ClaudeRunner;

  constructor(options: ClaudeCliClientOptions = {}) {
    const model = options.model ?? DEFAULT_MODEL;
    this.modelForTier = options.modelForTier ?? (() => model);
    this.run = options.run ?? defaultClaudeRunner;
  }

  async complete(req: CompleteRequest): Promise<AiResponse> {
    const model = this.modelForTier(req.tier);
    const prompt =
      req.prompt.system !== undefined && req.prompt.system.length > 0
        ? `${req.prompt.system}\n\n${req.prompt.user}`
        : req.prompt.user;

    const args = [
      "-p",
      "--output-format",
      "json",
      "--model",
      model,
    ];

    const result = await this.run({ args, prompt });
    const { text: rawText, usage } = parseClaudeOutput(result.stdout);
    const text = extractJsonBlock(rawText);
    return { model, text, usage };
  }
}

/**
 * Default {@link ClaudeRunner}: spawn the real `claude` CLI in print mode and
 * feed the prompt on stdin. The structured JSON result is printed to stdout.
 */
const defaultClaudeRunner: ClaudeRunner = async ({ args, prompt }) => {
  const stdout = await new Promise<string>((resolve, reject) => {
    // `shell: true` so the Windows `claude.cmd`/`claude.ps1` shim resolves on PATH.
    const child = spawn("claude", args, { shell: true });
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (buffer += chunk));
    child.stderr.on("data", (chunk: string) => (buffer += chunk));
    child.on("error", reject);
    child.on("close", () => resolve(buffer));
    child.stdin.write(prompt);
    child.stdin.end();
  });

  return { stdout };
};
