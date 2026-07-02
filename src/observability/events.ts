/**
 * QA event model — the structured, JSON-serializable events emitted by the
 * engine for quality-assurance, replay, and cost/latency analysis.
 *
 * Every event shares a common **correlation envelope** ({@link EventEnvelope})
 * so any event can be tied back to a session, a round, and an ordering. On top
 * of the envelope sit structured payloads, modelled as a discriminated
 * union on `eventType` ({@link QaEvent}):
 *
 *  - `dice_roll`      — a server-side roll, including the recorded `seed` for replay.
 *  - `state_mutation` — the AI-proposed change vs. the change the engine applied
 *                       (for detecting AI hallucination).
 *  - `ai_call`        — model name and verbatim provider token usage.
 *  - `round_timing`   — all-ready vs. narration-returned timestamps and latency.
 *  - `ai_output`      — the raw AI output before parsing plus schema validation result.
 *  - `gm_procedure`   — deterministic GM procedure hints and narration critique.
 *
 * This module carries no transport/AI/DB dependencies. Envelope construction
 * uses injectable generators ({@link EnvelopeGenerators}) so `eventId` and
 * `timestamp` are deterministic in tests.
 *
 * Requirements: 18.1, 18.2 (and supports 18.3–18.6 payload shapes).
 */
import { createHash, randomUUID } from "node:crypto";

/** QA event categories, used as the discriminant on {@link QaEvent}. */
export type QaEventType =
  | "dice_roll"
  | "state_mutation"
  | "ai_call"
  | "round_timing"
  | "ai_output"
  | "gm_procedure";

/**
 * The common correlation envelope shared by every QA event. These fields let a
 * consumer group and time-order events per session and per round (Requirement
 * 18.1, 18.2).
 */
export interface EventEnvelope {
  /** The room/session this event belongs to. */
  sessionId: string;
  /** The round number this event was produced in. */
  roundNo: number;
  /** Unique identifier for this event. */
  eventId: string;
  /** ISO-8601 timestamp of when the event was produced. */
  timestamp: string;
  /** Discriminant identifying the payload shape. */
  eventType: QaEventType;
}

/** Just the correlation inputs a caller supplies; the rest is generated. */
export interface CorrelationKey {
  sessionId: string;
  roundNo: number;
}

/**
 * Injectable generators for the envelope's non-correlation fields. Defaults to
 * a random UUID and the wall clock; overridden in tests for determinism.
 */
export interface EnvelopeGenerators {
  /** Produce a unique event id. */
  generateId: () => string;
  /** Produce the "now" instant used for the timestamp. */
  now: () => Date;
}

/** Default generators: CSPRNG-backed UUID id and wall-clock time. */
export const defaultEnvelopeGenerators: EnvelopeGenerators = {
  generateId: () => randomUUID(),
  now: () => new Date(),
};

/**
 * `dice_roll` — a single server-side roll. Records the `seed` so the roll can
 * be replayed deterministically from `(seed, range)` (Requirement 18.3).
 */
export interface DiceRollEvent extends EventEnvelope {
  eventType: "dice_roll";
  /** Who/what requested the roll (server identity), never a client/AI. */
  roller: string;
  /** Human-readable dice expression / range descriptor, e.g. `uniform[-4,4]`. */
  expression: string;
  /** The inclusive integer range rolled over. */
  range: { min: number; max: number };
  /** The raw rolled value(s) before any resolution. */
  rawValues: number[];
  /** The resolved result handed to the engine. */
  result: number;
  /**
   * The seed used for the roll, for deterministic replay. `null` when an
   * external (injected) source produced the value and no seed is recoverable.
   */
  seed: number | null;
}

/** A single field-level change: where it happened and the before/after values. */
export interface StateChange {
  /** The mutated path/target, e.g. `character:abc.hp` or `inventory.potion`. */
  target: string;
  /** Value before the change. */
  from: unknown;
  /** Value after the change. */
  to: unknown;
}

/**
 * `state_mutation` — captures BOTH the AI-proposed change and the change the
 * engine actually applied, so AI hallucinations (invalid/absent changes) can
 * be detected (Requirement 18.5). Each diff is either a list of structured
 * field changes or an opaque JSON blob, so HP/item/etc. changes all fit.
 */
