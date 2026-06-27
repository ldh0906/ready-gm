/**
 * Record/replay wrapper for the provider-agnostic {@link AiGmClient}.
 *
 * The engine talks to the LLM only through the {@link AiGmClient} port. This
 * module wraps any delegate client with a thin, provider-agnostic record/replay
 * layer used for corpus capture and deterministic regression reuse:
 *
 *  - **`"off"` (DEFAULT):** pure passthrough to the delegate. Production
 *    behaviour is unchanged — no capture, no lookup, no overhead beyond a single
 *    delegated call (Requirement 16.2).
 *  - **`"record"`:** passthrough to the delegate, but every real call is
 *    appended to an append-only {@link CorpusStore} keyed by a stable request
 *    {@link fingerprint}. Each {@link CorpusEntry} keeps the full
 *    {@link CompleteRequest} (tier + prompt + budget), the raw {@link AiResponse},
 *    and the provider {@link TokenUsage}, building a reusable dataset for later
 *    judge/regression evaluation. The existing `ai_call` / `ai_output` QA events
 *    are reused for instrumentation (Requirements 18.4, 18.6).
 *  - **`"replay"`:** serves a recorded response by fingerprint WITHOUT calling
 *    the delegate (deterministic, no live provider call). A miss either throws a
 *    typed {@link CorpusMissError} (the default, so regression gaps are visible)
 *    or — when `fallbackToDelegateOnMiss` is set — falls back to the delegate so
 *    the gap is filled rather than flagged (Requirement 17.1-style graceful path).
 *
 * The wrapper is provider-agnostic: it never inspects vendor-specific shapes. A
 * durable file/DB-backed {@link CorpusStore} can be dropped in later without
 * touching the wrapper, since the store is injected.
 */
import { createHash } from "node:crypto";
import {
  makeAiCallEvent,
  makeAiOutputEvent,
  type CorrelationKey,
  type EnvelopeGenerators,
} from "../observability/events.js";
import type { EventSink } from "../observability/event-sink.js";
import type { AiGmClient, AiResponse, CompleteRequest } from "./ai-gm-client.js";

/** The three record/replay modes. `"off"` is the production default. */
export type RecordReplayMode = "off" | "record" | "replay";

/**
 * A single captured AI interaction: the stable request fingerprint, the full
 * request that produced it, and the verbatim response (including usage). This
 * is the reusable unit stored in a {@link CorpusStore}.
 */
export interface CorpusEntry {
  /** Stable, deterministic fingerprint of {@link request} (see {@link fingerprint}). */
  fingerprint: string;
  /** The full completion request: tier + prompt + budget. */
  request: CompleteRequest;
  /** The verbatim provider response, including token usage. */
  response: AiResponse;
}

/**
 * Append-only store of {@link CorpusEntry} records. Implementations MUST treat
 * the corpus as immutable history (append, never mutate prior entries) so a
 * captured dataset is a faithful regression record. The in-memory
 * implementation is provided here; a file/DB-backed store can implement the
 * same interface later.
 */
export interface CorpusStore {
  /** Append one captured interaction to the corpus. */
  append(entry: CorpusEntry): void;
  /**
   * Return the recorded response for a fingerprint, or `undefined` on a miss.
   * When multiple entries share a fingerprint (re-recorded over time), the most
   * recent one is returned so replays reflect the latest capture.
   */
  find(fingerprint: string): AiResponse | undefined;
  /** Every entry in append order (for inspection / persistence). */
  entries(): readonly CorpusEntry[];
}

/** In-memory, append-only {@link CorpusStore}. Suitable for tests and capture runs. */
export class InMemoryCorpusStore implements CorpusStore {
  private readonly log: CorpusEntry[] = [];
  /** Fingerprint → latest response, kept in sync with the append-only log. */
  private readonly latest = new Map<string, AiResponse>();

  append(entry: CorpusEntry): void {
    this.log.push(entry);
    this.latest.set(entry.fingerprint, entry.response);
  }

  find(fingerprint: string): AiResponse | undefined {
    return this.latest.get(fingerprint);
  }

  entries(): readonly CorpusEntry[] {
    return this.log;
  }

  /** Number of entries appended so far. */
  get size(): number {
    return this.log.length;
  }
}

/**
 * Thrown in `"replay"` mode when no recorded response matches the request
 * fingerprint and fallback is disabled. Surfacing the gap (rather than silently
 * calling the provider) keeps regression coverage holes visible.
 */
export class CorpusMissError extends Error {
  /** The fingerprint that was not found in the corpus. */
  readonly fingerprint: string;
  /** The request that produced the missing fingerprint. */
  readonly request: CompleteRequest;

  constructor(fingerprint: string, request: CompleteRequest) {
    super(`No recorded AI response for fingerprint ${fingerprint}`);
    this.name = "CorpusMissError";
    this.fingerprint = fingerprint;
    this.request = request;
    // Restore prototype chain for instanceof across transpilation targets.
    Object.setPrototypeOf(this, CorpusMissError.prototype);
  }
}

/**
 * Produce a stable, deterministic fingerprint for a completion request. The
 * fingerprint is a SHA-256 hash of a canonical JSON encoding of the request's
 * meaningful inputs (tier, prompt.system, prompt.user, budget). Canonicalization
 * sorts object keys so logically-equal requests always hash identically and
 * different requests (different tier/prompt/budget) hash differently.
 */
