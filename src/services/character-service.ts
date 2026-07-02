/**
 * Character Service — character recording, confirmation locking, name
 * uniqueness, and session-start gating.
 *
 * This implements the character-setup portion of the Room Service surface
 * (design.md "Components and Interfaces" — 1. Room Service) plus the start
 * gate shared with the Room Lifecycle State Machine.
 *
 * Key behavioral rules implemented here:
 * - A player records/updates their (still-editable) character — name, concept,
 *   and AI-proposed attributes — until they confirm it (Requirement 4.5).
 * - Confirming a character treats its attributes as final and disallows any
 *   further revision of that character (Requirement 4.4).
 * - A character name already used by another character in the room is rejected
 *   so names stay unique within the room (Requirement 4.6).
 * - A session can start only when every player in the room has confirmed a
 *   character; `startSession` transitions the room to `in_session` and is
 *   otherwise rejected (Requirements 4.7, 5.1).
 *
 * Persistence is deferred (task 14): the service runs against the in-memory
 * {@link RoomStore} so the logic stays unit-testable before durable storage is
 * wired in.
 *
 * Requirements: 4.4, 4.5, 4.6, 4.7, 5.1
 */
import { randomUUID } from "node:crypto";
import type { AttributeKey, AttributeLevel } from "../core/types.js";
import {
  DEFAULT_ATTRIBUTE_LADDER,
  isValidAttributeLevel,
  type AttributeLadder,
} from "../core/ezfudge.js";
import { InMemoryRoomStore, type RoomStore } from "./room-store.js";
import { normalizeName } from "./names.js";
import {
  type AllocationRule,
  type CharacterCard,
  validateAllocation,
} from "./sheet-schema.js";
import type { Character, CharacterSheetData } from "./types.js";

/** The character details a player supplies while setting up (Requirement 4.1). */
export interface CharacterInput {
  /** Character name; must be unique within the room (Requirement 4.6). */
  name: string;
  /** Free-text concept/description for the character (Requirement 4.1). */
  concept: string;
  /** EZFudge attribute ladder, typically AI-proposed then revised (Requirement 4.2). */
  attributes: Record<string, AttributeLevel>;
  /**
   * The Card_Id selected on a Card_Based_Sheet (intended extension,
   * scenario-character-cards Requirement 6.1). When `options.selectedCardId` is
   * omitted this value is validated against `options.characterCards`. Ignored
   * for non-card sheets.
   */
  selectedCardId?: string;
  /**
   * Ruleset-specific original sheet fields (narrative values beyond
   * name/concept/attributes), preserved verbatim on the recorded character so
   * they survive persistence and can ground the AI GM. Not validated here —
   * the sheet schema's client/endpoint owns field-level constraints.
   */
  sheetData?: CharacterSheetData;
}

/**
 * Optional per-call rule-system overrides for {@link CharacterService.recordCharacter}.
 * Lets a non-EZFudge sheet validate its own trait keys/ladder while keeping the
 * default EZFudge behavior when omitted.
 */
export interface RecordCharacterOptions {
  /**
   * The trait keys to validate. Every key must hold an integer value within
   * `ladder` in `input.attributes`. An EMPTY array means NO attribute
   * validation (narrative-only sheets). When `options` is omitted entirely the
   * default EZFudge keys are validated instead.
   */
  traitKeys?: string[];
  /** Inclusive ladder used for validation; defaults to {@link DEFAULT_ATTRIBUTE_LADDER}. */
  ladder?: AttributeLadder;
  /**
   * The single allocation rule governing how rated traits are assigned. When
   * provided, recorded attributes are validated with the shared
   * {@link validateAllocation} algorithm (ladder bounds first, then the
   * allocation constraint) instead of the legacy ladder-bounds-only check, so
   * the backend mirrors the frontend `validateAllocation` exactly (validation
   * parity). When omitted, the legacy `traitKeys`/`ladder` behavior is kept
   * unchanged. The keys/ladder applied are taken from `traitKeys`/`ladder`.
   */
  allocationRule?: AllocationRule;
  /**
   * The selectable Character_Card_List for a Card_Based_Sheet (intended
   * extension, scenario-character-cards Requirement 6.1). When this holds ≥ 1
   * card the recorded card selection is validated with the same algorithm as
   * the frontend `validateCardSelection` (validation parity). Absent or empty
   * means the sheet is not card-based, so card validation is skipped and the
   * existing behavior is preserved unchanged (Requirement 6.3).
   */
  characterCards?: CharacterCard[];
  /**
   * The Card_Id selected on a Card_Based_Sheet. Takes precedence over
   * `input.selectedCardId` when both are present (Requirement 6.1).
   */
  selectedCardId?: string;
}

