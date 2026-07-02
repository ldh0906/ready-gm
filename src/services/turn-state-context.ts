/**
 * Turn_State → AI GM context derivation, narrative-context update, and
 * token-budget truncation.
 *
 * The AI GM never reads the raw Turn_State; instead it receives a derived,
 * read-only {@link TurnStateContext} built from the room's CURRENT Turn_State
 * (design.md "AI GM Context Object"). Deriving the context is a pure,
 * deterministic function of its inputs so it can be unit- and property-tested
 * without a network, AI, or DB (Requirements 10.2, 12.4).
 *
 * After a round resolves, the resolution narration is appended to the
 * Turn_State's `narrativeContext` (Requirement 12.5). When the derived context
 * would exceed the configured token budget, the OLDEST narrative entries are
 * trimmed first while the CURRENT round's readiness and actions are always
 * preserved (Requirement 16.3).
 *
 * Requirements: 10.2, 12.4, 12.5, 16.3.
 */
import type { ActionKind, AttributeLevel } from "../core/types.js";
import type {
  ChatEntry,
  CheckRecord,
  NarrativeContextEntry,
  TurnState,
} from "../core/turn-state.js";
import { makeCharacterState, type CharacterState } from "../core/character-state.js";
import type { Character } from "./types.js";

/**
 * The scenario grounding handed to the AI GM. Structurally compatible with the
 * services {@link import("./scenario-service.js").Scenario} (extra fields such
 * as `id` are ignored) so callers can pass a catalog scenario directly.
 */
export interface ContextScenario {
  title: string;
  summary: string;
  openingSeed: string;
  endingCondition: string;
  /**
   * Optional per-scenario GM rules/tone overlay (see
   * {@link import("./scenario-service.js").Scenario.rulesBrief}). Injected into
   * the AI GM prompts on top of the universal EZFudge resolution.
   */
  rulesBrief?: string;
}

/** A single character as the AI GM sees it. */
export interface ContextCharacter {
  /** Stable server id used by typed CharacterDelta proposals. */
  id: string;
  name: string;
  concept: string;
  /**
   * The character's attribute map, keyed by whatever attribute system the
   * scenario uses (EZFudge Might/Agility/Wits/Spirit, or custom keys like
   * Sneaky/Fast/Tenacious). Kept as an open string-keyed record so custom-stat
   * scenarios flow through unchanged.
   */
  attributes: Record<string, AttributeLevel>;
  /**
   * Ruleset-specific original sheet fields (disposition, goal, card answers,
   * …) keyed by sheet field id, when the character carries any. Immutable
   * creation-time data — the mutable in-session half lives in {@link state}.
   */
  sheet?: Record<string, string>;
  /**
   * Mutable in-session facts about this character, when the room has a
   * CharacterStateStore wired in. Omitted for legacy/no-store callers.
   */
  state?: CharacterState;
}

/** One active player's pending action for the current round. */
export interface ContextAction {
  characterName: string;
  actionKind: ActionKind;
  actionText: string | null;
}

/**
 * The read-only context object derived from the current Turn_State and passed
 * to the AI GM (design.md "AI GM Context Object"). `recentNarrative` may be
 * truncated under a token budget, but `thisRound` is always preserved
 * (Requirement 16.3).
 */
export interface TurnStateContext {
  roomId: string;
  roundNumber: number;
  scenario: ContextScenario;
  characters: ContextCharacter[];
  thisRound: {
    actions: ContextAction[];
    chat: ChatEntry[];
    checks: CheckRecord[];
  };
  recentNarrative: NarrativeContextEntry[];
}

/**
 * Rough token estimate for a piece of text. Uses the common ~4-characters-per-token
 * heuristic; this is an ESTIMATE, not an exact tokenizer count, and is only used
 * to decide when to trim narrative history under {@link toContext}'s budget.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate the token footprint of a derived context by measuring its serialized
 * JSON. Approximate by design (see {@link estimateTokens}); good enough to drive
 * oldest-first narrative trimming without an exact tokenizer.
 */
export function estimateContextTokens(context: TurnStateContext): number {
  return estimateTokens(JSON.stringify(context));
}

