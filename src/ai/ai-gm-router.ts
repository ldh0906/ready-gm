/**
 * Model-tier routing for AI GM requests.
 *
 * Each AI {@link RequestType} (opening / attributes / resolution / ending) is
 * routed to its configured model tier from {@link EngineConfig.modelTiers}, and
 * its token budget is taken from {@link EngineConfig.tokenBudgets}. The router
 * is the small coordinator piece that, given a request type, resolves the tier
 * and calls the {@link AiGmClient} with it (design.md "AI GM Coordinator",
 * Requirement 16.2).
 *
 * As a side effect, the router emits one `ai_call` QA event per call via an
 * optional {@link EventSink}, carrying the model name and the provider token
 * usage verbatim (Requirement 18.4). Emission is best-effort and non-blocking:
 * it never throws and never alters the completion result. The fuller
 * coordinator behaviour (resolveRound, Korean validation, retries) is layered
 * on later tasks; this module owns only routing + instrumentation.
 */
import type { EngineConfig, RequestType } from "../core/types.js";
import {
  makeAiCallEvent,
  type CorrelationKey,
  type EnvelopeGenerators,
} from "../observability/events.js";
import type { EventSink } from "../observability/event-sink.js";
import type { AiGmClient, AiResponse, Prompt, TokenBudget } from "./ai-gm-client.js";

/** Construction dependencies for {@link AiGmRouter}. */
export interface AiGmRouterDeps {
  /** The provider-agnostic client to dispatch completions to. */
  client: AiGmClient;
  /** Engine config providing the per-request-type tier + token budget. */
  config: EngineConfig;
  /** Optional QA event sink; when set, an `ai_call` event is emitted per call. */
  sink?: EventSink;
  /** Optional correlation (sessionId / roundNo) stamped on emitted events. */
  correlation?: CorrelationKey;
  /** Optional deterministic envelope generators (for tests). */
  generators?: EnvelopeGenerators;
}

/** Default correlation used when none is supplied but a sink is present. */
const DEFAULT_CORRELATION: CorrelationKey = { sessionId: "", roundNo: 0 };

/**
 * Routes AI requests to their configured model tier and instruments each call.
 */
export class AiGmRouter {
  private readonly client: AiGmClient;
  private readonly config: EngineConfig;
  private readonly sink: EventSink | undefined;
  private readonly correlation: CorrelationKey;
  private readonly generators: EnvelopeGenerators | undefined;

  constructor(deps: AiGmRouterDeps) {
    this.client = deps.client;
    this.config = deps.config;
    this.sink = deps.sink;
    this.correlation = deps.correlation ?? DEFAULT_CORRELATION;
    this.generators = deps.generators;
  }

  /** The model tier configured for a request type (Requirement 16.2). */
  tierFor(requestType: RequestType): EngineConfig["modelTiers"][RequestType] {
    return this.config.modelTiers[requestType];
  }

  /** The token budget configured for a request type (Requirement 16.3). */
  budgetFor(requestType: RequestType): TokenBudget {
    return this.config.tokenBudgets[requestType];
  }

  /**
   * Resolve the tier + budget for `requestType` and run the completion. An
   * explicit `budget` overrides the configured token budget. After the call
   * returns, a best-effort `ai_call` event (model + usage verbatim) is emitted
   * if a sink was configured; emission never alters or delays the result.
   */
  async complete(
    requestType: RequestType,
    prompt: Prompt,
    budget?: TokenBudget,
  ): Promise<AiResponse> {
    const tier = this.tierFor(requestType);
    const resolvedBudget = budget ?? this.budgetFor(requestType);
    const response = await this.client.complete({ tier, prompt, budget: resolvedBudget });
    this.emitAiCall(response);
    return response;
  }

  /** Best-effort, non-blocking `ai_call` emission. Never throws. */
  private emitAiCall(response: AiResponse): void {
    if (!this.sink) return;
    try {
      const event = makeAiCallEvent(
        this.correlation,
        { model: response.model, usage: response.usage },
        this.generators,
      );
      this.sink.emit(event);
    } catch {
      // Instrumentation is best-effort; never let it affect the call result.
    }
  }
}