/** The four EZFudge attribute keys, used for ladder-bounds validation (S2). */
const ATTRIBUTE_KEYS: readonly AttributeKey[] = ["Might", "Agility", "Wits", "Spirit"];

/**
 * Result of {@link CharacterService.recordCharacter} or
 * {@link CharacterService.confirmCharacter}. Mirrors the discriminated-union
 * style used by the Room Service (`JoinResult`).
 */
export type RecordCharacterResult =
  | { ok: true; character: Character }
  | { ok: false; reason: "NAME_TAKEN"; message: string } // R4.6
  | { ok: false; reason: "ALREADY_CONFIRMED"; message: string } // R4.4
  | { ok: false; reason: "INVALID_ATTRIBUTES"; message: string } // ladder bounds (S2)
  | { ok: false; reason: "INVALID_ALLOCATION"; message: string } // allocation constraint (flexible-stat-allocation R8.3)
  | { ok: false; reason: "INVALID_CARD"; message: string } // card selection (scenario-character-cards R6.2)
  | { ok: false; reason: "CARD_TAKEN"; message: string } // card already confirmed by another player
  | { ok: false; reason: "UNKNOWN_PLAYER"; message: string }
  | { ok: false; reason: "NO_CHARACTER"; message: string };

/** Result of {@link CharacterService.startSession} (Requirements 4.7, 5.1, 5.2). */
export type StartSessionResult =
  | { ok: true }
  | { ok: false; reason: "UNKNOWN_ROOM"; message: string }
  | { ok: false; reason: "NOT_HOST"; message: string } // R5.2 host-only start (S3)
  | { ok: false; reason: "NOT_ALL_CONFIRMED"; message: string } // R5.1
  | { ok: false; reason: "SCENARIO_NOT_SELECTED"; message: string } // R3.5 (S7)
  | { ok: false; reason: "ROOM_NOT_IN_LOBBY"; message: string };

/** Message surfaced when a requested character name duplicates another's (Requirement 4.6). */
export const NAME_TAKEN_MESSAGE = "That character name is already taken in this room.";

/** Message surfaced when revising a character that is already confirmed (Requirement 4.4). */
export const ALREADY_CONFIRMED_MESSAGE =
  "This character is confirmed and its attributes can no longer be revised.";

/** Message surfaced when start is attempted before every player has confirmed (Requirement 5.1). */
export const NOT_ALL_CONFIRMED_MESSAGE =
  "Every player must confirm a character before the session can start.";

/** Message surfaced when a non-host attempts to start the session (Requirement 5.2). */
export const NOT_HOST_MESSAGE = "Only the host can start the session.";

/** Message surfaced when start is attempted with no scenario resolved (Requirement 3.5). */
export const SCENARIO_NOT_SELECTED_MESSAGE =
  "A scenario must be selected before the session can start.";

/** Message surfaced when an attribute value falls outside the EZFudge ladder (S2). */
export const INVALID_ATTRIBUTES_MESSAGE =
  `Every attribute must be an integer on the EZFudge ladder [${DEFAULT_ATTRIBUTE_LADDER.min}, ${DEFAULT_ATTRIBUTE_LADDER.max}].`;

/**
 * Message surfaced when attributes clear ladder bounds but violate the
 * scenario's allocation rule — the point-buy total or fixed-value one-to-one
 * assignment is not satisfied (flexible-stat-allocation Requirements 8.3, 8.7).
 * 능력치 배분 규칙(배분 점수 총합 또는 고정값 일대일 배정)을 충족하지 못했습니다.
 */
export const INVALID_ALLOCATION_MESSAGE =
  "Attributes satisfy the ladder bounds but violate the scenario's allocation rule (point-buy total or fixed-value assignment).";

/**
 * Message surfaced when a Card_Based_Sheet record is attempted without a valid
 * card selection — no card chosen, or a Card_Id not in the sheet's
 * Character_Card_List (scenario-character-cards Requirements 5.1, 6.2, 6.4).
 * Shares the same Korean wording as the frontend pre-validation so the player
 * sees one consistent "pick a role card first" message.
 * 역할 카드를 먼저 선택해 주세요.
 */
