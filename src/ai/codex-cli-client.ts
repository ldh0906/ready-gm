/**
 * Codex CLI-backed {@link AiGmClient} — drives the AI GM with the locally
 * installed OpenAI Codex CLI (`codex exec`) instead of a hosted API binding.
 *
 * The engine talks to the model only through the {@link AiGmClient} port, so
 * this adapter lets a developer "plug their Codex CLI into the GM slot" for an
 * end-to-end playtest. Each {@link complete} call invokes `codex exec` once,
 * non-interactively:
 *
 *   codex exec -m <model> -c model_reasoning_effort=<effort> \
 *     --skip-git-repo-check -s read-only --ephemeral --color never -o <tmp> -
 *
 * The prompt is fed on STDIN (so large prompts never hit command-line length
 * limits), and the agent's final message is captured from the `-o` output file.
 * The CLI runs read-only so the GM agent can never modify the repository.
 *
 * Cost/perf note: this Codex is backed by a ChatGPT account, which restricts
 * model choice (mini/nano models are rejected). The cheapest viable lever is a
 * low `model_reasoning_effort` on the allowed `gpt-5.5` model — that is the
 * default here.
 *
 * The actual process spawn is injected as {@link CodexRunner} so the adapter is
 * unit-testable without invoking the real CLI.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelTier } from "../core/types.js";
import type { TokenUsage } from "../observability/events.js";
import {
  makeTokenUsage,
  type AiGmClient,
  type AiResponse,
  type CompleteRequest,
} from "./ai-gm-client.js";

/** Result of one `codex exec` invocation. */
export interface CodexRunResult {
  /** Combined stdout/stderr (used to parse the reported token count). */
  readonly stdout: string;
  /** The agent's final message (the content written to the `-o` file). */
  readonly lastMessage: string;
}

/** Injectable process runner; the default spawns the real `codex` CLI. */
export type CodexRunner = (input: {
  readonly args: readonly string[];
  readonly prompt: string;
}) => Promise<CodexRunResult>;

/** Options controlling {@link CodexCliAiGmClient}. */
export interface CodexCliClientOptions {
  /**
   * Map a request tier to a Codex model name. Defaults to a constant
   * {@link CodexCliClientOptions.model} for every tier, because a ChatGPT-account
   * Codex restricts model selection (per-tier minis are not available).
   */
  modelForTier?: (tier: ModelTier) => string;
  /** The single allowed model used for all tiers. Default `"gpt-5.5"`. */
  model?: string;
  /** `model_reasoning_effort` override. Default `"low"` (the cost-effective lever). */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  /** Injectable runner (defaults to the real `codex exec` spawn). */
  run?: CodexRunner;
}

/** Default allowed model for a ChatGPT-account Codex. */
const DEFAULT_MODEL = "gpt-5.5";
/** Default reasoning effort — the cheapest setting compatible with the tools. */
const DEFAULT_EFFORT = "low";

/**
 * Extract the JSON object the coordinator expects from a Codex final message.
 * Codex may wrap the JSON in a ```json fence or surround it with prose; this
 * pulls out the JSON body so the coordinator's strict `JSON.parse` succeeds.
 */
export function extractJsonBlock(text: string): string {
  const trimmed = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence?.[1] !== undefined) {
    return fence[1].trim();
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return trimmed.slice(first, last + 1);
  }
  return trimmed;
}

/** Parse the "tokens used\n12,345" total Codex prints, or 0 when absent. */
export function parseTokensUsed(stdout: string): number {
  const match = /tokens used[\s:]*([\d,]+)/i.exec(stdout);
  if (match?.[1] === undefined) return 0;
  const n = Number.parseInt(match[1].replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * An {@link AiGmClient} that fulfils completions by shelling out to `codex exec`.
 */
export class CodexCliAiGmClient implements AiGmClient {
  private readonly modelForTier: (tier: ModelTier) => string;
  private readonly reasoningEffort: string;
  private readonly run: CodexRunner;

  constructor(options: CodexCliClientOptions = {}) {
    const model = options.model ?? DEFAULT_MODEL;
    this.modelForTier = options.modelForTier ?? (() => model);
    this.reasoningEffort = options.reasoningEffort ?? DEFAULT_EFFORT;
    this.run = options.run ?? defaultCodexRunner;
  }

  async complete(req: CompleteRequest): Promise<AiResponse> {
    const model = this.modelForTier(req.tier);
    const prompt =
      req.prompt.system !== undefined && req.prompt.system.length > 0
        ? `${req.prompt.system}\n\n${req.prompt.user}`
        : req.prompt.user;

    const args = [
      "exec",
      // Skip loading the user's config.toml — this avoids spawning their MCP
      // servers for per-call health checks (a major latency source) and ignores
      // their high reasoning-effort default. Auth still resolves via CODEX_HOME.
      "--ignore-user-config",
      "-m",
      model,
      "-c",
      `model_reasoning_effort=${this.reasoningEffort}`,
      "--skip-git-repo-check",
      "-s",
      "read-only",
      "--ephemeral",
      "--color",
      "never",
    ];

    const result = await this.run({ args, prompt });
    const text = extractJsonBlock(result.lastMessage);
    const usage: TokenUsage = makeTokenUsage({ outputTokens: parseTokensUsed(result.stdout) });
    return { model, text, usage };
  }
}

/**
 * Default {@link CodexRunner}: spawn the real `codex` CLI, feed the prompt on
 * stdin, and read the agent's final message from a temp `-o` file.
 */
const defaultCodexRunner: CodexRunner = async ({ args, prompt }) => {
  const outFile = join(tmpdir(), `codex-gm-${randomUUID()}.txt`);
  // `-o <file>` captures the final message; trailing `-` reads the prompt from stdin.
  const fullArgs = [...args, "-o", outFile, "-"];

  const stdout = await new Promise<string>((resolve, reject) => {
    // `shell: true` so the Windows `codex.cmd`/`codex.ps1` shim resolves on PATH.
    const child = spawn("codex", fullArgs, { shell: true });
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

  let lastMessage = "";
  try {
    lastMessage = await readFile(outFile, "utf8");
  } catch {
    // No output file (the run errored before producing a message).
    lastMessage = "";
  } finally {
    await rm(outFile, { force: true }).catch(() => undefined);
  }

  return { stdout, lastMessage };
};
