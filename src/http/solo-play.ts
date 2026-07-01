/**
 * Solo-play surface — pure helpers + an in-memory session store for the
 * single-player "free-text action -> real LLM judges + narrates" flow.
 *
 * This module is intentionally free of Express and engine internals so it can be
 * unit-tested with a FAKE coordinator. The real wiring (token gate, rate limit,
 * engine.coordinator) lives in `src/server.ts`; the testable logic lives here.
 *
 * The flow reuses the existing engine path: the AI picks which checks apply
 * (attribute / difficulty / advantage), the server rolls EZFudge with advantage,
 * and the AI narrates the resolved outcome. See {@link AiGmCoordinator.resolveRound}.
 *
 * Additive only — nothing here changes the `/play/new`, WebSocket, or engine paths.
 */
import type { AttributeKey, AttributeLevel, EngineConfig } from "../core/types.js";
import type { CheckRecord, NarrativeContextEntry, TurnState } from "../core/turn-state.js";
import type { Scenario } from "../services/scenario-service.js";
import type { Character } from "../services/types.js";

/** Default EZFudge attributes for a freshly-minted solo character. */
const DEFAULT_SOLO_ATTRS: Record<AttributeKey, AttributeLevel> = {
  Might: 1,
  Agility: 1,
  Wits: 1,
  Spirit: 1,
};

/**
 * A single solo-play session held in memory. Mirrors the durable concepts used
 * by the multiplayer path but collapsed to one player + one character.
 */
export interface SoloSession {
  id: string;
  scenario: Scenario;
  character: Character;
  narrativeContext: NarrativeContextEntry[];
  roundNumber: number;
  ended: boolean;
}

/** In-memory store for {@link SoloSession}s, keyed by session id. */
export interface SoloSessionStore {
  create(character: Character, scenario: Scenario): SoloSession;
  get(id: string): SoloSession | undefined;
  set(id: string, session: SoloSession): void;
}

/**
 * Create an in-memory {@link SoloSessionStore}. `create` seeds a session at
 * round 1 with an empty narrative context using the character's `roomId` as the
 * session id, so the session id is stable and matches the Turn_State `roomId`.
 */
export function createSoloSessionStore(): SoloSessionStore {
  const sessions = new Map<string, SoloSession>();
  return {
    create(character: Character, scenario: Scenario): SoloSession {
      const session: SoloSession = {
        id: character.roomId,
        scenario,
        character,
        narrativeContext: [],
        roundNumber: 1,
        ended: false,
      };
      sessions.set(session.id, session);
      return session;
    },
    get(id: string): SoloSession | undefined {
      return sessions.get(id);
    },
    set(id: string, session: SoloSession): void {
      sessions.set(id, session);
    },
  };
}

/**
 * Build the `resolving`-phase {@link TurnState} for a solo action. The single
 * player is marked ready with a confirmed action carrying the free text, and
 * `resolutionRequested` is set so the coordinator resolves the round. The
 * session's accumulated narrative context is carried through unchanged.
 */
export function buildResolvingState(
  session: SoloSession,
  action: string,
  config: Pick<EngineConfig, "readyCheckTimeoutMs">,
): TurnState {
  return {
    roomId: session.id,
    roundNumber: session.roundNumber,
    phase: "resolving",
    readiness: [
      {
        playerId: session.character.playerId,
        status: "ready",
        actionKind: "confirmed_action",
        actionText: action,
      },
    ],
    chatLog: [],
    checks: [],
    narrativeContext: session.narrativeContext,
    readyCheckDeadline: null,
    readyCheckTimeoutMs: config.readyCheckTimeoutMs,
    resolutionRequested: true,
  };
}

/**
 * Append a narrative entry immutably, keeping only the most recent `cap` entries
 * (oldest trimmed first). Returns a new array; the input is not mutated.
 */
