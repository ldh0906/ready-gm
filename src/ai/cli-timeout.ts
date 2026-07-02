/**
 * Timeout/cancellation wrapper for local-CLI {@link import("./ai-gm-client.js").AiGmClient}
 * calls.
 *
 * The Codex/Claude CLI adapters spawn a child process and resolve only when that
 * process closes. A hung or pathologically slow CLI would otherwise leave the
 * triggering request (`/solo/act`, `/proposal`, an opening/resolution task)
 * pending forever, holding an AI-cost slot and never reaching the coordinator's
 * retry path (QA: "AI CLI process timeout/cancellation이 없다"). {@link withTimeout}
 * bounds every call: it passes an {@link AbortSignal} the runner uses to kill its
 * child, and rejects with a {@link CliTimeoutError} once `timeoutMs` elapses so
 * the failure surfaces as a normal AI request failure instead of a hang.
 */

/* global AbortController, AbortSignal, setTimeout, clearTimeout */

/** Error thrown when a CLI call exceeds its configured timeout. */
export class CliTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = "CliTimeoutError";
  }
}

/** Default per-call CLI timeout (2 minutes) when none is configured. */
export const DEFAULT_CLI_TIMEOUT_MS = 120_000;

/**
 * Run `op` with a hard timeout. `op` receives an {@link AbortSignal} that is
 * aborted when the timeout fires (so a spawn-based runner can kill its child),
 * and the returned promise rejects with a {@link CliTimeoutError}. When `op`
 * settles first, its result/rejection is passed through and the timer is cleared.
 *
 * A non-finite or non-positive `timeoutMs` disables the timeout (runs `op`
 * without a deadline) so callers can opt out with an explicit sentinel.
 */
export async function withTimeout<T>(
  op: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return op(new AbortController().signal);
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CliTimeoutError(label, timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([op(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Resolve the CLI call timeout from `AI_GM_TIMEOUT_MS` (milliseconds). A positive
 * integer overrides the default; `0` disables the timeout; unset/invalid values
 * fall back to {@link DEFAULT_CLI_TIMEOUT_MS}.
 */
export function resolveCliTimeoutMs(env: Record<string, string | undefined>): number {
  const raw = env.AI_GM_TIMEOUT_MS?.trim();
  if (raw === undefined || raw === "") return DEFAULT_CLI_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_CLI_TIMEOUT_MS;
  return Math.floor(n);
}