/**
 * Append a resolution narration entry to a Turn_State's `narrativeContext`,
 * tagged with the round it resolved (Requirement 12.5). Pure: returns a new
 * Turn_State and does not mutate the input. New entries are appended at the end
 * so `narrativeContext` stays newest-last.
 */
export function appendNarrative(state: TurnState, text: string): TurnState {
  const entry: NarrativeContextEntry = { round: state.roundNumber, text };
  return { ...state, narrativeContext: [...state.narrativeContext, entry] };
}

/**
 * Derive the AI GM {@link TurnStateContext} from the room's current Turn_State.
 *
 * Pure and deterministic in its inputs:
 * - `scenario` and `characters` are projected to the AI-facing shapes.
 * - `thisRound.actions` is derived from the current readiness entries, mapping
 *   each player to its character name (falling back to the player id when no
 *   matching character is supplied).
 * - `thisRound.checks` is the current round's resolved checks.
 * - `recentNarrative` is the Turn_State's narrative history, newest last.
 *
 * When `budget` is provided and the derived context exceeds it, the OLDEST
 * narrative entries are trimmed one at a time until the context fits or no
 * narrative remains. `thisRound` (the current round's readiness/actions) and
 * `characters`/`scenario` are NEVER trimmed (Requirement 16.3).
 *
 * @param state The current Turn_State (Requirements 10.2, 12.4).
 * @param scenario The scenario grounding for the room.
 * @param characters The room's characters, used for action attribution.
 * @param budget Optional token budget; when exceeded, narrative is truncated.
 */
export function toContext(
  state: TurnState,
  scenario: ContextScenario,
  characters: readonly Character[],
  budget?: number,
  characterStates?: readonly CharacterState[],
): TurnStateContext {
  const characterNameByPlayerId = new Map(
    characters.map((character) => [character.playerId, character.name] as const),
  );
  const characterStateById = new Map(
    (characterStates ?? []).map((characterState) => [characterState.characterId, characterState] as const),
  );

  const context: TurnStateContext = {
    roomId: state.roomId,
    roundNumber: state.roundNumber,
    scenario: {
      title: scenario.title,
      summary: scenario.summary,
      openingSeed: scenario.openingSeed,
      endingCondition: scenario.endingCondition,
      // Carry the per-scenario rules overlay through ONLY when present, so
      // scenarios without one introduce no key (exactOptionalPropertyTypes).
      ...(scenario.rulesBrief !== undefined ? { rulesBrief: scenario.rulesBrief } : {}),
    },
    characters: characters.map((character) => {
      const characterState = characterStateById.get(character.id);
      // Ruleset-specific original sheet fields ground the GM's narration
      // (only non-empty values; `concept` is already carried separately).
      const sheet = Object.fromEntries(
        Object.entries(character.sheetData?.narrativeFields ?? {}).filter(
          ([key, value]) => key !== "concept" && value.trim().length > 0,
        ),
      );
      return {
        id: character.id,
        name: character.name,
        concept: character.concept,
        attributes: { ...character.attributes },
        ...(Object.keys(sheet).length > 0 ? { sheet } : {}),
        ...(characterState !== undefined ? { state: makeCharacterState(characterState) } : {}),
      };
    }),
    thisRound: {
      actions: state.readiness.map((entry) => ({
        characterName: characterNameByPlayerId.get(entry.playerId) ?? entry.playerId,
        actionKind: entry.actionKind,
        actionText: entry.actionText,
      })),
      chat: state.chatLog.map((entry) => ({ ...entry })),
      checks: state.checks.map((check) => ({ ...check })),
    },
    recentNarrative: state.narrativeContext.map((entry) => ({ ...entry })),
  };

  if (budget === undefined) {
    return context;
  }

  // Trim oldest narrative entries first (front of the newest-last array) until
  // the context fits the budget. thisRound is always preserved, so when the
  // narrative is exhausted we stop even if still over budget (Requirement 16.3).
  while (
    context.recentNarrative.length > 0 &&
    estimateContextTokens(context) > budget
  ) {
    context.recentNarrative.shift();
  }

  return context;
}
