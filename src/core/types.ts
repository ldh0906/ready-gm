/**
 * Shared domain types for the TRPG Session Engine.
 *
 * These types are used across every layer (core, services, ai, realtime,
 * persistence, http) and intentionally carry no runtime dependencies so the
 * pure core can be unit- and property-tested without a network, AI, or DB.
 *
 * Sources: design.md "Components and Interfaces" (EZFudge Resolver) and
 * "Data Models" (Turn_State, Configuration).
 * Requirements: 1.4, 8.4, 11.6, 16.2, 17.1
 */

/**
 * EZFudge character attribute keys. The MVP scenario uses a four-attribute
 * ladder (see design.md Screen 4 — Character Setup).
 */
export type AttributeKey = "Might" | "Agility" | "Wits" | "Spirit";

/**
 * Named attribute ladder mapped to integer levels (e.g. Terrible=-2 .. Superb=+4).
 * Represented as a plain integer so EZFudge math stays simple and total.
 */
export type AttributeLevel = number;

/** EZFudge difficulty ladder for a check (Requirement 11.1). */
export type DifficultyGrade = "Trivial" | "Easy" | "Average" | "Hard" | "Formidable";

/** Resolved result of a check after combining dice + difficulty (Requirement 11.3). */
export type OutcomeGrade = "Failure" | "Partial Success" | "Success" | "Critical Success";

/** Round-loop phase tracked by the Turn_State (Requirement 5.4, round loop). */
export type Phase = "free_chat" | "ready_check" | "resolving" | "ended";

/** Per-player readiness during a ready-check (Requirements 7.1, 7.2). */
export type ReadinessStatus = "not_ready" | "ready";

/**
 * The kind of action a ready player committed.
 * `auto_pass` is distinguishable from a manual `pass` (Requirement 8.2/8.5);
 * `null` means no action kind has been recorded yet.
 */
export type ActionKind = "confirmed_action" | "pass" | "auto_pass" | null;

/** AI request categories that can each be routed to a configured model tier. */
export type RequestType = "opening" | "attributes" | "resolution" | "ending";

/**
 * Configurable AI model tiers. Tiers let the engine route cheaper requests to
 * smaller models and reserve larger models for narration (Requirement 16.2).
 */
export type ModelTier = "fast" | "standard" | "premium";

/**
 * Engine-wide configuration. Defaults are provided by {@link DEFAULT_ENGINE_CONFIG}.
 * Requirements: 1.4, 8.4, 11.6, 16.2, 17.1
 */
export interface EngineConfig {
  /** Ready-check timeout before Auto_Pass; default 90000 ms (Requirement 8.4). */
  readyCheckTimeoutMs: number;
  /** Maximum players per room; 6 (Requirement 1.4). */
  maxPlayers: number;
  /** Additional AI retries beyond the first attempt; 2 => 3 total (Requirement 17.1). */
  aiMaxRetries: number;
  /** Per request-type model tier routing (Requirement 16.2). */
  modelTiers: Record<RequestType, ModelTier>;
  /** Per request-type token budgets (Requirement 16.3). */
  tokenBudgets: Record<RequestType, number>;
  /**
   * The aggregate inclusive output range of the EZFudge dice, derived from
   * {@link dice} (`[count*face.min, count*face.max]`). Retained for fixtures and
   * range-bound helpers (Requirement 11.6).
   */
  diceRange: { min: number; max: number };
  /**
   * The EZFudge dice model: each roll sums `count` dice, each drawn uniformly
   * over `face`. The default sums two dice for a bell-shaped distribution that
   * makes criticals/fumbles rarer than a flat band (Requirement 11.6).
   */
  dice: { count: number; face: { min: number; max: number } };
}
