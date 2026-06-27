/**
 * Provider-agnostic AI GM client adapter.
 *
 * The engine never talks to a concrete LLM vendor directly. Instead it depends
 * on the {@link AiGmClient} port: a single `complete()` call that takes a model
 * {@link ModelTier}, a provider-neutral {@link Prompt}, and a {@link TokenBudget},
 * and returns the model output plus verbatim provider {@link TokenUsage}. A real
 * provider (Anthropic, OpenAI, Bedrock, …) is plugged in later by implementing
 * this interface; the rest of the engine is unaffected (design.md "AI GM",
 * Requirement 16.2).
 *
 * A {@link FakeAiGmClient} is provided for tests so the routing/coordination
 * logic can be exercised without a network or a vendor SDK.
 */
import type { ModelTier } from "../core/types.js";
import type { TokenUsage } from "../observability/events.js";

/**
 * A provider-neutral prompt. Kept deliberately small: an optional system
 * preamble plus the user/content message. Concrete providers map this onto
 * their own message/role shapes.
 */
export interface Prompt {
  /** Optional system / instruction preamble. */
  system?: string;
  /** The main user-facing prompt content. */
  user: string;
}

/** Maximum number of tokens the call is allowed to consume (Requirement 16.3). */
export type TokenBudget = number;

/** A single completion request: which tier to use, the prompt, and the budget. */
export interface CompleteRequest {
  /** The model tier this request is routed to (Requirement 16.2). */
  tier: ModelTier;
  /** The provider-neutral prompt. */
  prompt: Prompt;
  /** The token budget for this call. */
  budget: TokenBudget;
}

/**
 * The result of a completion: the model that served it, the generated text,
 * and the provider's token usage kept verbatim for cost analysis (the same
 * {@link TokenUsage} shape emitted on `ai_call` QA events, Requirement 18.4).
 */
export interface AiResponse {
  /** The concrete model name that produced the output. */
  model: string;
  /** The generated text output. */
  text: string;
  /** Verbatim provider token usage. */
  usage: TokenUsage;
}

/**
 * Provider-agnostic AI GM client port. Implemented by a concrete provider in
 * production and by {@link FakeAiGmClient} in tests.
 */
export interface AiGmClient {
  /** Run one completion against the given tier with the given prompt + budget. */
  complete(req: CompleteRequest): Promise<AiResponse>;
}

/** A canned completion returned by {@link FakeAiGmClient}. */
export interface FakeCompletion {
  /** The text to return. */
  text: string;
  /** Optional usage overrides; unspecified fields default to 0. */
  usage?: Partial<TokenUsage>;
}

/** Options controlling the deterministic behaviour of {@link FakeAiGmClient}. */
export interface FakeAiGmClientOptions {
  /**
   * Maps a tier to the concrete model name reported on the response. Defaults
   * to `fake-<tier>` so tests can assert the tier the client was called with.
   */
  modelForTier?: (tier: ModelTier) => string;
  /** Produces the completion for a request. Defaults to empty text + zero usage. */
  responder?: (req: CompleteRequest) => FakeCompletion;
}

/** Build a complete {@link TokenUsage}, filling unspecified fields with 0. */
export function makeTokenUsage(partial: Partial<TokenUsage> = {}): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...partial,
  };
}

/**
 * A deterministic, network-free {@link AiGmClient} for tests. It records every
 * request it receives (see {@link calls}) and returns a configurable response
 * whose `model` reflects the requested tier, so callers can assert both the
 * routing decision and the usage passthrough.
 */
export class FakeAiGmClient implements AiGmClient {
  /** Every request passed to {@link complete}, in call order. */
  readonly calls: CompleteRequest[] = [];

  private readonly modelForTier: (tier: ModelTier) => string;
  private readonly responder: (req: CompleteRequest) => FakeCompletion;

  constructor(options: FakeAiGmClientOptions = {}) {
    this.modelForTier = options.modelForTier ?? ((tier) => `fake-${tier}`);
    this.responder = options.responder ?? (() => ({ text: "" }));
  }

  complete(req: CompleteRequest): Promise<AiResponse> {
    this.calls.push(req);
    const completion = this.responder(req);
    return Promise.resolve({
      model: this.modelForTier(req.tier),
      text: completion.text,
      usage: makeTokenUsage(completion.usage),
    });
  }
}