export function fingerprint(req: CompleteRequest): string {
  const canonical = canonicalize({
    tier: req.tier,
    prompt: { system: req.prompt.system ?? null, user: req.prompt.user },
    budget: req.budget,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Deterministically serialize a JSON-compatible value with object keys sorted. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
  return `{${parts.join(",")}}`;
}

/** Construction dependencies for {@link RecordReplayAiGmClient}. */
export interface RecordReplayDeps {
  /** The underlying provider client to wrap. */
  delegate: AiGmClient;
  /** The active mode. Defaults to `"off"` (pure passthrough). */
  mode?: RecordReplayMode;
  /** The corpus to record into / replay from. Required for record + replay. */
  corpus?: CorpusStore;
  /**
   * In `"replay"` mode, when `true`, a corpus miss falls back to the delegate
   * (and records the result if a corpus is present). When `false` (default), a
   * miss throws {@link CorpusMissError} so regression gaps are flagged.
   */
  fallbackToDelegateOnMiss?: boolean;
  /** Optional QA event sink; when set, `ai_call` + `ai_output` events are emitted. */
  sink?: EventSink;
  /** Optional correlation (sessionId / roundNo) stamped on emitted events. */
  correlation?: CorrelationKey;
  /** Optional deterministic envelope generators (for tests). */
  generators?: EnvelopeGenerators;
}

/** Default correlation used when none is supplied but a sink is present. */
const DEFAULT_CORRELATION: CorrelationKey = { sessionId: "", roundNo: 0 };

/**
 * An {@link AiGmClient} that wraps a delegate client with record/replay
 * behaviour. See the module doc for the per-mode contract.
 */
export class RecordReplayAiGmClient implements AiGmClient {
  private readonly delegate: AiGmClient;
  private readonly mode: RecordReplayMode;
  private readonly corpus: CorpusStore | undefined;
  private readonly fallbackToDelegateOnMiss: boolean;
  private readonly sink: EventSink | undefined;
  private readonly correlation: CorrelationKey;
  private readonly generators: EnvelopeGenerators | undefined;

  constructor(deps: RecordReplayDeps) {
    this.delegate = deps.delegate;
    this.mode = deps.mode ?? "off";
    this.corpus = deps.corpus;
    this.fallbackToDelegateOnMiss = deps.fallbackToDelegateOnMiss ?? false;
    this.sink = deps.sink;
    this.correlation = deps.correlation ?? DEFAULT_CORRELATION;
    this.generators = deps.generators;

    if (this.mode === "record" && !this.corpus) {
      throw new Error('RecordReplayAiGmClient: mode "record" requires a corpus');
    }
    if (this.mode === "replay" && !this.corpus) {
      throw new Error('RecordReplayAiGmClient: mode "replay" requires a corpus');
    }
  }

  async complete(req: CompleteRequest): Promise<AiResponse> {
    switch (this.mode) {
      case "off":
        return this.delegate.complete(req);
      case "record":
        return this.recordComplete(req);
      case "replay":
        return this.replayComplete(req);
    }
  }

  /** Passthrough to the delegate, capturing the interaction into the corpus. */
  private async recordComplete(req: CompleteRequest): Promise<AiResponse> {
    const response = await this.delegate.complete(req);
    this.capture(req, response);
    return response;
  }

  /**
   * Serve a recorded response by fingerprint without calling the delegate. On a
   * miss, either fall back to the delegate (recording the result) or throw
   * {@link CorpusMissError}.
   */
  private async replayComplete(req: CompleteRequest): Promise<AiResponse> {
    const fp = fingerprint(req);
    const recorded = this.corpus?.find(fp);
    if (recorded !== undefined) {
      this.emit(recorded);
      return recorded;
    }
    if (this.fallbackToDelegateOnMiss) {
      const response = await this.delegate.complete(req);
      this.capture(req, response);
      return response;
    }
    throw new CorpusMissError(fp, req);
  }

  /** Append the interaction to the corpus and emit QA events. */
  private capture(req: CompleteRequest, response: AiResponse): void {
    this.corpus?.append({ fingerprint: fingerprint(req), request: req, response });
    this.emit(response);
  }

  /** Best-effort, non-blocking `ai_call` + `ai_output` emission. Never throws. */
  private emit(response: AiResponse): void {
    if (!this.sink) return;
    try {
      this.sink.emit(
        makeAiCallEvent(
          this.correlation,
          { model: response.model, usage: response.usage },
          this.generators,
        ),
      );
      this.sink.emit(
        makeAiOutputEvent(
          this.correlation,
          { rawOutput: response.text, validationPassed: true },
          this.generators,
        ),
      );
    } catch {
      // Instrumentation is best-effort; never let it affect the call result.
    }
  }
}

/**
 * Convenience factory mirroring {@link RecordReplayAiGmClient}. Returns the bare
 * delegate when mode is `"off"` and no instrumentation is requested, so the
 * default path adds zero wrapping in production.
 */
export function createRecordReplayClient(deps: RecordReplayDeps): AiGmClient {
  if ((deps.mode ?? "off") === "off" && !deps.sink) {
    return deps.delegate;
  }
  return new RecordReplayAiGmClient(deps);
}