export const INVALID_CARD_MESSAGE = "역할 카드를 먼저 선택해 주세요. (Please select a role card first.)";

/**
 * Message surfaced at confirm time when the player's chosen role card has
 * already been confirmed by another player in the same room. The Selected_Card
 * must be unique among confirmed characters in a room, so the second player to
 * confirm the same card is rejected and asked to pick a different card.
 * 이미 다른 플레이어가 선택한 역할 카드입니다.
 */
export const CARD_TAKEN_MESSAGE =
  "이미 다른 플레이어가 선택한 역할 카드입니다. 다른 카드를 골라 주세요. (That role card is already taken.)";

/** Injectable dependencies for {@link CharacterService}. */
export interface CharacterServiceOptions {
  /** Storage backend; defaults to an in-memory store (task 14 swaps this out). */
  store?: RoomStore;
  /** Unique character id generator; defaults to a random UUID v4. */
  generateCharacterId?: () => string;
  /**
   * Optional scenario-readiness gate consulted by {@link CharacterService.startSession}
   * (Requirement 3.5, S7). When provided and it returns `false` for the room,
   * start is rejected with `SCENARIO_NOT_SELECTED`. Omitting it skips the check
   * (e.g. single-scenario MVP where a default is always resolved).
   */
  isScenarioResolved?: (roomId: string) => boolean;
  /**
   * Inclusive attribute ladder used to validate recorded attributes (S2).
   * Defaults to {@link DEFAULT_ATTRIBUTE_LADDER}; override (e.g. from
   * `EngineConfig.attributeLadder`) for a non-default rule system.
   */
  attributeLadder?: AttributeLadder;
}

/**
 * Owns character recording, confirmation locking, name uniqueness, and the
 * all-players-confirmed start gate.
 */
export class CharacterService {
  private readonly store: RoomStore;
  private readonly generateCharacterId: () => string;
  private readonly isScenarioResolved: ((roomId: string) => boolean) | undefined;
  private readonly attributeLadder: AttributeLadder;

  constructor(options: CharacterServiceOptions = {}) {
    this.store = options.store ?? new InMemoryRoomStore();
    this.generateCharacterId = options.generateCharacterId ?? (() => randomUUID());
    this.isScenarioResolved = options.isScenarioResolved;
    this.attributeLadder = options.attributeLadder ?? DEFAULT_ATTRIBUTE_LADDER;
  }

