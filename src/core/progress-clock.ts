/**
 * Progress Clock — the execution device that turns an abstract Front danger /
 * grim portent into a per-turn, advanceable number (ai-architecture.md
 * "Progress Clock은 Front의 실행 장치다").
 *
 * A clock fills from 0 toward `max`; failures, delays, noise, and risky choices
 * advance it. When it completes the server fires `onComplete` (a command / event
 * id) — e.g. a patrol arrives or a ritual seal breaks. These are PURE data +
 * pure transforms with no runtime dependencies, so the core stays unit- and
 * property-testable.
 *
 * SCOPE: this module prepares the clock primitive only. Wiring clocks into the
 * live round loop (applying AI-proposed `clockDeltas`, firing `onComplete` as a
 * reducer command) and persisting them is explicit follow-up integration — see
 * {@link import("../ai/blackboard-scope.js")}.
 */

import type { SceneNpc } from "./scene-state.js";

/** Where a clock lives: a single scene, a long-term Front, a faction, or a PC. */
export type ClockScope = "scene" | "front" | "faction" | "personal";

/**
 * A structural effect the engine applies when a clock COMPLETES (fills). Unlike
 * the narrated `consequence`, these mutate the world state server-side: a Front
 * danger's grim portent becomes real (a threat/NPC appears, a clue surfaces, or
 * the doom forces the session toward its end). These are server-authored data
 * carried by the clock seed — never chosen by the AI (ai-architecture.md
 * "clock이 가득 차면 서버는 흉조, 장면 변화, NPC 행동, 재앙을 발생시킨다").
 */
export type FiredEffect =
  /** Add a visible threat to the current Scene State. */
  | { readonly type: "add_threat"; readonly threat: string }
  /** Reveal a clue in the current Scene State (available -> revealed). */
  | { readonly type: "reveal_clue"; readonly clueId: string }
  /** Add an NPC (e.g. a spawned patrol) to the current Scene State. */
  | { readonly type: "add_npc"; readonly npc: SceneNpc }
  /** Force the session toward its ending (a Front's impending doom is realized). */
  | { readonly type: "force_ending" };

/**
 * A progress clock. `value` is always clamped to `[0, max]` and `max >= 1`
 * (enforced by {@link makeClock}). `onComplete` names the command/event the
 * server fires when the clock fills.
 */
export interface ProgressClock {
  /** Stable identifier (referenced by AI-proposed `clockDeltas`). */
  id: string;
  /** Human-facing label, e.g. "묘지 경계도". */
  name: string;
  /** The scope this clock belongs to. */
  scope: ClockScope;
  /** Current filled segments, in `[0, max]`. */
  value: number;
  /** Total segments; always `>= 1`. */
  max: number;
  /** Command/event id fired when the clock completes, e.g. "skeleton_patrol_arrives". */
  onComplete: string;
  /**
   * Optional Korean description of what happens when the clock fills, fed to the
   * GM so the consequence can be narrated. When absent, only the clock name +
   * `onComplete` id are available to describe the event.
   */
  consequence?: string;
  /**
   * Optional structural effects the engine applies when the clock fills (e.g.
   * spawn a threat/NPC, reveal a clue, force the ending). Server-authored;
   * applied in addition to narrating {@link ProgressClock.consequence}.
   */
  onCompleteEffects?: readonly FiredEffect[];
}

/** Fields accepted by {@link makeClock}; `value` defaults to 0. */
export interface ClockInit {
  id: string;
  name: string;
  scope: ClockScope;
  max: number;
  value?: number;
  onComplete: string;
  consequence?: string;
  onCompleteEffects?: readonly FiredEffect[];
}

/** Clamp `n` into the inclusive `[min, max]` range. */
function clamp(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Build a normalized {@link ProgressClock}. `max` is forced to at least 1 and
 * coerced to an integer; the initial `value` is clamped to `[0, max]`. Throws
 * on a non-finite `max`.
 */
export function makeClock(init: ClockInit): ProgressClock {
  if (!Number.isFinite(init.max)) {
    throw new TypeError(`clock '${init.id}' max must be a finite number`);
  }
  const max = Math.max(1, Math.trunc(init.max));
  const value = clamp(Math.trunc(init.value ?? 0), 0, max);
  return {
    id: init.id,
    name: init.name,
    scope: init.scope,
    value,
    max,
    onComplete: init.onComplete,
    ...(init.consequence !== undefined ? { consequence: init.consequence } : {}),
    ...(init.onCompleteEffects !== undefined ? { onCompleteEffects: init.onCompleteEffects } : {}),
  };
}

/**
 * Advance (or, with a negative delta, rewind) a clock, returning a new clock
 * whose `value` stays clamped to `[0, max]`. Non-finite deltas are treated as 0.
 * The input clock is not mutated.
 */
export function advanceClock(clock: ProgressClock, delta = 1): ProgressClock {
  const step = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  return { ...clock, value: clamp(clock.value + step, 0, clock.max) };
}

/** True once the clock has filled (`value >= max`). */
export function isClockComplete(clock: ProgressClock): boolean {
  return clock.value >= clock.max;
}

/** Segments remaining before the clock completes (never negative). */
export function clockRemaining(clock: ProgressClock): number {
  return Math.max(0, clock.max - clock.value);
}
