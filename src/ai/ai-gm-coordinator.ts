/**
 * AI GM Coordinator — the trust boundary between the authoritative engine and
 * the untrusted, non-deterministic narration service.
 *
 * The coordinator mediates every AI interaction and enforces the engine's three
 * hard guarantees (design.md "AI GM Coordinator"):
 *
 *  1. **Server-side randomness.** For a round resolution the model only chooses
 *     *which* checks apply and at *what difficulty*; it never produces the
 *     random value. The coordinator calls the {@link DiceService} per proposed
 *     check, maps the roll through EZFudge {@link resolveCheck}, and only then
 *     hands the resolved {@link OutcomeGrade}s to the model for narration. Checks
 *     are therefore always resolved BEFORE narration (Requirements 10.6, 11.1,
 *     11.2, 11.4).
 *  2. **Korean-native, fail-loud output.** Narration responses are validated to
 *     be Korean via an injectable {@link LanguageDetector}. A non-Korean
 *     response is WITHHELD and reported as a failure — never silently
 *     substituted with another language (Requirement 14.4).
 *  3. **Bounded retries with state preservation.** A failed request is retried
 *     up to `config.aiMaxRetries` additional times (3 total by default),
 *     stopping immediately on success (Requirement 17.1). When retries are
 *     exhausted the coordinator reports an error and returns the caller's
 *     Turn_State unchanged except for a cleared `resolutionRequested` flag, so
 *     the round's recorded actions/passes are never lost or partially mutated
 *     (Requirements 17.2, 17.4).
 *
 * Two QA events are emitted best-effort: a `state_mutation` event capturing the
 * AI-proposed diff vs. the diff the engine actually applied (so hallucinations
 * are detectable, Requirement 18.5), and an `ai_output` event capturing the raw
 * model output BEFORE parsing/validation plus the schema/language validation
 * result (so validation failures can be reproduced, Requirement 18.6). The
 * per-call `ai_call` event is emitted by the {@link AiGmRouter}.
 *
 * Requirements: 4.2, 5.2, 10.1, 10.6, 11.1, 11.2, 11.4, 14.4, 15.1, 15.2, 17.1,
 * 17.2, 17.4, 18.5, 18.6.
 */
import { resolveCheck } from "../core/ezfudge.js";
import type {
  AttributeKey,
  AttributeLevel,
  DifficultyGrade,
  EngineConfig,
  OutcomeGrade,
} from "../core/types.js";
import type { CheckRecord, TurnState } from "../core/turn-state.js";
import type { DiceService } from "../core/dice.js";
import {
  makeAiOutputEvent,
  makeStateMutationEvent,
  type CorrelationKey,
  type EnvelopeGenerators,
  type StateChange,
} from "../observability/events.js";
import type { EventSink } from "../observability/event-sink.js";
import {
  toContext,
  type ContextScenario,
  type TurnStateContext,
} from "../services/turn-state-context.js";
import type { Character } from "../services/types.js";
import type { Prompt } from "./ai-gm-client.js";
import type { AiGmRouter } from "./ai-gm-router.js";

/** The four EZFudge attribute keys, used for completeness validation. */
const ATTRIBUTE_KEYS: readonly AttributeKey[] = ["Might", "Agility", "Wits", "Spirit"];
/** Valid difficulty grades, used to validate AI-proposed checks. */
const DIFFICULTY_GRADES: readonly DifficultyGrade[] = [
  "Trivial",
  "Easy",
  "Average",
  "Hard",
  "Formidable",
];

/** Korean (and structured-but-Korean) narration text. */
export type Narration = string;

/** A complete EZFudge attribute set proposed for a character (Requirement 4.2). */
export type AttributeSet = Record<AttributeKey, AttributeLevel>;

/** The end-of-session recap produced by the AI GM (Requirements 15.2, 15.3). */
export interface SessionSummary {
  /** The Korean summary text of the session's key events. */
  text: string;
}

/**
 * A difficulty check the AI GM proposes for a character this round. The AI
 * chooses the character, the relevant attribute, and the difficulty — but NEVER
 * the random value (Requirement 11.1).
 */
export interface CheckRequest {
  /** The acting character, by name as seen in the {@link TurnStateContext}. */
  characterName: string;
  /** The relevant attribute for the check. */
  attribute: AttributeKey;
  /** The difficulty grade chosen by the AI. */
  difficulty: DifficultyGrade;
}

