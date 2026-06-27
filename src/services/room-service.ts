/**
 * Room Service — room creation, invite tokens, and invite resolution.
 *
 * This file implements the room-creation and invitation portion of the Room
 * Service (design.md "Components and Interfaces" — 1. Room Service). Joining,
 * scenario selection, and character recording are added in later tasks.
 *
 * Key behavioral rules implemented here:
 * - Every created room has a unique id and an unguessable, high-entropy invite
 *   token mapped 1:1 to the room (Requirements 1.1, 1.2).
 * - The requesting Player is designated as the Host (Requirement 1.1).
 * - The invite link for an existing room can be fetched (Requirement 1.3).
 * - An invite token resolves back to its room; an unknown/invalid token yields
 *   a "Room unavailable" result (Requirements 2.1, 2.2).
 *
 * Requirements: 1.1, 1.2, 1.3, 2.1, 2.2
 */
import { randomBytes, randomUUID } from "node:crypto";
import { DEFAULT_ENGINE_CONFIG } from "../core/config.js";
import type { EngineConfig } from "../core/types.js";
import { InMemoryRoomStore, type RoomStore } from "./room-store.js";
import type { JoinResult, Player, PlayerInit, Room, RoomUnavailable } from "./types.js";

/** Default base URL prepended to an invite token to form a shareable link. */
export const DEFAULT_INVITE_BASE_URL = "https://ready-gm/r/";

/** Number of random bytes used for an invite token (~192 bits of entropy). */
const INVITE_TOKEN_BYTES = 24;

/** The "Room unavailable" message surfaced for an invalid token (Requirement 2.2). */
export const ROOM_UNAVAILABLE_MESSAGE = "This room link is invalid or the session no longer exists.";

/** The "Room full" message surfaced when a join is rejected at capacity (Requirement 2.4). */
export const ROOM_FULL_MESSAGE = "This room is full.";

/**
 * Injectable dependencies for {@link RoomService}. All have sensible defaults;
 * tests may override the id/token generators for determinism.
 */
export interface RoomServiceOptions {
  /** Storage backend; defaults to an in-memory store (task 14 swaps this out). */
  store?: RoomStore;
  /** Engine configuration; supplies `maxPlayers` (Requirement 1.4). */
  config?: EngineConfig;
  /** Base URL used to build invite links (design.md Screen 1). */
  inviteBaseUrl?: string;
  /** Unique room id generator; defaults to a random UUID v4. */
  generateRoomId?: () => string;
  /** Unique player id generator; defaults to a random UUID v4. */
  generatePlayerId?: () => string;
  /** High-entropy invite token generator; defaults to a random URL-safe token. */
  generateInviteToken?: () => string;
  /** Clock for `createdAt`; defaults to wall-clock now. */
  now?: () => Date;
}

/**
 * Owns room records, invite tokens, and (in later tasks) membership and
 * lifecycle transitions. This task implements creation and invite resolution.
 */
export class RoomService {
  private readonly store: RoomStore;
  private readonly config: EngineConfig;
  private readonly inviteBaseUrl: string;
  private readonly generateRoomId: () => string;
  private readonly generatePlayerId: () => string;
  private readonly generateInviteToken: () => string;
  private readonly now: () => Date;

