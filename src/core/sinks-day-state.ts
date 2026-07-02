/**
 * Until It Sinks Day State — pure state machine for the mystery day loop.
 *
 * This module records only deterministic, server-authoritative day facts:
 * which cards have been revealed, permanent card resolutions, and the target
 * selected by server-side lowest-roll resolution cards. It performs no I/O and
 * never rolls dice; callers supply all non-deterministic results.
 */
import {
  SINKS_GENERAL_EVENT_CARDS,
  SINKS_SPECIAL_EVENT_CARDS,
  type SinksDayEvent,
  type SinksEventCard,
  type SinksEventSchedule,
} from "../services/sinks-event-deck.js";

export interface SinksResolution {
  cardId: string;
  /** The agreed explanation, permanently true once recorded. */
  explanation: string;
  /** Day the resolution was recorded. */
  day: number;
}

export interface SinksDayState {
  roomId: string;
  /** Current in-game day, 1-based. */
  day: number;
  /** Card ids revealed so far, in reveal order (day 1 => [fisherman_found]). */
  revealedCardIds: string[];
  /** Permanent truths (rulebook: 해명된 내용은 언제나 참). */
  resolutions: SinksResolution[];
  /** lowest_roll 카드의 대상 배정: cardId -> characterId. */
  targetByCardId: Record<string, string>;
  /** True once island_sinks has been revealed (final day reached). */
  finalDayReached: boolean;
}

export type SinksAdvanceRejectReason = "FINAL_DAY_REACHED" | "NO_SCHEDULED_CARD";
export type SinksAdvanceResult =
  | { ok: true; state: SinksDayState; revealedCard: SinksEventCard; revealedEvent: SinksDayEvent }
  | { ok: false; reason: SinksAdvanceRejectReason; message: string };

export type SinksTargetRejectReason =
  | "CARD_NOT_REVEALED"
  | "UNKNOWN_CARD"
  | "CARD_NOT_LOWEST_ROLL"
  | "TARGET_ALREADY_ASSIGNED"
  | "EMPTY_CHARACTER_ID";
export type SinksTargetAssignmentResult =
  | { ok: true; state: SinksDayState }
  | { ok: false; reason: SinksTargetRejectReason; message: string };

export interface SinksResolutionProposal {
  cardId: string;
  explanation: string;
}

export type SinksResolutionRejectReason =
  | "CARD_NOT_REVEALED"
  | "ALREADY_RESOLVED"
  | "CARD_DOES_NOT_REQUIRE_RESOLUTION"
  | "FISHERMAN_FOUND_LOCKED"
  | "EMPTY_EXPLANATION";

export interface RejectedSinksResolution {
  proposal: SinksResolutionProposal;
  reason: SinksResolutionRejectReason;
}

export interface SinksResolutionApplication {
  state: SinksDayState;
  applied: SinksResolution[];
  rejected: RejectedSinksResolution[];
}

const FISHERMAN_FOUND_CARD_ID = "fisherman_found";
const ISLAND_SINKS_CARD_ID = "island_sinks";
const ALL_SINKS_CARDS: readonly SinksEventCard[] = [
  ...SINKS_SPECIAL_EVENT_CARDS,
  ...SINKS_GENERAL_EVENT_CARDS,
];

/** Build the initial day state for day 1, with the opening card revealed. */
export function createSinksDayState(roomId: string, schedule: SinksEventSchedule): SinksDayState {
  return {
    roomId,
    day: 1,
    revealedCardIds: [schedule.opening.id],
    resolutions: [],
    targetByCardId: {},
    finalDayReached: false,
  };
}

/**
 * Advance to the next in-game day and reveal that day's scheduled card.
 * Returns a new state plus the revealed schedule event for narration/roll flow.
 */
export function advanceSinksDay(
  state: SinksDayState,
  schedule: SinksEventSchedule,
): SinksAdvanceResult {
  if (state.finalDayReached) {
    return {
      ok: false,
      reason: "FINAL_DAY_REACHED",
      message: "Cannot advance after island_sinks has been revealed.",
    };
  }

  const nextDay = state.day + 1;
  const revealedCard = schedule.days.find((event) => event.day === nextDay);
  if (revealedCard === undefined) {
    return {
      ok: false,
      reason: "NO_SCHEDULED_CARD",
      message: `No Until It Sinks event card is scheduled for day ${nextDay}.`,
    };
  }

  return {
    ok: true,
    revealedCard: revealedCard.card,
    revealedEvent: revealedCard,
    state: {
      ...cloneSinksDayState(state),
      day: nextDay,
      revealedCardIds: [...state.revealedCardIds, revealedCard.card.id],
      finalDayReached: revealedCard.isFinalDay || revealedCard.card.id === ISLAND_SINKS_CARD_ID,
    },
  };
}

