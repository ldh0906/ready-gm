/**
 * Blackboard architecture — explicit component scope registry.
 *
 * This file is the single, in-code source of truth for WHAT of the blackboard
 * AI-GM architecture (ai-architecture.md) is implemented, what is merely
 * *prepared* (types/helpers exist but are not yet wired into the live engine),
 * and what is deliberately *deferred*. It exists so the gap between the design
 * doc and the running system is auditable from the codebase itself rather than
 * living only in notes.
 *
 * It carries NO runtime behaviour — it is documentation expressed as data.
 */

/** Lifecycle status of a blackboard component relative to the running engine. */
export type ComponentStatus =
  /** Built and active in the live engine today. */
  | "implemented"
  /** Types/helpers/parsers exist and are tested, but not yet wired into the live round loop / persistence. */
  | "prepared"
  /** Intentionally not built yet; only documented here. */
  | "deferred";

/** A single architecture component and its current status. */
export interface ComponentScope {
  /** Component name as used in ai-architecture.md. */
  readonly component: string;
  readonly status: ComponentStatus;
  /** Where the prepared/implemented code lives (module paths), if any. */
  readonly modules: readonly string[];
  /** Short note on rationale / what remains. */
  readonly note: string;
}

/**
 * The component status map. Keep this in sync as integration proceeds: when a
 * "prepared" primitive is wired into the round loop + persistence, flip it to
 * "implemented"; when a "deferred" item is started, add its modules.
 */
export const BLACKBOARD_SCOPE: readonly ComponentScope[] = [
  // --- Implemented (already live in the engine) -----------------------------
  {
    component: "Server Engine (state authority, dice, validation, retries)",
    status: "implemented",
    modules: ["src/ai/ai-gm-coordinator.ts", "src/ai/ai-gm-router.ts", "src/core/ezfudge.ts"],
    note: "Server-side dice, schema + Korean validation, bounded retries, proposed-vs-applied diff events all active.",
  },
  {
    component: "Engine State (Turn_State)",
    status: "implemented",
    modules: ["src/core/turn-state.ts"],
    note: "Canonical per-room round mechanics; persisted losslessly.",
  },
  {
    component: "Hot Path GM (structured decision -> narration)",
    status: "implemented",
    modules: ["src/ai/ai-gm-coordinator.ts", "src/ai/gm-decision.ts"],
    note: "resolveRound parses the richer GmDecision (intent/gmMove/clockDeltas/offFront/climactic), rolls server-side, then narrates.",
  },
  {
    component: "Hot Path Decision Schema (intent/gmMove/clockDeltas/offFront/climactic)",
    status: "implemented",
    modules: ["src/ai/gm-decision.ts", "src/ai/ai-gm-coordinator.ts"],
    note: "Wired into resolveRound: replaced the old check-selection parse; clockDeltas applied server-side (outcome-gated), gmMove/flags recorded on the state_mutation diff.",
  },
  {
    component: "Progress Clock",
    status: "implemented",
    modules: [
      "src/core/progress-clock.ts",
      "src/core/front-effects.ts",
      "src/ai/ai-gm-coordinator.ts",
      "src/services/clock-store.ts",
      "src/services/scenario-clocks.ts",
      "src/realtime/room-orchestrator.ts",
    ],
    note: "End-to-end: scenario clocks seeded at session start, supplied to each round resolution, AI clockDeltas applied server-side, updated clocks persisted (ClockStore, Postgres-durable). A clock that FILLS narrates its consequence AND realizes server-authored Front effects (onCompleteEffects: spawn threat/NPC into the Scene State, reveal a clue, or force_ending). Per-scenario visibility (areClocksVisible) surfaces clock gauges to players via the narration payload, rendered as segmented gauges in the game client UI. Deferred: escalation chains (a fired clock seeding a new clock); reconnect re-surfacing of clocks.",
  },

  // --- Prepared (built + tested, NOT yet wired into the live engine) --------
  {
    component: "Scene State",
    status: "implemented",
    modules: [
      "src/core/scene-state.ts",
      "src/services/scene-store.ts",
      "src/services/scenario-scenes.ts",
      "src/ai/ai-gm-coordinator.ts",
      "src/realtime/room-orchestrator.ts",
    ],
    note: "End-to-end: scenario scene seeded at session start, supplied to the decision/narration prompts for grounding, GM-revealed clues applied server-side (available -> revealed), updated scene persisted (SceneStore, Postgres-durable). Deferred: scene transitions / changing scenes mid-session; reconnect re-surfacing of scene.",
  },
  {
    component: "Round narrative continuity",
    status: "implemented",
    modules: ["src/ai/ai-gm-coordinator.ts"],
    note: "Recent resolution narration is fed into the decision + narration prompts so rounds stay consistent and do not repeat prior beats.",
  },
  {
    component: "Front effects (clock onComplete realization)",
    status: "implemented",
    modules: ["src/core/front-effects.ts", "src/core/progress-clock.ts", "src/ai/ai-gm-coordinator.ts"],
    note: "Server-authored FiredEffects on a clock seed (add_threat / add_npc / reveal_clue / force_ending) are applied when the clock fills — a grim portent becomes real world state, and the impending doom forces the ending via the normal RESOLUTION_READY -> ended flow. NOT the Front PLANNER (auto-generation) — these are static-seed effects.",
  },
  {
    component: "GM Moves menu",
    status: "prepared",
    modules: ["src/core/gm-moves.ts"],
    note: "Move menu offered in the decision prompt + parsed/recorded. TODO: enforce/act on the chosen move (e.g. reveal_clue mutating Scene State).",
  },

  // --- Deferred (documented only; not built) --------------------------------
  {
    component: "Intent Router as a separate model",
    status: "deferred",
    modules: [],
    note: "Intent stays inside the hot-path decision for now; split to a cheap classifier only if traffic/cost demands it.",
  },
  {
    component: "Front State + Front Planner (auto-generation, async re-plan)",
    status: "deferred",
    modules: [],
    note: "Static-seed Front effects ARE realized now (see 'Front effects'). What remains deferred is the PLANNER: auto-generating Fronts/grim portents/clock seeds + off-front async re-planning, which introduces multi-writer concurrency. Defer until past one-shot MVP.",
  },
  {
    component: "Memory Clerk + RAG memory records",
    status: "deferred",
    modules: [],
    note: "Value grows with campaign length; a one-shot does not need rolling summaries / retrievable long-term memory.",
  },
  {
    component: "Scenario Node Graph",
    status: "deferred",
    modules: [],
    note: "Single static MVP scenario today; node-graph + clue redundancy is post-MVP.",
  },
  {
    component: "Safety Profile object + Safety/Tone Governor",
    status: "deferred",
    modules: [],
    note: "No structured per-room safety profile yet. Defer the object + post-output filtering.",
  },
  {
    component: "Multi-model routing realization (Front/Hot/Memory on different models)",
    status: "deferred",
    modules: ["src/ai/ai-gm-router.ts"],
    note: "Tier routing infra (modelTiers/tokenBudgets) exists, but CLI clients flatten every tier to one model. Realize per-tier models + climactic escalation later.",
  },
] as const;
