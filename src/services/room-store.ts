/**
 * Room storage abstraction for the Room Service.
 *
 * Persistence is a later task (14); for now the service runs against an
 * in-memory implementation behind this interface so the logic stays testable
 * and the durable store can be swapped in without touching the service.
 *
 * Requirements: 1.1, 1.2, 1.3, 2.1, 2.2
 */
import type { Character, Player, Room } from "./types.js";

/**
 * Storage surface the Room Service depends on. Implementations must keep the
 * invite-token → room mapping 1:1 (Requirement 1.2).
 */
export interface RoomStore {
  /** Persist a room. Overwrites any existing room with the same id. */
  saveRoom(room: Room): void;
  /** Fetch a room by its unique id, or `undefined` if none exists. */
  getRoom(roomId: string): Room | undefined;
  /** Fetch a room by its invite token, or `undefined` if the token is unknown. */
  getRoomByToken(token: string): Room | undefined;
  /** Persist a player. Overwrites any existing player with the same id. */
  savePlayer(player: Player): void;
  /** Fetch a player by id, or `undefined` if none exists. */
  getPlayer(playerId: string): Player | undefined;
  /**
   * List all players belonging to a room (any order). Used to enforce capacity
   * before adding a player and to assign a room-unique display name
   * (Requirements 2.3, 2.4, 2.6).
   */
  listPlayers(roomId: string): Player[];
  /** Persist a character. Overwrites any existing character with the same id. */
  saveCharacter(character: Character): void;
  /** Fetch a character by id, or `undefined` if none exists. */
  getCharacter(characterId: string): Character | undefined;
  /**
   * List all characters recorded in a room (any order). Used to enforce
   * room-unique character names and to gate session start on every player
   * having a confirmed character (Requirements 4.6, 4.7, 5.1).
   */
  listCharactersByRoom(roomId: string): Character[];
}

/**
 * A simple in-process {@link RoomStore} backed by `Map`s. Suitable for tests
 * and single-instance development until durable persistence lands (task 14).
 */
export class InMemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<string, Room>();
  private readonly roomsByToken = new Map<string, Room>();
  private readonly players = new Map<string, Player>();
  private readonly characters = new Map<string, Character>();

  saveRoom(room: Room): void {
    this.rooms.set(room.id, room);
    this.roomsByToken.set(room.inviteToken, room);
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  getRoomByToken(token: string): Room | undefined {
    return this.roomsByToken.get(token);
  }

  savePlayer(player: Player): void {
    this.players.set(player.id, player);
  }

  getPlayer(playerId: string): Player | undefined {
    return this.players.get(playerId);
  }

  listPlayers(roomId: string): Player[] {
    return [...this.players.values()].filter((player) => player.roomId === roomId);
  }

  saveCharacter(character: Character): void {
    this.characters.set(character.id, character);
  }

  getCharacter(characterId: string): Character | undefined {
    return this.characters.get(characterId);
  }

  listCharactersByRoom(roomId: string): Character[] {
    return [...this.characters.values()].filter((character) => character.roomId === roomId);
  }
}
