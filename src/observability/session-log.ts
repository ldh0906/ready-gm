// @ts-check
/**
 * Session log — a best-effort, local JSONL trace of a live playtest session so a
 * developer (or an assistant reading the file) can see exactly what happened:
 * inbound player commands, round-flow phase transitions, AI raw responses + the
 * parse/validation result, narration delivery, and resolution failures.
 *
 * Like the {@link import("./event-sink.js").EventSink}, writing is
 * fire-and-forget: {@link SessionLogger.log}/{@link SessionLogger.emitQa} return
 * immediately, never block game flow, and never throw. Writes are serialized
 * through an internal promise chain so JSONL lines never interleave.
 *
 * This is a dev/playtest aid wired ONLY by the local server (which decides
 * enablement); the engine treats the logger as an optional dependency that
 * defaults to a no-op, so unit tests never touch the filesystem.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { EnvLike } from "../persistence/pg-client.js";
import type { QaEvent } from "./events.js";

/** A best-effort destination for session trace lines. Never throws/blocks. */
export interface SessionLogger {
  /** Whether anything is actually written (false for the no-op logger). */
  readonly enabled: boolean;
  /** Append one trace line: a category plus arbitrary JSON-serializable data. */
  log(category: string, data?: Record<string, unknown>): void;
  /** Tee a QA event (ai_output with the raw model text, dice_roll, etc.). */
  emitQa(event: QaEvent): void;
}

/** Logger that discards everything (logging disabled / tests). */
export class NoopSessionLogger implements SessionLogger {
  readonly enabled = false;
  log(): void {
    // Intentionally does nothing.
  }
  emitQa(): void {
    // Intentionally does nothing.
  }
}

/** Logger that appends JSONL lines to a file, serialized and error-swallowing. */
export class FileSessionLogger implements SessionLogger {
  readonly enabled = true;
  private readonly filePath: string;
  private dirReady = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  log(category: string, data: Record<string, unknown> = {}): void {
    this.append({ ts: new Date().toISOString(), category, ...data });
  }

  emitQa(event: QaEvent): void {
    this.append({ ts: new Date().toISOString(), category: "qa", event });
  }

  /** Serialize the entry and queue an append; swallow every failure. */
  private append(obj: Record<string, unknown>): void {
    let line: string;
    try {
      line = JSON.stringify(sanitizeSessionLogEntry(obj)) + "\n";
    } catch {
      return; // unserializable payload — drop it rather than throw
    }
    this.chain = this.chain.then(async () => {
      try {
        if (!this.dirReady) {
          await mkdir(dirname(this.filePath), { recursive: true });
          this.dirReady = true;
        }
        await appendFile(this.filePath, line, "utf8");
      } catch {
        // Best-effort: a logging failure must never affect game flow.
      }
    });
  }
}

/**
 * Redact credential-shaped fields and truncate long free text before writing
 * debug traces. This keeps the optional session log useful without making it a
 * second long-lived bearer-token or prompt-dump store.
 */
export function sanitizeSessionLogEntry(entry: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(entry, new WeakSet<object>()) as Record<string, unknown>;
}

const REDACTED = "[REDACTED]";
const MAX_LOG_STRING_LENGTH = 200;
const CREDENTIAL_KEY = /(token|ticket|secret|authorization|password|api[-_]?key)/i;

function sanitizeValue(value: unknown, seen: WeakSet<object>, key?: string): unknown {
  if (key !== undefined && CREDENTIAL_KEY.test(key)) return REDACTED;
  if (typeof value === "string") {
    return value.length > MAX_LOG_STRING_LENGTH
      ? `${value.slice(0, MAX_LOG_STRING_LENGTH)}...[truncated]`
      : value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value.map((item) => sanitizeValue(item, seen));
  }
  if (value !== null && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      out[childKey] = sanitizeValue(childValue, seen, childKey);
    }
    return out;
  }
  return value;
}

/**
 * Whether session logging is enabled for an environment. Default OFF so shared
 * or public play does not persist player text/model output unless explicitly
 * requested. Set `SESSION_LOG=1|true|on|yes` to enable it.
 * Always OFF under a test runner (`VITEST` / `NODE_ENV=test`) unless explicitly
 * forced on, so unit tests never write files.
 */
export function sessionLogEnabled(env: EnvLike): boolean {
  const raw = (env.SESSION_LOG ?? "").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  const forcedOn = raw === "1" || raw === "true" || raw === "on" || raw === "yes";
  if (!forcedOn) return false;
  return true;
}

/**
 * Build the session logger for an environment. Returns a {@link NoopSessionLogger}
 * when disabled; otherwise a {@link FileSessionLogger} writing to
 * `SESSION_LOG_FILE` when set, else `defaultFile`.
 */
export function createSessionLogger(env: EnvLike, defaultFile: string): SessionLogger {
  if (!sessionLogEnabled(env)) return new NoopSessionLogger();
  const custom = (env.SESSION_LOG_FILE ?? "").trim();
  return new FileSessionLogger(custom.length > 0 ? custom : defaultFile);
}