  /**
   * Record or update a player's character while it is still editable
   * (Requirement 4.5). The recorded character is left `confirmed: false` so the
   * player may keep revising name/concept/attributes until confirmation.
   *
   * Rejects when:
   * - the player is unknown to the store (`UNKNOWN_PLAYER`),
   * - the player's character is already confirmed (`ALREADY_CONFIRMED`,
   *   Requirement 4.4), or
   * - the requested name is already used by another character in the room
   *   (`NAME_TAKEN`, Requirement 4.6).
   */
  recordCharacter(
    playerId: string,
    input: CharacterInput,
    options?: RecordCharacterOptions,
  ): RecordCharacterResult {
    const player = this.store.getPlayer(playerId);
    if (player === undefined) {
      return {
        ok: false,
        reason: "UNKNOWN_PLAYER",
        message: `Unknown player id: ${playerId}`,
      };
    }

    const existing = this.findCharacterForPlayer(player.roomId, playerId);

    // A confirmed character is final; further revision is disallowed (R4.4).
    // This is checked before card validation so a confirmed character's stored
    // selectedCardId + narrative fields are preserved unchanged (R8.3).
    if (existing?.confirmed === true) {
      return { ok: false, reason: "ALREADY_CONFIRMED", message: ALREADY_CONFIRMED_MESSAGE };
    }

    // Card selection validation (scenario-character-cards). When
    // `options.characterCards` holds ≥ 1 card the sheet is a Card_Based_Sheet,
    // so the chosen Card_Id (options.selectedCardId ?? input.selectedCardId)
    // must trim to ≥ 1 char and match some card's trimmed id. Mirrors the
    // frontend `validateCardSelection` exactly (validation parity). An absent
    // or empty card list skips this entirely so non-card sheets are unchanged
    // (R6.3). On INVALID_CARD no character data is recorded/updated — we return
    // before saveCharacter/savePlayer (R6.2). (R6.1, R6.2, R6.3)
    const selectedCardId = options?.selectedCardId ?? input.selectedCardId;
    if (!isCardSelectionValid(options?.characterCards, selectedCardId)) {
      return { ok: false, reason: "INVALID_CARD", message: INVALID_CARD_MESSAGE };
    }

    // Resolve which trait keys / ladder to validate against. With no options we
    // keep the legacy EZFudge behavior (4 keys on the configured ladder); with
    // options we honor the scenario's own keys/ladder. An empty traitKeys array
    // means narrative-only — skip attribute validation entirely (S2).
    const ladder = options?.ladder ?? this.attributeLadder;
    const traitKeys: readonly string[] =
      options === undefined ? ATTRIBUTE_KEYS : (options.traitKeys ?? ATTRIBUTE_KEYS);

    if (options?.allocationRule !== undefined) {
      // Allocation-rule path: validate with the shared algorithm that mirrors
      // the frontend `validateAllocation` exactly — ladder bounds are checked
      // first (INVALID_ATTRIBUTES) and only on success is the allocation
      // constraint checked (INVALID_ALLOCATION). Both rejections record/update
      // no character data (return before saveCharacter/savePlayer). An empty
      // traitKeys array yields 0 traits, so validation is skipped entirely
      // (narrative-only sheets, R8.6). (R8.1–8.4)
      const traits = traitKeys.map((key) => ({ key, ladder }));
      const validation = validateAllocation(options.allocationRule, traits, input.attributes);
      if (!validation.ok) {
        if (validation.reason === "INVALID_ALLOCATION") {
          return {
            ok: false,
            reason: "INVALID_ALLOCATION",
            message: INVALID_ALLOCATION_MESSAGE,
          };
        }
        return {
          ok: false,
          reason: "INVALID_ATTRIBUTES",
          message: `Every attribute must be an integer on the EZFudge ladder [${ladder.min}, ${ladder.max}].`,
        };
      }
    } else if (!traitKeys.every((key) => isValidAttributeLevel(input.attributes[key], ladder))) {
      // Legacy ladder-bounds-only behavior when no allocation rule is supplied
      // (R8.5). An empty traitKeys array means narrative-only — no validation.
      return {
        ok: false,
        reason: "INVALID_ATTRIBUTES",
        message: `Every attribute must be an integer on the EZFudge ladder [${ladder.min}, ${ladder.max}].`,
      };
    }

    // Names must be unique within the room, excluding the player's own
    // in-progress character so re-recording with the same name is allowed (R4.6).
    if (this.isNameTaken(player.roomId, input.name, playerId)) {
      return { ok: false, reason: "NAME_TAKEN", message: NAME_TAKEN_MESSAGE };
    }

    const isCardBased =
      Array.isArray(options?.characterCards) && options.characterCards.length > 0;

    const character: Character = {
      id: existing?.id ?? this.generateCharacterId(),
      playerId,
      roomId: player.roomId,
      name: input.name,
      concept: input.concept,
      attributes: { ...input.attributes } as Character["attributes"],
      confirmed: false,
      // Persist the Selected_Card on a Card_Based_Sheet so it round-trips with
      // the character (R6.1). Non-card sheets carry no selectedCardId (R6.3).
      ...(isCardBased && selectedCardId !== undefined
        ? { selectedCardId }
        : {}),
      // Preserve the ruleset-specific original sheet fields verbatim so they
      // survive persistence and reach the AI GM context (Living Character Sheet).
      ...(input.sheetData !== undefined ? { sheetData: cloneSheetData(input.sheetData) } : {}),
    };

    this.store.saveCharacter(character);

    // Link the character to its player so start-gating can find it (R4.5).
    if (player.characterId !== character.id) {
      this.store.savePlayer({ ...player, characterId: character.id });
    }

    return { ok: true, character: cloneCharacter(character) };
  }

