/**
 * Durable domain entity types for the services layer.
 *
 * These mirror the "Durable Entities (PostgreSQL)" data models in design.md.
 * They carry no runtime dependencies so the service logic stays unit-testable
 * with an in-memory store before persistence is wired in (task 14).
 *
 * Sources: design.md "Data Models" — Durable Entities.
 * Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.6
 */
import type { AttributeKey, AttributeLevel } from "../core/types.js";

/** Lifecycle state of a Room (design.md Room Lifecycle State Machine). */
export type RoomState = "lobby" | "in_session" | "ended";

/**
 * A single session container. Identified by a unique {@link Room.id} and mapped
 * 1:1 to an unguessable {@link Room.inviteToken} (Requirements 1.1, 1.2).
 */
export interface Room {
  /** Unique room identifier (Requirement 1.1). */
  id: string;
  /** Unguessable, high-entropy invite token; 1:1 with the room (Requirement 1.2). */
  inviteToken: string;
  /** The Player who created the Room and holds elevated control (Requirement 1.1). */
  hostPlayerId: string;
  /** Selected scenario, or `null` until one is chosen (Requirement 3.2). */
  scenarioId: string | null;
  /** Lifecycle state; gates joins and restarts (Requirements 5.x, 15.6). */
  state: RoomState;
  /** Maximum players per room (Requirement 1.4). */
  maxPlayers: number;
  /** ISO timestamp of room creation. */
  createdAt: string;
}

/** A participant in a Room, including the Host. */
export interface Player {
  id: string;
  roomId: string;
  /** Display name, unique within the room (Requirement 2.6). */
  displayName: string;
  /** True for the Host (Requirement 9.4). */
  isHost: boolean;
  characterId: string | null;
  connectionStatus: "connected" | "disconnected";
}

/**
 * Ruleset-specific original sheet data captured at character creation and
 * preserved verbatim (the Living Character Sheet's immutable half). This holds
 * what the character screen collected beyond name/concept/attributes — e.g.
 * Terrible Geese's disposition/goal, Until It Sinks's narrative card answers —
 * so those fields survive the backend/persistence round-trip and can ground
 * the AI GM's narration. Mutable in-session facts live in the separate
 * CharacterState object, never here.
 */
export interface CharacterSheetData {
  /**
   * Narrative field values keyed by the sheet schema's field id (e.g.
   * `disposition`, `goal`). Stored verbatim (trimmed by the client).
   */
  narrativeFields?: Record<string, string>;
}

/** A Player's in-game persona with EZFudge attributes (Requirement 4.2). */
export interface Character {
  id: string;
  playerId: string;
  roomId: string;
  /** Character name, unique within the room (Requirement 4.6). */
  name: string;
  concept: string;
  attributes: Record<AttributeKey, AttributeLevel>;
  /** Locks attributes against revision when true (Requirement 4.4). */
  confirmed: boolean;
  /**
   * The Card_Id of the Selected_Card on a Card_Based_Sheet, preserved across
   * record/confirm so it round-trips with the character
   * (scenario-character-cards Requirements 6.1, 8.3). Absent on non-card sheets.
   */
  selectedCardId?: string;
  /**
   * Ruleset-specific original sheet fields, preserved from record through
   * confirm and persistence. Absent when the sheet collected nothing beyond
   * the core fields.
   */
  sheetData?: CharacterSheetData;
}

/**
 * The input needed to create a Player. The engine assigns the durable
 * {@link Player.id}; callers only supply the requested display name.
 */
export interface PlayerInit {
  /** The display name requested by the joining/creating Player. */
  displayName: string;
}

/**
 * Returned when an invite token does not resolve to a live Room. Surfaced to
 * the client as the "Room unavailable" message (Requirement 2.2).
 */
export interface RoomUnavailable {
  ok: false;
  reason: "ROOM_UNAVAILABLE";
  message: string;
}

/** Type guard distinguishing a {@link RoomUnavailable} result from a {@link Room}. */
export function isRoomUnavailable(value: Room | RoomUnavailable): value is RoomUnavailable {
  return (value as RoomUnavailable).ok === false;
}

/**
 * Outcome of a {@link Room} join attempt (design.md "1. Room Service").
 *
 * On success the joining {@link Player} is returned along with the display name
 * actually assigned, which may differ from the requested name when it had to be
 * disambiguated for uniqueness within the room (Requirement 2.6).
 *
 * Failure carries a constrained reason plus a human-readable message:
 * - `ROOM_FULL` — the room already holds {@link Room.maxPlayers} players
 *   (Requirements 2.3, 2.4).
 * - `ROOM_UNAVAILABLE` — the token is unknown or the room is no longer joinable
 *   because it has left the `lobby` state (Requirements 2.2, 1.5).
 */
export type JoinResult =
  | { ok: true; room: Room; player: Player; assignedName: string }
  | { ok: false; reason: "ROOM_FULL"; message: string }
  | { ok: false; reason: "ROOM_UNAVAILABLE"; message: string };