/**
 * A {@link LanguageDetector} answers "is this text Korean?". Injectable at the
 * boundary so tests can deterministically control the verdict; the default is
 * {@link containsHangul} (Requirement 14.4).
 */
export type LanguageDetector = (text: string) => boolean;

/**
 * Default language detector: a simple Hangul-presence heuristic. Returns `true`
 * when the text contains any Hangul syllable or jamo codepoint. This is a
 * heuristic, not a full language classifier — it is sufficient to catch a model
 * answering in the wrong language (Requirement 14.4).
 */
export const containsHangul: LanguageDetector = (text: string): boolean =>
  /[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7a3\ud7b0-\ud7ff]/.test(text);

/** Why an AI GM request failed after exhausting retries. */
export type AiFailureReason =
  /** The model answered in a non-Korean language (withheld, never substituted). */
  | "non_korean"
  /** The model output could not be parsed/validated against the expected schema. */
  | "invalid_schema"
  /** The underlying AI request threw / failed to return a response. */
  | "ai_request_failed"
  /** The Dice_Service failed to produce a result for a requested check. */
  | "dice_failed";

/** A reported AI GM failure (Requirements 14.4, 17.2). */
export interface AiGmError {
  reason: AiFailureReason;
  message: string;
}

/** Result of a generation request that yields a single value. */
export type GenerationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AiGmError };

/** Inputs needed to resolve a round (the coordinator builds the context itself). */
export interface ResolveRoundInput {
  /** The current Turn_State for the round being resolved. */
  state: TurnState;
  /** Scenario grounding for the room. */
  scenario: ContextScenario;
  /** The room's characters, used for action attribution and attribute lookup. */
  characters: readonly Character[];
  /** Optional token budget passed to context derivation (Requirement 16.3). */
  budget?: number;
}

/**
 * Outcome of {@link AiGmCoordinator.resolveRound}.
 *
 * On success the caller receives the Korean narration, the server-resolved
 * checks to record in Turn_State (Requirement 11.5), whether the ending was
 * reached, and the exact context handed to the model. On failure the caller
 * receives the error and a `preservedState` equal to the input state with only
 * `resolutionRequested` cleared, so the round can be retried without losing the
 * recorded actions/passes (Requirements 17.2, 17.4).
 */
export type ResolveRoundResult =
  | {
      ok: true;
      narration: Narration;
      checks: CheckRecord[];
      endingReached: boolean;
      context: TurnStateContext;
    }
  | { ok: false; error: AiGmError; preservedState: TurnState };

/** Construction dependencies for {@link AiGmCoordinator}. */
export interface AiGmCoordinatorDeps {
  /** Tier router that dispatches completions and emits `ai_call` events. */
  router: AiGmRouter;
  /** Server-side dice source for resolving checks (randomness stays here). */
  dice: DiceService;
  /** Engine config; supplies the retry bound (`aiMaxRetries`). */
  config: EngineConfig;
  /** Correlation stamped on the coordinator's own QA events. */
  correlation?: CorrelationKey;
  /** Optional QA sink for `ai_output` / `state_mutation` events. */
  sink?: EventSink;
  /** Optional deterministic envelope generators (for tests). */
  generators?: EnvelopeGenerators;
  /** Language detector at the boundary; defaults to {@link containsHangul}. */
  detectKorean?: LanguageDetector;
}

/** A parsed-and-validated result, or a structured validation failure. */
type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; reason: AiFailureReason; message: string };

/** Internal: outcome of a single policy-wrapped request (retry + validation). */
type RequestOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: AiGmError };

const DEFAULT_CORRELATION: CorrelationKey = { sessionId: "", roundNo: 0 };

/**
 * The AI GM Coordinator. Stateless across calls aside from its injected
 * dependencies; every method is independently retried and validated.
 */
export class AiGmCoordinator {
  private readonly router: AiGmRouter;
  private readonly dice: DiceService;
  private readonly config: EngineConfig;
  private readonly correlation: CorrelationKey;
  private readonly sink: EventSink | undefined;
  private readonly generators: EnvelopeGenerators | undefined;
  private readonly detectKorean: LanguageDetector;

  constructor(deps: AiGmCoordinatorDeps) {
    this.router = deps.router;
    this.dice = deps.dice;
    this.config = deps.config;
    this.correlation = deps.correlation ?? DEFAULT_CORRELATION;
    this.sink = deps.sink;
    this.generators = deps.generators;
    this.detectKorean = deps.detectKorean ?? containsHangul;
  }