  constructor(options: RoomServiceOptions = {}) {
    this.store = options.store ?? new InMemoryRoomStore();
    this.config = options.config ?? DEFAULT_ENGINE_CONFIG;
    this.inviteBaseUrl = options.inviteBaseUrl ?? DEFAULT_INVITE_BASE_URL;
    this.generateRoomId = options.generateRoomId ?? (() => randomUUID());
    this.generatePlayerId = options.generatePlayerId ?? (() => randomUUID());
    this.generateInviteToken =
      options.generateInviteToken ?? (() => randomBytes(INVITE_TOKEN_BYTES).toString("base64url"));
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Create a new Room and designate the requesting Player as its Host.
   *
   * Produces a unique room id and an unguessable invite token mapped 1:1 to the
   * room, persists both the room and the host player, and returns the room
   * (Requirements 1.1, 1.2).
   */
  createRoom(hostPlayer: PlayerInit): Room {
    const roomId = this.generateRoomId();
    const hostPlayerId = this.generatePlayerId();

    const room: Room = {
      id: roomId,
      inviteToken: this.generateInviteToken(),
      hostPlayerId,
      scenarioId: null,
      state: "lobby",
      maxPlayers: this.config.maxPlayers,
      createdAt: this.now().toISOString(),
    };

    const host: Player = {
      id: hostPlayerId,
      roomId,
      displayName: hostPlayer.displayName,
      isHost: true,
      characterId: null,
      connectionStatus: "connected",
    };

    this.store.saveRoom(room);
    this.store.savePlayer(host);

    return room;
  }

  /**
   * Return the shareable invite link for an existing room (Requirement 1.3).
   *
   * @throws {Error} if no room exists for `roomId`.
   */
  getInviteLink(roomId: string): string {
    const room = this.store.getRoom(roomId);
    if (room === undefined) {
      throw new Error(`Unknown room id: ${roomId}`);
    }
    return this.buildInviteLink(room.inviteToken);
  }

  /**
   * Resolve an invite token back to its Room (Requirement 2.1). An unknown or
   * invalid token yields a {@link RoomUnavailable} "Room unavailable" result
   * rather than throwing (Requirement 2.2).
   */
  resolveInvite(token: string): Room | RoomUnavailable {
    const room = this.store.getRoomByToken(token);
    if (room === undefined) {
      return {
        ok: false,
        reason: "ROOM_UNAVAILABLE",
        message: ROOM_UNAVAILABLE_MESSAGE,
      };
    }
    return room;
  }

  /**
   * Add a Player to the Room identified by an invite token (Requirements 2.1–2.6).
   *
   * Enforces, in order:
   * 1. Token resolution — an unknown token yields `ROOM_UNAVAILABLE` (R2.2).
   * 2. Lobby gating — joins are admitted only while the room is in `lobby`;
   *    a room that has started or ended is no longer joinable and yields
   *    `ROOM_UNAVAILABLE` (Requirement 1.5).
   * 3. Capacity — the current player count is checked against
   *    {@link Room.maxPlayers} **before** adding; a join against a full room is
   *    rejected with `ROOM_FULL` and leaves the room unchanged
   *    (Requirements 1.4, 2.3, 2.4).
   *
   * On success the Player is assigned a display name unique within the room,
   * disambiguating the requested name on collision (Requirement 2.6).
   */
  joinRoom(token: string, player: PlayerInit): JoinResult {
    const room = this.store.getRoomByToken(token);
    if (room === undefined) {
      return { ok: false, reason: "ROOM_UNAVAILABLE", message: ROOM_UNAVAILABLE_MESSAGE };
    }

    // Joins are allowed only while the room has not started (Requirement 1.5).
    if (room.state !== "lobby") {
      return { ok: false, reason: "ROOM_UNAVAILABLE", message: ROOM_UNAVAILABLE_MESSAGE };
    }

    // Capacity is checked BEFORE adding the player (Requirements 2.3, 2.4, 1.4).
    const existing = this.store.listPlayers(room.id);
    if (existing.length >= room.maxPlayers) {
      return { ok: false, reason: "ROOM_FULL", message: ROOM_FULL_MESSAGE };
    }

    const assignedName = this.assignUniqueDisplayName(
      player.displayName,
      existing.map((p) => p.displayName),
    );

    const joined: Player = {
      id: this.generatePlayerId(),
      roomId: room.id,
      displayName: assignedName,
      isHost: false,
      characterId: null,
      connectionStatus: "connected",
    };

    this.store.savePlayer(joined);

    return { ok: true, room, player: joined, assignedName };
  }

  /**
   * Produce a display name unique within the room (Requirement 2.6).
   *
   * Returns the requested name unchanged when it does not collide with an
   * existing name; otherwise appends an incrementing ` (n)` suffix until the
   * result is unique. Comparison is case-sensitive and uses the names exactly
   * as stored.
   */
  private assignUniqueDisplayName(requested: string, taken: readonly string[]): string {
    const existing = new Set(taken);
    if (!existing.has(requested)) {
      return requested;
    }
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${requested} (${suffix})`;
      if (!existing.has(candidate)) {
        return candidate;
      }
    }
  }

  /** Compose a full invite link from a token using the configured base URL. */
  private buildInviteLink(token: string): string {
    return `${this.inviteBaseUrl}${token}`;
  }
}
