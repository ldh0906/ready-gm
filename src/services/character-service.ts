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
import { InMemoryRoomStore, type RoomStore } from "./room-store.js";
import type { Character } from "./types.js";

/** The character details a player supplies while setting up (Requirement 4.1). */
export interface CharacterInput {
  /** Character name; must be unique within the room (Requirement 4.6). */
  name: string;
  /** Free-text concept/description for the character (Requirement 4.1). */
  concept: string;
  /** EZFudge attribute ladder, typically AI-proposed then revised (Requirement 4.2). */
  attributes: Record<AttributeKey, AttributeLevel>;
}

/**
 * Result of {@link CharacterService.recordCharacter} or
 * {@link CharacterService.confirmCharacter}. Mirrors the discriminated-union
 * style used by the Room Service (`JoinResult`).
 */
export type RecordCharacterResult =
  | { ok: true; character: Character }
  | { ok: false; reason: "NAME_TAKEN"; message: string } // R4.6
  | { ok: false; reason: "ALREADY_CONFIRMED"; message: string } // R4.4
  | { ok: false; reason: "UNKNOWN_PLAYER"; message: string }
  | { ok: false; reason: "NO_CHARACTER"; message: string };

/** Result of {@link CharacterService.startSession} (Requirements 4.7, 5.1). */
export type StartSessionResult =
  | { ok: true }
  | { ok: false; reason: "UNKNOWN_ROOM"; message: string }
  | { ok: false; reason: "NOT_ALL_CONFIRMED"; message: string } // R5.1
  | { ok: false; reason: "ROOM_NOT_IN_LOBBY"; message: string };

/** Message surfaced when a requested character name duplicates another's (Requirement 4.6). */
export const NAME_TAKEN_MESSAGE = "That character name is already taken in this room.";

/** Message surfaced when revising a character that is already confirmed (Requirement 4.4). */
export const ALREADY_CONFIRMED_MESSAGE =
  "This character is confirmed and its attributes can no longer be revised.";

/** Message surfaced when start is attempted before every player has confirmed (Requirement 5.1). */
export const NOT_ALL_CONFIRMED_MESSAGE =
  "Every player must confirm a character before the session can start.";

/** Injectable dependencies for {@link CharacterService}. */
export interface CharacterServiceOptions {
  /** Storage backend; defaults to an in-memory store (task 14 swaps this out). */
  store?: RoomStore;
  /** Unique character id generator; defaults to a random UUID v4. */
  generateCharacterId?: () => string;
}

/**
 * Owns character recording, confirmation locking, name uniqueness, and the
 * all-players-confirmed start gate.
 */
export class CharacterService {
  private readonly store: RoomStore;
  private readonly generateCharacterId: () => string;

  constructor(options: CharacterServiceOptions = {}) {
    this.store = options.store ?? new InMemoryRoomStore();
    this.generateCharacterId = options.generateCharacterId ?? (() => randomUUID());
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
  recordCharacter(playerId: string, input: CharacterInput): RecordCharacterResult {
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
    if (existing?.confirmed === true) {
      return { ok: false, reason: "ALREADY_CONFIRMED", message: ALREADY_CONFIRMED_MESSAGE };
    }

    // Names must be unique within the room, excluding the player's own
    // in-progress character so re-recording with the same name is allowed (R4.6).
    if (this.isNameTaken(player.roomId, input.name, playerId)) {
      return { ok: false, reason: "NAME_TAKEN", message: NAME_TAKEN_MESSAGE };
    }

    const character: Character = {
      id: existing?.id ?? this.generateCharacterId(),
      playerId,
      roomId: player.roomId,
      name: input.name,
      concept: input.concept,
      attributes: { ...input.attributes },
      confirmed: false,
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
   * Start the session, transitioning the room to `in_session` only when
   * {@link CharacterService.canStart} holds (Requirements 4.7, 5.1).
   *
   * Rejects when the room is unknown (`UNKNOWN_ROOM`), not in `lobby`
   * (`ROOM_NOT_IN_LOBBY`), or not every player has confirmed a character
   * (`NOT_ALL_CONFIRMED`). The room is left unchanged on rejection.
   */
  startSession(roomId: string): StartSessionResult {
    const room = this.store.getRoom(roomId);
    if (room === undefined) {
      return { ok: false, reason: "UNKNOWN_ROOM", message: `Unknown room id: ${roomId}` };
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

/** Normalize a character name for room-unique comparison (Requirement 4.6). */
function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/** Defensive copy so callers cannot mutate stored character state. */
function cloneCharacter(character: Character): Character {
  return { ...character, attributes: { ...character.attributes } };
}