  /**
   * Generate the opening narration for the session from the scenario
   * (Requirement 5.2). Subject to the Korean-validation + retry policy.
   */
  async generateOpening(
    ctx: TurnStateContext,
    correlation?: CorrelationKey,
  ): Promise<GenerationResult<Narration>> {
    const prompt = buildOpeningPrompt(ctx);
    const outcome = await this.runRequest(
      "opening",
      prompt,
      (raw) => this.parseNarration(raw),
      correlation ?? this.correlationFor(ctx),
    );
    return outcome;
  }

  /**
   * Propose a complete EZFudge attribute set for a character concept
   * (Requirement 4.2). Subject to the same retry policy; the response is
   * schema-validated for a complete attribute set rather than Korean text.
   */
  async proposeAttributes(
    concept: string,
    scenario: ContextScenario,
    correlation?: CorrelationKey,
  ): Promise<GenerationResult<AttributeSet>> {
    const prompt = buildAttributesPrompt(concept, scenario);
    return this.runRequest(
      "attributes",
      prompt,
      (raw) => parseAttributes(raw),
      correlation ?? this.correlation,
    );
  }

  /**
   * Generate the closing narration and Session_Summary at the end of the
   * one-shot (Requirements 15.1, 15.2). Subject to the Korean-validation +
   * retry policy on both the closing narration and the summary.
   */
  async generateEnding(
    ctx: TurnStateContext,
    correlation?: CorrelationKey,
  ): Promise<GenerationResult<{ closing: Narration; summary: SessionSummary }>> {
    const prompt = buildEndingPrompt(ctx);
    return this.runRequest(
      "ending",
      prompt,
      (raw) => this.parseEnding(raw),
      correlation ?? this.correlationFor(ctx),
    );
  }

  /**
   * Resolve a round: ask the model which checks apply, roll them server-side,
   * map via EZFudge, then ask the model to narrate the resolved outcomes
   * (Requirements 10.1, 10.6, 11.1, 11.2, 11.4).
   *
   * The context handed to the model always contains an action entry for every
   * active player (it is derived via {@link toContext} from the readiness rows).
   * Dice are always drawn from the {@link DiceService}; the model never supplies
   * the random value. On any failure the round's recorded actions/passes are
   * preserved (Requirements 17.2, 17.4) and a `state_mutation` event records the
   * AI-proposed vs. engine-applied diff (Requirement 18.5).
   */
  async resolveRound(input: ResolveRoundInput): Promise<ResolveRoundResult> {
    const { state, scenario, characters, budget } = input;
    const context = toContext(state, scenario, characters, budget);
    const correlation: CorrelationKey = {
      sessionId: state.roomId,
      roundNo: state.roundNumber,
    };
    const preservedState = (): TurnState => ({ ...state, resolutionRequested: false });

    // Step 1 — ask the model which checks apply and at what difficulty.
    const selection = await this.runRequest(
      "resolution",
      buildCheckSelectionPrompt(context),
      (raw) => parseCheckSelection(raw),
      correlation,
    );
    if (!selection.ok) {
      return { ok: false, error: selection.error, preservedState: preservedState() };
    }

    // Step 2 — resolve every proposed check SERVER-SIDE, before narration.
    // The roll always comes from the Dice_Service; the AI never supplies it.
    const attributeByCharacter = new Map(
      context.characters.map((c) => [c.name, c.attributes] as const),
    );
    const resolved: CheckRecord[] = [];
    for (const check of selection.value.checks) {
      const attributes = attributeByCharacter.get(check.characterName);
      // Drop hallucinated checks (unknown character/attribute): they remain in
      // the proposed diff but never in the applied diff (Requirement 18.5).
      if (!attributes) continue;
      const level = attributes[check.attribute];
      if (level === undefined) continue;

      const roll = this.dice.tryRoll();
      if (!roll.ok) {
        // Dice failure: withhold the affected resolution (Requirement 17.3-style).
        this.emitStateMutation(correlation, selection.value, resolved);
        return {
          ok: false,
          error: { reason: "dice_failed", message: roll.error.message },
          preservedState: preservedState(),
        };
      }
      resolved.push({
        characterId: check.characterName,
        attribute: check.attribute,
        difficulty: check.difficulty,
        roll: roll.value,
        outcome: resolveCheck(level, check.difficulty, roll.value),
      });
    }

    // Step 3 — narrate using the already-resolved outcomes.
    const narrationOutcome = await this.runRequest(
      "resolution",
      buildNarrationPrompt(context, resolved),
      (raw) => this.parseResolutionNarration(raw),
      correlation,
    );

    // Record the proposed-vs-applied diff regardless of narration outcome.
    this.emitStateMutation(correlation, selection.value, resolved, narrationOutcome.ok
      ? narrationOutcome.value.stateChanges
      : []);

    if (!narrationOutcome.ok) {
      return { ok: false, error: narrationOutcome.error, preservedState: preservedState() };
    }

    return {
      ok: true,
      narration: narrationOutcome.value.narration,
      checks: resolved,
      endingReached: narrationOutcome.value.endingReached,
      context,
    };
  }