  /**
   * Confirm a player's character, treating its attributes as final and
   * disallowing further revision (Requirements 4.4, 4.5). The confirmed
   * character is recorded in the room.
   *
   * Re-confirming an already-confirmed character is idempotent and succeeds.
   * Rejects when the player is unknown (`UNKNOWN_PLAYER`) or has no recorded
   * character to confirm (`NO_CHARACTER`).
   */
  confirmCharacter(playerId: string): RecordCharacterResult {
    const player = this.store.getPlayer(playerId);
    if (player === undefined) {
      return {
        ok: false,
        reason: "UNKNOWN_PLAYER",
        message: `Unknown player id: ${playerId}`,
      };
    }

    const existing = this.findCharacterForPlayer(player.roomId, playerId);
    if (existing === undefined) {
      return {
        ok: false,
        reason: "NO_CHARACTER",
        message: "No character has been recorded for this player yet.",
      };
    }

    if (existing.confirmed) {
      return { ok: true, character: cloneCharacter(existing) };
    }

    // CARD_TAKEN dedup (Card_Based_Sheets): a Selected_Card must be unique among
    // confirmed characters in a room. If this character carries a non-empty
    // selectedCardId and some OTHER player in the same room has already confirmed
    // a character with the same card, reject and write nothing so the player can
    // pick a different card. Re-confirming one's own already-confirmed card is
    // handled by the idempotent early return above, so it never trips this check.
    // Non-card characters (no selectedCardId) are unaffected.
    if (typeof existing.selectedCardId === "string" && existing.selectedCardId.length > 0) {
      const cardId = existing.selectedCardId;
      const takenByOther = this.store
        .listCharactersByRoom(player.roomId)
        .some(
          (character) =>
            character.playerId !== playerId &&
            character.confirmed === true &&
            character.selectedCardId === cardId,
        );
      if (takenByOther) {
        return { ok: false, reason: "CARD_TAKEN", message: CARD_TAKEN_MESSAGE };
      }
    }

    const confirmed: Character = { ...existing, attributes: { ...existing.attributes }, confirmed: true };
    this.store.saveCharacter(confirmed);

    if (player.characterId !== confirmed.id) {
      this.store.savePlayer({ ...player, characterId: confirmed.id });
    }

    return { ok: true, character: cloneCharacter(confirmed) };
  }

  /**
   * Fetch the character recorded for a player, or `undefined` when none exists.
   */
  getCharacterForPlayer(playerId: string): Character | undefined {
    const player = this.store.getPlayer(playerId);
    if (player === undefined) {
      return undefined;
    }
    const character = this.findCharacterForPlayer(player.roomId, playerId);
    return character ? cloneCharacter(character) : undefined;
  }

  /**
   * Unconfirm every confirmed character in a room so players may revise again.
   * Used when the host sends everyone back to the lobby (e.g. to change the
   * scenario): a previously confirmed character would otherwise be locked
   * (`ALREADY_CONFIRMED`) and could not be re-recorded against the new sheet.
   * Recorded data is preserved (only the `confirmed` flag is cleared); the
   * all-confirmed start gate (`canStart`) therefore reopens until everyone
   * re-confirms. Returns the number of characters unconfirmed.
   */
  unconfirmRoom(roomId: string): number {
    let count = 0;
    for (const character of this.store.listCharactersByRoom(roomId)) {
      if (character.confirmed) {
        this.store.saveCharacter({ ...character, confirmed: false });
        count += 1;
      }
    }
    return count;
  }

  /**
   * Whether the session can start: true iff the room has at least one player
   * and every player in the room has a confirmed character (Requirements 4.7,
   * 5.1). Returns false for an unknown room.
   */
  canStart(roomId: string): boolean {
    const room = this.store.getRoom(roomId);
    if (room === undefined) {
      return false;
    }
    const players = this.store.listPlayers(roomId);
    if (players.length === 0) {
      return false;
    }
    const confirmedPlayerIds = new Set(
      this.store
        .listCharactersByRoom(roomId)
        .filter((character) => character.confirmed)
        .map((character) => character.playerId),
    );
    return players.every((player) => confirmedPlayerIds.has(player.id));
  }