export function appendNarrative(
  list: readonly NarrativeContextEntry[],
  round: number,
  text: string,
  cap = 10,
): NarrativeContextEntry[] {
  const next: NarrativeContextEntry[] = [...list, { round, text }];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** A JSON-safe, client-facing projection of a resolved {@link CheckRecord}. */
export interface CheckSummary {
  /** Attribute the check resolved against — any character-owned key (string). */
  attribute: string;
  difficulty: CheckRecord["difficulty"];
  advantage: CheckRecord["advantage"];
  rolls: number[];
  roll: number;
  outcome: CheckRecord["outcome"];
}

/**
 * Map resolved {@link CheckRecord}s to the client-facing dice/outcome shape.
 *
 * Only PUBLIC player checks (`visibility === "player"`) are surfaced — hidden GM
 * rolls (traps, passive senses, fate/event rolls) are resolved server-side and
 * folded into the narration, never shown to the client. A legacy record without
 * `visibility` defaults to `"player"` (set during deserialization).
 */
export function summarizeChecks(checks: readonly CheckRecord[]): CheckSummary[] {
  return checks
    .filter((check) => (check.visibility ?? "player") === "player")
    .map((check) => ({
      attribute: check.attribute,
      difficulty: check.difficulty,
      advantage: check.advantage,
      rolls: [...check.rolls],
      roll: check.roll,
      outcome: check.outcome,
    }));
}

/** Count of hidden GM rolls resolved this turn (for debug/observability). */
export function countHiddenChecks(checks: readonly CheckRecord[]): number {
  return checks.filter((check) => (check.visibility ?? "player") === "gm").length;
}

/** Identity inputs for {@link makeSoloCharacter}. */
export interface SoloCharacterIds {
  playerId: string;
  characterId: string;
  roomId: string;
}

/**
 * Build a confirmed solo {@link Character} with the default attribute spread.
 * `displayName` defaults to "모험가" and `concept` to "용감한 모험가" when blank.
 */
export function makeSoloCharacter(
  opts: { displayName?: string | undefined; concept?: string | undefined },
  ids: SoloCharacterIds,
): Character {
  const name = (opts.displayName ?? "").trim() || "모험가";
  const concept = (opts.concept ?? "").trim() || "용감한 모험가";
  return {
    id: ids.characterId,
    playerId: ids.playerId,
    roomId: ids.roomId,
    name,
    concept,
    attributes: { ...DEFAULT_SOLO_ATTRS },
    confirmed: true,
  };
}

/**
 * Minimal coordinator surface {@link runSoloAct} depends on. The real
 * {@link AiGmCoordinator} satisfies this; tests inject a fake.
 */
export interface SoloResolveResult {
  ok: boolean;
  checks?: readonly CheckRecord[];
  narration?: string;
  endingReached?: boolean;
  error?: { reason: string; message: string };
}

export interface SoloCoordinator {
  resolveRound(input: {
    state: TurnState;
    scenario: Scenario;
    characters: readonly Character[];
  }): Promise<SoloResolveResult>;
}

/** The client-facing response of a solo action turn. */
export type SoloActResponse =
  | {
      ok: true;
      checks: CheckSummary[];
      /** Number of hidden GM rolls folded into the narration (not shown as dice). */
      hiddenCount: number;
      narration: string;
      endingReached: boolean;
    }
  | { ok: false; error: string; message: string };

/**
 * Resolve one solo action: build the resolving Turn_State, call the coordinator,
 * and (on success) update the session in place — appending the narration to the
 * narrative context, incrementing the round number, and recording whether the
 * ending was reached. Returns the client-facing response. Pure-ish: it mutates
 * the passed {@link SoloSession} fields but touches nothing else, so the Express
 * route handler can stay thin and this stays unit-testable with a fake.
 */
export async function runSoloAct(
  session: SoloSession,
  action: string,
  coordinator: SoloCoordinator,
  config: Pick<EngineConfig, "readyCheckTimeoutMs">,
): Promise<SoloActResponse> {
  const state = buildResolvingState(session, action, config);
  const result = await coordinator.resolveRound({
    state,
    scenario: session.scenario,
    characters: [session.character],
  });

  if (!result.ok) {
    const error = result.error ?? { reason: "ai_request_failed", message: "AI 요청 실패" };
    return { ok: false, error: error.reason, message: error.message };
  }

  const checks = result.checks ?? [];
  const narration = result.narration ?? "";
  const endingReached = result.endingReached ?? false;

  session.narrativeContext = appendNarrative(
    session.narrativeContext,
    session.roundNumber,
    narration,
  );
  session.roundNumber += 1;
  session.ended = endingReached;

  return {
    ok: true,
    checks: summarizeChecks(checks),
    hiddenCount: countHiddenChecks(checks),
    narration,
    endingReached,
  };
}
