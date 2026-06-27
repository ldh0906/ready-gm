/**
 * AI layer: provider-agnostic AiGmClient adapter and model-tier routing.
 *
 * The fuller AI GM Coordinator (resolveRound, opening/attribute/ending
 * generation, Korean validation, retries) is layered on in later tasks (13.3+);
 * this barrel currently exposes the client port + fake and the tier router.
 */
export * from "./ai-gm-client.js";
export * from "./ai-gm-router.js";
export * from "./ai-gm-coordinator.js";
export * from "./ai-gm-record-replay.js";
export * from "./codex-cli-client.js";