/**
 * Record the server's lowest-roll target result for a revealed lowest_roll card.
 * Dice rolling and tie rerolls are intentionally outside this pure module.
 */
export function assignSinksTarget(
  state: SinksDayState,
  cardId: string,
  characterId: string,
): SinksTargetAssignmentResult {
  if (!state.revealedCardIds.includes(cardId)) {
    return { ok: false, reason: "CARD_NOT_REVEALED", message: `Card is not revealed: ${cardId}` };
  }
  const card = findSinksCard(cardId);
  if (card === undefined) {
    return { ok: false, reason: "UNKNOWN_CARD", message: `Unknown Until It Sinks event card: ${cardId}` };
  }
  if (card.resolution !== "lowest_roll") {
    return {
      ok: false,
      reason: "CARD_NOT_LOWEST_ROLL",
      message: `Card does not use lowest_roll targeting: ${cardId}`,
    };
  }
  if (state.targetByCardId[cardId] !== undefined) {
    return { ok: false, reason: "TARGET_ALREADY_ASSIGNED", message: `Target already assigned: ${cardId}` };
  }
  if (characterId.trim() === "") {
    return { ok: false, reason: "EMPTY_CHARACTER_ID", message: "Target character id cannot be blank." };
  }

  return {
    ok: true,
    state: {
      ...cloneSinksDayState(state),
      targetByCardId: { ...state.targetByCardId, [cardId]: characterId },
    },
  };
}

/**
 * Apply valid resolution proposals as permanent truths and reject invalid ones.
 * Valid proposals in the same batch are still applied when other proposals fail.
 */
export function applySinksResolutions(
  state: SinksDayState,
  proposals: readonly SinksResolutionProposal[],
): SinksResolutionApplication {
  let nextState = cloneSinksDayState(state);
  const applied: SinksResolution[] = [];
  const rejected: RejectedSinksResolution[] = [];

  for (const proposal of proposals) {
    const rejection = validateResolutionProposal(nextState, proposal);
    if (rejection !== undefined) {
      rejected.push({ proposal, reason: rejection });
      continue;
    }

    const resolution: SinksResolution = {
      cardId: proposal.cardId,
      explanation: proposal.explanation.trim(),
      day: nextState.day,
    };
    nextState = { ...nextState, resolutions: [...nextState.resolutions, resolution] };
    applied.push(resolution);
  }

  return { state: nextState, applied, rejected };
}

/** Return revealed card ids that still block session completion. */
export function unresolvedRequiredCardIds(state: SinksDayState): string[] {
  const resolved = new Set(state.resolutions.map((resolution) => resolution.cardId));
  return state.revealedCardIds.filter((cardId) => cardId !== ISLAND_SINKS_CARD_ID && !resolved.has(cardId));
}

/** True only after island_sinks has been revealed and every required card is resolved. */
export function canEndSinksSession(state: SinksDayState): boolean {
  return state.finalDayReached && unresolvedRequiredCardIds(state).length === 0;
}

/** Clone a day state so callers cannot observe shared mutable arrays/maps. */
export function cloneSinksDayState(state: SinksDayState): SinksDayState {
  return {
    ...state,
    revealedCardIds: [...state.revealedCardIds],
    resolutions: state.resolutions.map((resolution) => ({ ...resolution })),
    targetByCardId: { ...state.targetByCardId },
  };
}

function validateResolutionProposal(
  state: SinksDayState,
  proposal: SinksResolutionProposal,
): SinksResolutionRejectReason | undefined {
  if (!state.revealedCardIds.includes(proposal.cardId)) return "CARD_NOT_REVEALED";
  if (state.resolutions.some((resolution) => resolution.cardId === proposal.cardId)) return "ALREADY_RESOLVED";
  if (proposal.cardId === ISLAND_SINKS_CARD_ID) return "CARD_DOES_NOT_REQUIRE_RESOLUTION";
  if (proposal.cardId === FISHERMAN_FOUND_CARD_ID && !state.finalDayReached) return "FISHERMAN_FOUND_LOCKED";
  if (proposal.explanation.trim() === "") return "EMPTY_EXPLANATION";
  return undefined;
}

function findSinksCard(cardId: string): SinksEventCard | undefined {
  return ALL_SINKS_CARDS.find((card) => card.id === cardId);
}