  /**
   * Start the session, transitioning the room to `in_session` only when the
   * caller is the host, the room is in `lobby`, every player has confirmed a
   * character, and (when a scenario gate is configured) a scenario is resolved
   * (Requirements 3.5, 4.7, 5.1, 5.2).
   *
   * Rejects when the room is unknown (`UNKNOWN_ROOM`), the caller is not the
   * host (`NOT_HOST`), the room is not in `lobby` (`ROOM_NOT_IN_LOBBY`), not
   * every player has confirmed (`NOT_ALL_CONFIRMED`), or no scenario is resolved
   * (`SCENARIO_NOT_SELECTED`). The room is left unchanged on rejection.
   */
  startSession(roomId: string, byPlayerId: string): StartSessionResult {
    const room = this.store.getRoom(roomId);
    if (room === undefined) {
      return { ok: false, reason: "UNKNOWN_ROOM", message: `Unknown room id: ${roomId}` };
    }
    // Host-only start (R5.2, S3): mirrors the round-loop START_SESSION gate.
    if (byPlayerId !== room.hostPlayerId) {
      return { ok: false, reason: "NOT_HOST", message: NOT_HOST_MESSAGE };
    }
    if (room.state !== "lobby") {
      return {
        ok: false,
        reason: "ROOM_NOT_IN_LOBBY",
        message: `Room ${roomId} cannot start from state "${room.state}".`,
      };
    }
    if (!this.canStart(roomId)) {
      return { ok: false, reason: "NOT_ALL_CONFIRMED", message: NOT_ALL_CONFIRMED_MESSAGE };
    }
    // Scenario must be resolved when a gate is wired (R3.5, S7).
    if (this.isScenarioResolved !== undefined && !this.isScenarioResolved(roomId)) {
      return { ok: false, reason: "SCENARIO_NOT_SELECTED", message: SCENARIO_NOT_SELECTED_MESSAGE };
    }

    this.store.saveRoom({ ...room, state: "in_session" });
    return { ok: true };
  }

  /** Find the in-room character recorded for a player, if any. */
  private findCharacterForPlayer(roomId: string, playerId: string): Character | undefined {
    return this.store
      .listCharactersByRoom(roomId)
      .find((character) => character.playerId === playerId);
  }

  /**
   * Whether `name` is already used by a character in the room other than the
   * one belonging to `playerId`. Comparison is case-insensitive and
   * whitespace-trimmed so near-duplicate names are also rejected.
   */
  private isNameTaken(roomId: string, name: string, playerId: string): boolean {
    const normalized = normalizeName(name);
    return this.store
      .listCharactersByRoom(roomId)
      .some(
        (character) =>
          character.playerId !== playerId && normalizeName(character.name) === normalized,
      );
  }
}

/** Defensive copy so callers cannot mutate stored character state. */
function cloneCharacter(character: Character): Character {
  return {
    ...character,
    attributes: { ...character.attributes },
    ...(character.selectedCardId !== undefined
      ? { selectedCardId: character.selectedCardId }
      : {}),
    ...(character.sheetData !== undefined
      ? { sheetData: cloneSheetData(character.sheetData) }
      : {}),
  };
}

/** Defensive copy of the immutable original-sheet payload. */
function cloneSheetData(sheetData: CharacterSheetData): CharacterSheetData {
  return {
    ...(sheetData.narrativeFields !== undefined
      ? { narrativeFields: { ...sheetData.narrativeFields } }
      : {}),
  };
}

/**
 * The shared card-selection validation algorithm — the canonical backend
 * implementation that mirrors the frontend `validateCardSelection` in
 * `public/character/logic.js` exactly (validation parity,
 * scenario-character-cards Requirement 5.2). Returns `true` when the selection
 * is valid for the given card list.
 *
 * Algorithm (design "카드 선택 검증 알고리즘"):
 * 1. Not card-based: when `cardList` is absent or empty the sheet is not a
 *    Card_Based_Sheet → always valid (Requirements 5.4, 6.3).
 * 2. Selection present: with ≥ 1 card the `selectedId` must trim to ≥ 1 char
 *    (else INVALID_CARD — missing/blank, Requirements 5.1, 6.2).
 * 3. Membership: the trimmed `selectedId` must exactly match some card's
 *    trimmed `id` (else INVALID_CARD, Requirement 6.2).
 */
function isCardSelectionValid(
  cardList: CharacterCard[] | undefined,
  selectedId: string | undefined,
): boolean {
  // (1) Not card-based → always valid.
  if (!Array.isArray(cardList) || cardList.length === 0) {
    return true;
  }
  // (2) Selection must be present (trims to ≥ 1 char).
  if (typeof selectedId !== "string") {
    return false;
  }
  const trimmed = selectedId.trim();
  if (trimmed.length === 0) {
    return false;
  }
  // (3) Selection must belong to the card list (by trimmed id).
  return cardList.some(
    (card) => typeof card?.id === "string" && card.id.trim() === trimmed,
  );
}