  /**
   * Run a single AI request under the retry + validation policy: up to
   * `aiMaxRetries` additional attempts (3 total by default), stopping
   * immediately on the first valid response (Requirement 17.1). Each attempt
   * emits an `ai_output` event with the raw output and the validation result
   * (Requirement 18.6).
   */
  private async runRequest<T>(
    requestType: Parameters<AiGmRouter["complete"]>[0],
    prompt: Prompt,
    parse: (raw: string) => Validated<T>,
    correlation: CorrelationKey,
    budget?: number,
  ): Promise<RequestOutcome<T>> {
    const maxAttempts = Math.max(1, this.config.aiMaxRetries + 1);
    let lastError: AiGmError = {
      reason: "ai_request_failed",
      message: "AI request did not run",
    };

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let raw: string;
      try {
        const response = await this.router.complete(requestType, prompt, budget);
        raw = response.text;
      } catch (err) {
        lastError = {
          reason: "ai_request_failed",
          message: err instanceof Error ? err.message : String(err),
        };
        this.emitAiOutput(correlation, "", false, lastError.message);
        continue;
      }

      const validated = parse(raw);
      if (validated.ok) {
        this.emitAiOutput(correlation, raw, true);
        return { ok: true, value: validated.value };
      }

      lastError = { reason: validated.reason, message: validated.message };
      this.emitAiOutput(correlation, raw, false, validated.message);
    }

    return { ok: false, error: lastError };
  }

  /** Validate that a plain narration response is non-empty Korean text. */
  private parseNarration(raw: string): Validated<Narration> {
    const parsed = parseJson(raw);
    if (!parsed.ok) return parsed;
    const obj = parsed.value;
    const narration = readString(obj, "narration");
    if (narration === undefined || narration.trim().length === 0) {
      return invalidSchema("response is missing a non-empty 'narration' field");
    }
    if (!this.detectKorean(narration)) {
      return notKorean();
    }
    return { ok: true, value: narration };
  }

  /** Validate the round-resolution narration response (Korean + flags + diff). */
  private parseResolutionNarration(raw: string): Validated<{
    narration: Narration;
    endingReached: boolean;
    stateChanges: StateChange[];
  }> {
    const parsed = parseJson(raw);
    if (!parsed.ok) return parsed;
    const obj = parsed.value;
    const narration = readString(obj, "narration");
    if (narration === undefined || narration.trim().length === 0) {
      return invalidSchema("response is missing a non-empty 'narration' field");
    }
    if (!this.detectKorean(narration)) {
      return notKorean();
    }
    const endingReached = obj["endingReached"] === true;
    const stateChanges = readStateChanges(obj["stateChanges"]);
    return { ok: true, value: { narration, endingReached, stateChanges } };
  }

  /** Validate the ending response: Korean closing narration + Korean summary. */
  private parseEnding(
    raw: string,
  ): Validated<{ closing: Narration; summary: SessionSummary }> {
    const parsed = parseJson(raw);
    if (!parsed.ok) return parsed;
    const obj = parsed.value;
    const closing = readString(obj, "closing");
    const summary = readString(obj, "summary");
    if (
      closing === undefined ||
      closing.trim().length === 0 ||
      summary === undefined ||
      summary.trim().length === 0
    ) {
      return invalidSchema("ending response requires non-empty 'closing' and 'summary'");
    }
    if (!this.detectKorean(closing) || !this.detectKorean(summary)) {
      return notKorean();
    }
    return { ok: true, value: { closing, summary: { text: summary } } };
  }

  /** Best-effort `ai_output` emission. Never throws into game flow. */
  private emitAiOutput(
    correlation: CorrelationKey,
    rawOutput: string,
    validationPassed: boolean,
    failureReason?: string,
  ): void {
    if (!this.sink) return;
    try {
      this.sink.emit(
        makeAiOutputEvent(
          correlation,
          failureReason === undefined
            ? { rawOutput, validationPassed }
            : { rawOutput, validationPassed, failureReason },
          this.generators,
        ),
      );
    } catch {
      // Instrumentation is best-effort.
    }
  }

  /**
   * Best-effort `state_mutation` emission capturing the AI-proposed diff vs. the
   * diff the engine actually applied (Requirement 18.5).
   */
  private emitStateMutation(
    correlation: CorrelationKey,
    selection: CheckSelection,
    appliedChecks: CheckRecord[],
    proposedStateChanges: StateChange[] = [],
  ): void {
    if (!this.sink) return;
    try {
      this.sink.emit(
        makeStateMutationEvent(
          correlation,
          {
            proposedDiff: {
              checks: selection.checks,
              stateChanges: [...selection.stateChanges, ...proposedStateChanges],
            },
            appliedDiff: { checks: appliedChecks },
          },
          this.generators,
        ),
      );
    } catch {
      // Instrumentation is best-effort.
    }
  }

  /** Correlation derived from a context, falling back to the base correlation. */
  private correlationFor(ctx: TurnStateContext): CorrelationKey {
    return { sessionId: ctx.roomId, roundNo: ctx.roundNumber };
  }
}

