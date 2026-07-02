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
    modules: ["src/ai/ai-gm-coordinator.ts", "src/ai/gm-decision.ts", "src/ai/gm-procedures.ts"],
    note: "resolveRound builds deterministic GM procedure hints, parses the richer GmDecision (intent/gmMove/scenePurpose/clockDeltas/offFront/climactic), rolls server-side, then narrates and emits a deterministic narration critique.",
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
    component: "GM Procedure Layer",
    status: "implemented",
    modules: ["src/ai/gm-procedures.ts", "src/ai/ai-gm-coordinator.ts", "src/observability/events.ts"],
    note: "Deterministic handlers produce character spotlight, clue reveal, and pressure-clock hints before the decision prompt. A deterministic narration critic records hidden-roll/clue-leak warnings as gm_procedure QA events. Handlers only advise; server reducers still own state changes.",
  },
  {
    component: "Character State + CharacterDelta reducer",
    status: "implemented",
    modules: [
      "src/core/character-state.ts",
      "src/services/character-state-store.ts",
      "src/services/turn-state-context.ts",
      "src/ai/gm-decision.ts",
      "src/ai/ai-gm-coordinator.ts",
      "src/realtime/room-orchestrator.ts",
    ],
    note: "Live end-to-end loop: session start seeds empty CharacterState records for confirmed characters, resolveRound receives current states, the AI can propose typed characterDeltas, the coordinator applies only server-validated deltas, narration receives applied/rejected deltas, and the orchestrator saves updated states for the next round. The decision prompt exposes character ids plus current mutable state. Player-visible projection (toVisibleCharacterState — conditions/inventory/resources/personal clocks, GM-only memories/flags/relationships excluded) is attached to the fan-out Turn_State by the engine's gateway decorator, so the game UI and reconnect resync render it; the original ruleset sheet fields are preserved separately on Character.sheetData and fed to prompts via ContextCharacter.sheet.",
  },
  {
    component: "Durable CharacterState persistence",
    status: "implemented",
    modules: [
      "migrations/0006_character_states.sql",
      "src/persistence/pg-character-state-repository.ts",
      "src/persistence/pg-character-state-store.ts",
      "src/persistence/factory.ts",
    ],
    note: "One jsonb character-state document per room (room_character_states), write-through PgCharacterStateStore mirroring the clock/scene stores, wired into createPersistence's Postgres branch. hydratePersistence() loads all durable stores (rooms/turn-states/clocks/scenes/character-states) into their live caches at startup.",
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
  {
    component: "ScenarioBlackboard core + reducer",
    status: "implemented",
    modules: [
      "src/core/scenario-blackboard.ts",
      "src/core/scenario-blackboard.test.ts",
      "src/services/blackboard-store.ts",
    ],
    note: "ScenarioBlackboard, Secret/Clue/NpcState/WorldFlag types, empty seed, pure BlackboardDelta reducer, idempotent duplicate reveals, fail-closed unknown deltas, NPC target validation, and GM/player-safe projections are implemented.",
  },
  {
    component: "ScenarioBlackboard seed mapper",
    status: "implemented",
    modules: ["src/services/scenario-blackboard.ts", "src/services/scenario-service.ts"],
    note: "Catalog-driven blackboard seeding is implemented. The Sunless Crypt has a small authored seed; scenarios without authored blackboard data get an empty blackboard so session start does not break.",
  },
  {
    component: "GmDecision blackboardDeltas",
    status: "implemented",
    modules: ["src/ai/gm-decision.ts", "src/ai/ai-gm-coordinator.ts"],
    note: "Hot-path decisions parse optional blackboardDeltas defensively, expose only a safe blackboard projection to the model, apply proposed deltas server-side, and split applied/rejected blackboard facts for narration and QA diff events.",
  },
  {
    component: "Durable ScenarioBlackboard persistence + reconnect projection",
    status: "implemented",
    modules: [
      "migrations/0009_room_blackboards.sql",
      "src/persistence/pg-blackboard-repository.ts",
      "src/persistence/pg-blackboard-store.ts",
      "src/persistence/factory.ts",
      "src/realtime/engine.ts",
      "src/realtime/room-orchestrator.ts",
    ],
    note: "One jsonb blackboard document per room, write-through PgBlackboardStore, createPersistence/hydratePersistence wiring, session-start seeding, round-loop persistence, and player-visible reconnect/fan-out projection are implemented.",
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
    component: "Memory Clerk + memory records",
    status: "implemented",
    modules: [
      "src/core/memory-record.ts",
      "src/services/memory-store.ts",
      "src/ai/gm-decision.ts",
      "src/ai/ai-gm-coordinator.ts",
      "src/realtime/room-orchestrator.ts",
      "migrations/0010_room_memories.sql",
      "src/persistence/pg-memory-store.ts",
    ],
    note: "Deterministic Memory Clerk (no extra AI call): per-round MemoryRecords derived from applied diffs plus validated AI memoryWrites, salience/visibility validated fail-closed, budget-selected context in the decision prompt (never raw transcripts), Postgres-durable. Deferred: embedding/RAG retrieval.",
  },
  {
    component: "Scenario Node Graph",
    status: "prepared",
    modules: ["src/core/scenario-blackboard.ts", "src/services/scenario-blackboard.ts"],
    note: "ScenarioBlackboard now carries sceneNodes and redundant clue path groups in authored seed data. Full graph traversal/scene transition behavior remains deferred.",
  },
  {
    component: "Safety Profile object + Safety/Tone Governor",
    status: "implemented",
    modules: ["src/core/safety-profile.ts", "src/ai/ai-gm-coordinator.ts", "src/ai/gm-procedures.ts"],
    note: "Per-session SafetyProfile (banned topics, tone boundary, table notes) injected into the SYSTEM policy block, separate from untrusted player data. Deterministic pre-apply gate rejects banned-topic blackboard deltas and memory writes; narration violations surface as gm_procedure critique warnings.",
  },
  {
    component: "GameProfile procedure registry (one GM engine, genre as data)",
    status: "implemented",
    modules: ["src/core/game-profile.ts", "src/ai/gm-procedures.ts", "src/realtime/room-orchestrator.ts"],
    note: "GameProfile selects enabledProcedures + safetyProfileId; ezfudge-dungeon and investigation-horror-oneshot run on the same engine with different procedure sets (investigation adds clue_reveal + three_clue_rule). The scenario catalog maps to a profile with a dungeon default.",
  },
  {
    component: "Multi-model routing realization (Front/Hot/Memory on different models)",
    status: "implemented",
    modules: ["src/ai/ai-gm-router.ts", "src/ai/cli-client-factory.ts"],
    note: "AI_MODEL_FAST/AI_MODEL_STANDARD/AI_MODEL_PREMIUM env overrides route tiers to different models on both CLI providers; unset keeps the single-model default. Deferred: climactic escalation.",
  },
] as const;
