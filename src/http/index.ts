/**
 * HTTP layer: non-realtime REST surface for the entry flows (room creation,
 * invite resolution, scenario listing, end-of-session summary).
 *
 * SECURITY NOTE: the legacy Express app in app.ts is intentionally not exported
 * from this package entry because it is unauthenticated. Tests may import it
 * directly; production/package consumers only get the summary-reader surface.
 */
export * from "./summary-reader.js";
