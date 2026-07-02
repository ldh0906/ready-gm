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
  /** Minimum round count before AI-proposed endings are accepted. */
  minRounds: number;
  characterSheetSchemaId: string;
  characterStateSchemaId: string;
  scenarioBlackboardSchemaId: string;
  /** The deterministic GM procedures active for this profile. */
  enabledProcedures: GmProcedureId[];
  safetyProfileId: string;
  /** Round-loop mode; defaults to checks when omitted. */
  roundFlow?: "checks" | "gmless-days";
}

/**
 * EZFudge dungeon crawl: spotlight, scene-clue reveals, and pressure clocks
 * drive the round; the investigation-only clue-web procedures stay off.
 */
export const EZFUDGE_DUNGEON_PROFILE: GameProfile = {
  gameId: "ezfudge-dungeon",
  rulesFamily: "ezfudge",
  sessionStyle: "one-shot",
  minRounds: 8,
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
  minRounds: 8,
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

/** D6 dice-pool comedy one-shot: no clue-web procedures, visible pressure and spotlight. */
export const COMEDY_ONESHOT_PROFILE: GameProfile = {
  gameId: "comedy-oneshot",
  rulesFamily: "d6-pool",
  sessionStyle: "one-shot",
  minRounds: 8,
  characterSheetSchemaId: "terrible-geese-sheet-v1",
  characterStateSchemaId: "character-state-v1",
  scenarioBlackboardSchemaId: "terrible-geese-blackboard-v1",
  enabledProcedures: ["character_spotlight", "pressure_clock", "narration_critic"],
  safetyProfileId: "default-table-safety",
};

/** GM-less card one-shot: the round loop is reused as an evening/day cadence. */
export const GMLESS_CARD_PROFILE: GameProfile = {
  gameId: "gmless-card-oneshot",
  rulesFamily: "card",
  sessionStyle: "one-shot",
  minRounds: 0,
  characterSheetSchemaId: "sinks-sheet-v1",
  characterStateSchemaId: "character-state-v1",
  scenarioBlackboardSchemaId: "sinks-blackboard-v1",
  enabledProcedures: ["narration_critic"],
  safetyProfileId: "default-table-safety",
  roundFlow: "gmless-days",
};

/** Registered profiles, keyed by gameId. */
export const GAME_PROFILES: Record<string, GameProfile> = {
  [EZFUDGE_DUNGEON_PROFILE.gameId]: EZFUDGE_DUNGEON_PROFILE,
  [INVESTIGATION_HORROR_PROFILE.gameId]: INVESTIGATION_HORROR_PROFILE,
  [COMEDY_ONESHOT_PROFILE.gameId]: COMEDY_ONESHOT_PROFILE,
  [GMLESS_CARD_PROFILE.gameId]: GMLESS_CARD_PROFILE,
};

/**
 * Scenario → profile mapping. Scenarios with an authored clue/secret web run
 * the investigation profile; everything else defaults to the dungeon profile.
 */
const PROFILE_BY_SCENARIO: Record<string, string> = {
  "the-sunless-crypt": INVESTIGATION_HORROR_PROFILE.gameId,
  "ashfall-monastery": INVESTIGATION_HORROR_PROFILE.gameId,
  "tidewatch-smugglers": INVESTIGATION_HORROR_PROFILE.gameId,
  "terrible-geese": COMEDY_ONESHOT_PROFILE.gameId,
  "until-it-sinks": GMLESS_CARD_PROFILE.gameId,
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