/** Internal shape of a parsed check-selection response. */
interface CheckSelection {
  checks: CheckRequest[];
  stateChanges: StateChange[];
}

// ---------------------------------------------------------------------------
// Parsing / validation helpers (pure)
// ---------------------------------------------------------------------------

/** Parse JSON into an object, or report an invalid-schema failure. */
function parseJson(raw: string): Validated<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return invalidSchema("response is not valid JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidSchema("response JSON must be an object");
  }
  return { ok: true, value: value as Record<string, unknown> };
}

/** Read a string field from an object, or `undefined` when absent/non-string. */
function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

/** Coerce an unknown value into a {@link StateChange} array (best-effort). */
function readStateChanges(value: unknown): StateChange[] {
  if (!Array.isArray(value)) return [];
  const changes: StateChange[] = [];
  for (const entry of value) {
    if (typeof entry === "object" && entry !== null && "target" in entry) {
      const e = entry as Record<string, unknown>;
      if (typeof e["target"] === "string") {
        changes.push({ target: e["target"], from: e["from"], to: e["to"] });
      }
    }
  }
  return changes;
}

/** Parse + validate a complete attribute set (Requirement 4.2). */
function parseAttributes(raw: string): Validated<AttributeSet> {
  const parsed = parseJson(raw);
  if (!parsed.ok) return parsed;
  const attrs = parsed.value["attributes"];
  if (typeof attrs !== "object" || attrs === null || Array.isArray(attrs)) {
    return invalidSchema("attributes response requires an 'attributes' object");
  }
  const source = attrs as Record<string, unknown>;
  const result = {} as AttributeSet;
  for (const key of ATTRIBUTE_KEYS) {
    const level = source[key];
    if (typeof level !== "number" || !Number.isFinite(level)) {
      return invalidSchema(`attribute '${key}' is missing or not a finite number`);
    }
    result[key] = level;
  }
  return { ok: true, value: result };
}

/** Parse + validate the AI's proposed check selection for a round. */
function parseCheckSelection(raw: string): Validated<CheckSelection> {
  const parsed = parseJson(raw);
  if (!parsed.ok) return parsed;
  const rawChecks = parsed.value["checks"];
  if (!Array.isArray(rawChecks)) {
    return invalidSchema("check-selection response requires a 'checks' array");
  }
  const checks: CheckRequest[] = [];
  for (const entry of rawChecks) {
    if (typeof entry !== "object" || entry === null) {
      return invalidSchema("each check must be an object");
    }
    const e = entry as Record<string, unknown>;
    const characterName = e["characterName"];
    const attribute = e["attribute"];
    const difficulty = e["difficulty"];
    if (typeof characterName !== "string") {
      return invalidSchema("check 'characterName' must be a string");
    }
    if (typeof attribute !== "string" || !ATTRIBUTE_KEYS.includes(attribute as AttributeKey)) {
      return invalidSchema(`check 'attribute' must be one of ${ATTRIBUTE_KEYS.join(", ")}`);
    }
    if (
      typeof difficulty !== "string" ||
      !DIFFICULTY_GRADES.includes(difficulty as DifficultyGrade)
    ) {
      return invalidSchema(`check 'difficulty' must be one of ${DIFFICULTY_GRADES.join(", ")}`);
    }
    checks.push({
      characterName,
      attribute: attribute as AttributeKey,
      difficulty: difficulty as DifficultyGrade,
    });
  }
  return {
    ok: true,
    value: { checks, stateChanges: readStateChanges(parsed.value["stateChanges"]) },
  };
}

