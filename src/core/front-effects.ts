/**
 * Apply the structural effects of FILLED Progress Clocks to the world state
 * (ai-architecture.md "clock이 가득 차면 서버는 흉조, 장면 변화, NPC 행동, 재앙을
 * 발생시킨다").
 *
 * When a clock completes, the engine — not the AI — realizes its Front
 * consequence: a threat or NPC appears in the Scene State, a clue surfaces, or
 * the impending doom forces the session toward its end. These effects are
 * server-authored data carried by the clock seed (see {@link FiredEffect}), so
 * the model can never fabricate them.
 *
 * Pure: returns new state and never mutates its inputs.
 */
import type { FiredEffect, ProgressClock } from "./progress-clock.js";
import { addSceneNpc, addVisibleThreat, revealClue, type SceneState } from "./scene-state.js";
import type { BlackboardDelta } from "./scenario-blackboard.js";

/** Outcome of applying the fired clocks' effects this round. */
export interface FiredEffectsResult {
  /** The scene after scene-mutating effects (unchanged ref when no scene/effect). */
  scene: SceneState | undefined;
  /** True when any fired clock's effects force the session toward its ending. */
  endingForced: boolean;
  /** The flat list of effects applied this round (for the QA diff / logging). */
  appliedEffects: FiredEffect[];
}

/**
 * Apply every {@link FiredEffect} carried by the clocks that filled this round.
 *
 * Scene-mutating effects (`add_threat` / `reveal_clue` / `add_npc`) are applied
 * only when a `scene` is supplied; `force_ending` always takes effect (it is
 * independent of the scene). Effects are applied in clock order, then effect
 * order. The input scene is never mutated.
 */
export function applyFiredEffects(
  scene: SceneState | undefined,
  firedClocks: readonly ProgressClock[],
): FiredEffectsResult {
  let nextScene = scene;
  let endingForced = false;
  const appliedEffects: FiredEffect[] = [];

  for (const clock of firedClocks) {
    for (const effect of clock.onCompleteEffects ?? []) {
      switch (effect.type) {
        case "add_threat":
          if (nextScene !== undefined) nextScene = addVisibleThreat(nextScene, effect.threat);
          appliedEffects.push(effect);
          break;
        case "reveal_clue":
          if (nextScene !== undefined) nextScene = revealClue(nextScene, effect.clueId);
          appliedEffects.push(effect);
          break;
        case "add_npc":
          if (nextScene !== undefined) nextScene = addSceneNpc(nextScene, effect.npc);
          appliedEffects.push(effect);
          break;
        case "force_ending":
          endingForced = true;
          appliedEffects.push(effect);
          break;
      }
    }
  }

  return { scene: nextScene, endingForced, appliedEffects };
}

/**
 * Express the fired clocks' world-mutating effects as {@link BlackboardDelta}s
 * so a filled clock also lands in ScenarioBlackboard state (not only the Scene
 * State). The deltas still pass the normal blackboard reducer, so an effect
 * referencing a clue the blackboard does not know is rejected fail-closed.
 */
export function firedEffectsToBlackboardDeltas(
  firedClocks: readonly ProgressClock[],
): BlackboardDelta[] {
  const deltas: BlackboardDelta[] = [];
  for (const clock of firedClocks) {
    for (const effect of clock.onCompleteEffects ?? []) {
      if (effect.type === "add_threat") {
        deltas.push({
          type: "add_threat",
          threat: { id: `clock-threat-${clock.id}`, name: effect.threat, status: "active" },
          reason: `clock ${clock.id} filled`,
        });
      } else if (effect.type === "reveal_clue") {
        deltas.push({
          type: "reveal_clue",
          clueId: effect.clueId,
          reason: `clock ${clock.id} filled`,
        });
      }
    }
  }
  return deltas;
}
