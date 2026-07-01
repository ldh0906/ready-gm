/**
 * Scene State — the current scene's GM operating context (ai-architecture.md
 * "Scene State"). Where the Turn_State holds round mechanics (readiness, checks,
 * chat), the Scene State holds *where the party is and what matters here now*:
 * the location, the scene goal, present NPCs, visible threats, the clues that
 * can be found vs. those already revealed, the exits, and the GM's last open
 * question.
 *
 * These are PURE data + pure transforms with no runtime dependencies, so the
 * core stays unit- and property-testable.
 *
 * SCOPE: this module prepares the Scene State object only. Persisting it (a
 * `scene_states` table), threading it through the round loop, and feeding it to
 * the hot-path prompt are explicit follow-up integration — see
 * {@link import("../ai/blackboard-scope.js")}.
 */

/** An NPC present in the current scene. */
export interface SceneNpc {
  /** Stable identifier, e.g. "npc_crypt_acolyte". */
  id: string;
  /** Display name, e.g. "창백한 시종". */
  name: string;
  /** Attitude toward the party. */
  disposition: "hostile" | "wary" | "neutral" | "friendly" | "unknown";
  /** What the NPC is visibly trying to do, in player-facing terms. */
  visibleIntent: string;
}

/**
 * The current scene's GM context. Clue ids appear in exactly one of
 * `availableClues` (discoverable but hidden) or `revealedClues` (already shown);
 * {@link revealClue} moves an id between the two.
 */
export interface SceneState {
  /** Stable scene identifier, e.g. "crypt_hall_01". */
  sceneId: string;
  /** Player-facing location description. */
  location: string;
  /** What the party is trying to accomplish in this scene. */
  sceneGoal: string;
  /** The current source of pressure / rising tension. */
  currentTension: string;
  /** NPCs currently present. */
  presentNpcs: SceneNpc[];
  /** Threats the players can perceive right now. */
  visibleThreats: string[];
  /** Clue ids that can still be discovered (not yet revealed). */
  availableClues: string[];
  /** Clue ids that have been revealed to the players. */
  revealedClues: string[];
  /** Exit / transition ids leading out of this scene. */
  exits: string[];
  /** The last open question the GM posed, or `null`. */
  lastGmQuestion: string | null;
}

/** Fields accepted by {@link makeSceneState}; list/`null` fields default empty. */
export interface SceneStateInit {
  sceneId: string;
  location: string;
  sceneGoal: string;
  currentTension?: string;
  presentNpcs?: SceneNpc[];
  visibleThreats?: string[];
  availableClues?: string[];
  revealedClues?: string[];
  exits?: string[];
  lastGmQuestion?: string | null;
}

/** De-duplicate a string array, preserving first-seen order. */
function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Build a normalized {@link SceneState}. Clue lists are de-duplicated, and any
 * id appearing in both `availableClues` and `revealedClues` is treated as
 * revealed (removed from available) so the two lists never overlap.
 */
export function makeSceneState(init: SceneStateInit): SceneState {
  const revealed = unique(init.revealedClues ?? []);
  const revealedSet = new Set(revealed);
  const available = unique(init.availableClues ?? []).filter((id) => !revealedSet.has(id));
  return {
    sceneId: init.sceneId,
    location: init.location,
    sceneGoal: init.sceneGoal,
    currentTension: init.currentTension ?? "",
    presentNpcs: (init.presentNpcs ?? []).map((npc) => ({ ...npc })),
    visibleThreats: unique(init.visibleThreats ?? []),
    availableClues: available,
    revealedClues: revealed,
    exits: unique(init.exits ?? []),
    lastGmQuestion: init.lastGmQuestion ?? null,
  };
}

/**
 * Reveal a clue: move `clueId` from `availableClues` to `revealedClues`,
 * returning a new scene. Idempotent — revealing an already-revealed clue is a
 * no-op, and revealing an unknown clue id adds it to `revealedClues` (the GM may
 * surface a clue that was not pre-listed). The input scene is not mutated.
 */
export function revealClue(scene: SceneState, clueId: string): SceneState {
  if (scene.revealedClues.includes(clueId)) return scene;
  return {
    ...scene,
    availableClues: scene.availableClues.filter((id) => id !== clueId),
    revealedClues: [...scene.revealedClues, clueId],
  };
}

/** Return a new scene with the GM's most recent open question set. */
export function setLastGmQuestion(scene: SceneState, question: string | null): SceneState {
  return { ...scene, lastGmQuestion: question };
}

/**
 * Add a visible threat to the scene (idempotent — de-duplicated). Returns a new
 * scene; the input is not mutated.
 */
export function addVisibleThreat(scene: SceneState, threat: string): SceneState {
  if (scene.visibleThreats.includes(threat)) return scene;
  return { ...scene, visibleThreats: [...scene.visibleThreats, threat] };
}

/**
 * Add an NPC to the scene, keyed by id (idempotent — an NPC whose id is already
 * present is not added again). Returns a new scene; the input is not mutated.
 */
export function addSceneNpc(scene: SceneState, npc: SceneNpc): SceneState {
  if (scene.presentNpcs.some((existing) => existing.id === npc.id)) return scene;
  return { ...scene, presentNpcs: [...scene.presentNpcs, { ...npc }] };
}