/** Build an `invalid_schema` validation failure. */
function invalidSchema(message: string): Validated<never> {
  return { ok: false, reason: "invalid_schema", message };
}

/** Build a `non_korean` validation failure (Requirement 14.4). */
function notKorean(): Validated<never> {
  return {
    ok: false,
    reason: "non_korean",
    message: "AI narration was not Korean; withholding rather than substituting a language",
  };
}

// ---------------------------------------------------------------------------
// Prompt builders (provider-neutral)
// ---------------------------------------------------------------------------

const GM_SYSTEM =
  "You are the Game Master for a Korean-language TRPG one-shot. " +
  "Always narrate in natural Korean. Respond with a single JSON object only.";

/** Opening narration prompt (Requirement 5.2). */
function buildOpeningPrompt(ctx: TurnStateContext): Prompt {
  return {
    system: GM_SYSTEM,
    user:
      "PHASE: opening\n" +
      "Write the opening narration in Korean for this scenario and party.\n" +
      'Respond as {"narration": "<korean text>"}.\n' +
      `CONTEXT: ${JSON.stringify({ scenario: ctx.scenario, characters: ctx.characters })}`,
  };
}

/** Attribute proposal prompt (Requirement 4.2). */
function buildAttributesPrompt(concept: string, scenario: ContextScenario): Prompt {
  return {
    system: GM_SYSTEM,
    user:
      "PHASE: attributes\n" +
      "Propose a complete EZFudge attribute set (Might, Agility, Wits, Spirit) as integers.\n" +
      'Respond as {"attributes": {"Might": <int>, "Agility": <int>, "Wits": <int>, "Spirit": <int>}}.\n' +
      `CONCEPT: ${concept}\nSCENARIO: ${JSON.stringify(scenario)}`,
  };
}

/** Round check-selection prompt: which checks apply, at what difficulty (R11.1). */
function buildCheckSelectionPrompt(ctx: TurnStateContext): Prompt {
  return {
    system: GM_SYSTEM,
    user:
      "PHASE: check-selection\n" +
      "Decide which difficulty checks apply this round. Choose the acting character, " +
      "the relevant attribute, and the difficulty. Do NOT produce any dice or random values.\n" +
      'Respond as {"checks": [{"characterName": "<name>", "attribute": "<Might|Agility|Wits|Spirit>", ' +
      '"difficulty": "<Trivial|Easy|Average|Hard|Formidable>"}], "stateChanges": []}.\n' +
      `CONTEXT: ${JSON.stringify({ roundNumber: ctx.roundNumber, actions: ctx.thisRound.actions })}`,
  };
}

/** Round narration prompt: narrate using the already-resolved outcomes (R10.6, 11.4). */
function buildNarrationPrompt(ctx: TurnStateContext, resolved: readonly CheckRecord[]): Prompt {
  return {
    system: GM_SYSTEM,
    user:
      "PHASE: narration\n" +
      "Narrate the round's combined outcome in Korean using ONLY the resolved outcomes below.\n" +
      'Respond as {"narration": "<korean text>", "endingReached": <bool>, "stateChanges": []}.\n' +
      `ACTIONS: ${JSON.stringify(ctx.thisRound.actions)}\n` +
      `RESOLVED_CHECKS: ${JSON.stringify(resolved)}`,
  };
}

/** Ending prompt: closing narration + Session_Summary (Requirements 15.1, 15.2). */
function buildEndingPrompt(ctx: TurnStateContext): Prompt {
  return {
    system: GM_SYSTEM,
    user:
      "PHASE: ending\n" +
      "Write the closing narration and a concise session summary, both in Korean.\n" +
      'Respond as {"closing": "<korean text>", "summary": "<korean text>"}.\n' +
      `CONTEXT: ${JSON.stringify({ scenario: ctx.scenario, recentNarrative: ctx.recentNarrative })}`,
  };
}

/** Re-export for callers building outcome grades from resolved checks. */
export type { OutcomeGrade };
