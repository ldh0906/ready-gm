/**
 * HTTP layer: non-realtime REST surface for the entry flows (room creation,
 * invite resolution, scenario listing, end-of-session summary).
 *
 * SECURITY NOTE: the REST surface is unauthenticated for the MVP — see app.ts.
 * Authentication/authorization must be added before production.
 */
export * from "./summary-reader.js";
export * from "./app.js";
