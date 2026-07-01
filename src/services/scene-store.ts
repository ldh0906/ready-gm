/**
 * Scene Store — reads/writes the per-room {@link SceneState}.
 *
 * The Scene State holds the current scene's GM operating context (location,
 * goal, present NPCs, clues, exits). The orchestrator seeds it at session start,
 * supplies it to each round resolution, and persists the engine-applied result
 * (e.g. clues the GM revealed). Defined behind an interface so a durable
 * Postgres-backed store can replace the in-memory MVP without touching callers
 * (durable scenes are deferred — see {@link import("../ai/blackboard-scope.js")}).
 *
 * Reads return independent copies so external mutation cannot corrupt state.
 */
import type { SceneState } from "../core/scene-state.js";

/** Storage surface for a room's current Scene State. */
export interface SceneStore {
  /** Fetch the room's scene, or `undefined` when none is set. Returns a copy. */
  get(roomId: string): SceneState | undefined;
  /** Replace the room's scene (an independent copy is stored). */
  save(roomId: string, scene: SceneState): void;
}

/** Deep-ish clone of a scene (arrays + nested NPC objects rebuilt). */
function cloneScene(scene: SceneState): SceneState {
  return {
    ...scene,
    presentNpcs: scene.presentNpcs.map((npc) => ({ ...npc })),
    visibleThreats: [...scene.visibleThreats],
    availableClues: [...scene.availableClues],
    revealedClues: [...scene.revealedClues],
    exits: [...scene.exits],
  };
}

/** In-process {@link SceneStore} backed by a `Map` of room id → scene. */
export class InMemorySceneStore implements SceneStore {
  private readonly scenes = new Map<string, SceneState>();

  get(roomId: string): SceneState | undefined {
    const scene = this.scenes.get(roomId);
    return scene === undefined ? undefined : cloneScene(scene);
  }

  save(roomId: string, scene: SceneState): void {
    this.scenes.set(roomId, cloneScene(scene));
  }
}