export interface StateMutationEvent extends EventEnvelope {
  eventType: "state_mutation";
  /** The change the AI proposed. */
  proposedDiff: StateChange[] | Record<string, unknown>;
  /** The change the engine actually applied. */
  appliedDiff: StateChange[] | Record<string, unknown>;
  /** The proposed deltas the engine rejected, when a reducer reports them separately. */
  rejectedDiff?: StateChange[] | Record<string, unknown>;
}

/**
 * Provider token usage, kept verbatim so no provider-specific fields are lost.
 * The four named fields are always present; additional provider fields are
 * preserved on the same object (Requirement 18.4).
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Passthrough for any extra provider-reported usage fields. */
  [extra: string]: unknown;
}

/** `ai_call` — the model invoked and its verbatim token usage (Requirement 18.4). */
export interface AiCallEvent extends EventEnvelope {
  eventType: "ai_call";
  /** The model name used for the call. */
  model: string;
  /** Verbatim provider usage passthrough. */
  usage: TokenUsage;
}

/**
 * `round_timing` — the moment all players were ready vs. when narration was
 * returned, plus the derived latency, for round-latency analysis (Requirement
 * 18.5 timing).
 */
export interface RoundTimingEvent extends EventEnvelope {
  eventType: "round_timing";
  /** ISO timestamp when all active players became ready. */
  allReadyAt: string;
  /** ISO timestamp when the GM narration was returned. */
  narrationReturnedAt: string;
  /** Derived latency in milliseconds between the two timestamps. */
  latencyMs: number;
}

/**
 * `ai_output` — the raw AI output BEFORE parsing/validation, plus whether
 * schema validation passed and (when it failed) why, so validation failures
 * can be reproduced (Requirement 18.6).
 */
export interface AiOutputEvent extends EventEnvelope {
  eventType: "ai_output";
  /**
   * The raw AI output before any parsing/validation, size-capped at
   * {@link MAX_RAW_OUTPUT_LENGTH} so unbounded model output never lands
   * verbatim in the durable QA store.
   */
  rawOutput: string;
  /** Present (true) only when `rawOutput` was truncated to the size cap. */
  rawOutputTruncated?: boolean;
  /** SHA-256 of the FULL raw output; present only when truncated. */
  rawOutputSha256?: string;
  /** Whether schema validation of the parsed output passed. */
  validationPassed: boolean;
  /** Why validation failed; present only on failure. */
  failureReason?: string;
}

/**
 * Durable raw-payload cap for `ai_output` events: enough to reproduce
 * validation failures, small enough that runaway output cannot bloat
 * `qa_events`/replay corpora. Truncated events keep a hash of the full
 * payload so integrity checks remain possible.
 */
export const MAX_RAW_OUTPUT_LENGTH = 8_000;

/** A procedure hint emitted by the server-side GM Procedure Layer. */
export interface GmProcedureHintPayload {
  id: string;
  priority: "high" | "medium" | "low";
  instruction: string;
  data?: Record<string, unknown>;
}

/** A single deterministic narration-critique warning. */
export interface GmProcedureCritiqueWarningPayload {
  code: string;
  message: string;
  detail?: string;
}

/** Result of a deterministic narration critique pass. */
export interface GmProcedureCritiquePayload {
  passed: boolean;
  warnings: GmProcedureCritiqueWarningPayload[];
}

/**
 * `gm_procedure` — records deterministic GM operating hints before the decision
 * prompt and deterministic critique output after narration. This stays separate
 * from `ai_output` (model validation) and `state_mutation` (diff auditing).
 */
export interface GmProcedureEvent extends EventEnvelope {
  eventType: "gm_procedure";
  phase: "planning" | "critique";
  hints?: GmProcedureHintPayload[];
  criticChecks?: string[];
  critique?: GmProcedureCritiquePayload;
}

/** The discriminated union of every QA event, keyed on `eventType`. */
export type QaEvent =
  | DiceRollEvent
  | StateMutationEvent
  | AiCallEvent
  | RoundTimingEvent
  | AiOutputEvent
  | GmProcedureEvent;

