/**
 * GameProfile — one GM engine, genre differences expressed as data
 * (aggressive_ai_gm_structure_design "GameProfile").
 *
 * There is exactly ONE GM. A profile never introduces a per-genre GM class; it
 * only selects which schemas apply and which deterministic GM procedures are
 * enabled for the session. The first proven pair runs an EZFudge dungeon crawl
 * and an investigation/horror one-shot on the same engine with different
 * procedure sets.
 */
import type { GmProcedureId } from "../ai/gm-procedures.js";

/** Profile-activated configuration for a game/genre on the single GM engine. */
export interface GameProfile {
  gameId: string;
  /** Rules family the sheets/checks come from (e.g. "ezfudge"). */
  rulesFamily: string;
  /** Session pacing style (e.g. "one-shot"). */
  sessionStyle: string;
  characterSheetSchemaId: string;
  characterStateSchemaId: string;
  scenarioBlackboardSchemaId: string;
  /** The deterministic GM procedures active for this profile. */
  enabledProcedures: GmProcedureId[];
  safetyProfileId: string;
}

/**
 * EZFudge dungeon crawl: spotlight, scene-clue reveals, and pressure clocks
 * drive the round; the investigation-only clue-web procedures stay off.
 */
export const EZFUDGE_DUNGEON_PROFILE: GameProfile = {
  gameId: "ezfudge-dungeon",
  rulesFamily: "ezfudge",
  sessionStyle: "one-shot",
  characterSheetSchemaId: "ezfudge-sheet-v1",
  characterStateSchemaId: "character-state-v1",
  scenarioBlackboardSchemaId: "scenario-blackboard-v1",
  enabledProcedures: ["character_spotlight", "clue_reveal", "pressure_clock", "narration_critic"],
  safetyProfileId: "default-table-safety",
};

/** Investigation/horror one-shot: clue procedures join the round loop. */
export const INVESTIGATION_HORROR_PROFILE: GameProfile = {
  gameId: "investigation-horror-oneshot",
  rulesFamily: "ezfudge",
  sessionStyle: "one-shot",
  characterSheetSchemaId: "ezfudge-sheet-v1",
  characterStateSchemaId: "character-state-v1",
  scenarioBlackboardSchemaId: "scenario-blackboard-v1",
  enabledProcedures: [
    "character_spotlight",
    "clue_reveal",
    "three_clue_rule",
    "pressure_clock",
    "narration_critic",
  ],
  safetyProfileId: "default-table-safety",
};

/** Registered profiles, keyed by gameId. */
export const GAME_PROFILES: Record<string, GameProfile> = {
  [EZFUDGE_DUNGEON_PROFILE.gameId]: EZFUDGE_DUNGEON_PROFILE,
  [INVESTIGATION_HORROR_PROFILE.gameId]: INVESTIGATION_HORROR_PROFILE,
};

/**
 * Scenario → profile mapping. Scenarios with an authored clue/secret web run
 * the investigation profile; everything else defaults to the dungeon profile.
 */
const PROFILE_BY_SCENARIO: Record<string, string> = {
  "the-sunless-crypt": INVESTIGATION_HORROR_PROFILE.gameId,
};

/** Resolve a profile by gameId, falling back to the dungeon profile. */
export function resolveGameProfile(gameId?: string): GameProfile {
  if (gameId !== undefined) {
    const profile = GAME_PROFILES[gameId];
    if (profile !== undefined) return profile;
  }
  return EZFUDGE_DUNGEON_PROFILE;
}

/** Resolve the profile a scenario plays under (catalog hint, else default). */
export function resolveGameProfileForScenario(scenarioId: string): GameProfile {
  return resolveGameProfile(PROFILE_BY_SCENARIO[scenarioId]);
}