/** Payload of an event type with the envelope fields removed. */
export type PayloadOf<E extends QaEvent> = Omit<E, keyof EventEnvelope>;

/**
 * Build a fresh {@link EventEnvelope} for the given correlation and type,
 * generating `eventId` and `timestamp` via the (injectable) generators.
 */
export function buildEnvelope<T extends QaEventType>(
  correlation: CorrelationKey,
  eventType: T,
  generators: EnvelopeGenerators = defaultEnvelopeGenerators,
): EventEnvelope & { eventType: T } {
  return {
    sessionId: correlation.sessionId,
    roundNo: correlation.roundNo,
    eventId: generators.generateId(),
    timestamp: generators.now().toISOString(),
    eventType,
  };
}

/** Build a `dice_roll` event from its payload. */
export function makeDiceRollEvent(
  correlation: CorrelationKey,
  payload: PayloadOf<DiceRollEvent>,
  generators?: EnvelopeGenerators,
): DiceRollEvent {
  return { ...buildEnvelope(correlation, "dice_roll", generators), ...payload };
}

/** Build a `state_mutation` event from its payload. */
export function makeStateMutationEvent(
  correlation: CorrelationKey,
  payload: PayloadOf<StateMutationEvent>,
  generators?: EnvelopeGenerators,
): StateMutationEvent {
  return { ...buildEnvelope(correlation, "state_mutation", generators), ...payload };
}

/** Build an `ai_call` event from its payload. */
export function makeAiCallEvent(
  correlation: CorrelationKey,
  payload: PayloadOf<AiCallEvent>,
  generators?: EnvelopeGenerators,
): AiCallEvent {
  return { ...buildEnvelope(correlation, "ai_call", generators), ...payload };
}

/**
 * Build a `round_timing` event. `latencyMs` is derived from the two timestamps
 * when not supplied explicitly.
 */
export function makeRoundTimingEvent(
  correlation: CorrelationKey,
  payload: { allReadyAt: string; narrationReturnedAt: string; latencyMs?: number },
  generators?: EnvelopeGenerators,
): RoundTimingEvent {
  const latencyMs =
    payload.latencyMs ?? Date.parse(payload.narrationReturnedAt) - Date.parse(payload.allReadyAt);
  return {
    ...buildEnvelope(correlation, "round_timing", generators),
    allReadyAt: payload.allReadyAt,
    narrationReturnedAt: payload.narrationReturnedAt,
    latencyMs,
  };
}

/**
 * Build an `ai_output` event. `failureReason` is included only when provided
 * (honouring `exactOptionalPropertyTypes`).
 */
export function makeAiOutputEvent(
  correlation: CorrelationKey,
  payload: { rawOutput: string; validationPassed: boolean; failureReason?: string },
  generators?: EnvelopeGenerators,
): AiOutputEvent {
  const event: AiOutputEvent = {
    ...buildEnvelope(correlation, "ai_output", generators),
    rawOutput: payload.rawOutput,
    validationPassed: payload.validationPassed,
  };
  // Size cap: never persist unbounded raw model output. The full payload's
  // hash is kept so a truncated event can still be integrity-checked.
  if (payload.rawOutput.length > MAX_RAW_OUTPUT_LENGTH) {
    event.rawOutput = payload.rawOutput.slice(0, MAX_RAW_OUTPUT_LENGTH);
    event.rawOutputTruncated = true;
    event.rawOutputSha256 = createHash("sha256").update(payload.rawOutput).digest("hex");
  }
  if (payload.failureReason !== undefined) {
    event.failureReason = payload.failureReason;
  }
  return event;
}

/** Build a `gm_procedure` event. Optional sections are omitted when absent. */
export function makeGmProcedureEvent(
  correlation: CorrelationKey,
  payload: PayloadOf<GmProcedureEvent>,
  generators?: EnvelopeGenerators,
): GmProcedureEvent {
  const event: GmProcedureEvent = {
    ...buildEnvelope(correlation, "gm_procedure", generators),
    phase: payload.phase,
  };
  if (payload.hints !== undefined) event.hints = payload.hints;
  if (payload.criticChecks !== undefined) event.criticChecks = payload.criticChecks;
  if (payload.critique !== undefined) event.critique = payload.critique;
  return event;
}
