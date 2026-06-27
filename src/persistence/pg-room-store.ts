/**
 * Write-through {@link RoomStore} adapter: a synchronous, Postgres-backed Room
 * store.
 *
 * The orchestrator and Room Service depend on the synchronous {@link RoomStore}
 * interface, but Postgres I/O is asynchronous. This adapter bridges the two: an
 * in-memory cache serves synchronous reads, and every write is mirrored through
 * to the durable {@link RoomRepository} as a best-effort background write so the
 * room survives restarts (Requirements 1.1, 1.2, 2.x, 4.x).
 *
 * Durable-write failures never surface to the caller; they are reported via the
 * optional {@link PgRoomStoreOptions.onPersistError} hook. Use {@link hydrate}
 * on startup to load durable state into the cache, and {@link flush} (tests) to
 * await pending write-throughs.
 */
import { InMemoryRoomStore, type RoomStore } from "../services/room-store.js";
import type { Character, Player, Room } from "../services/types.js";
import type { RoomRepository } from "./types.js";

export interface PgRoomStoreOptions {
  /** Invoked when a background durable write fails. Defaults to a no-op. */
  onPersistError?: (error: unknown) => void;
}

export class PgRoomStore implements RoomStore {
  private readonly cache = new InMemoryRoomStore();
  private readonly pending = new Set<Promise<void>>();
  private readonly onPersistError: (error: unknown) => void;

  constructor(
    private readonly repository: RoomRepository,
    options: PgRoomStoreOptions = {},
  ) {
    this.onPersistError = options.onPersistError ?? (() => undefined);
  }

  /** Mirror a durable write in the background, never throwing to the caller. */
  private writeThrough(op: () => Promise<void>): void {
    let task: Promise<void>;
    try {
      task = op();
    } catch (error) {
      this.onPersistError(error);
      return;
    }
    const tracked = task
      .catch((error: unknown) => this.onPersistError(error))
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }

  saveRoom(room: Room): void {
    this.cache.saveRoom(room);
    this.writeThrough(() => this.repository.saveRoom(room));
  }

  getRoom(roomId: string): Room | undefined {
    return this.cache.getRoom(roomId);
  }

  getRoomByToken(token: string): Room | undefined {
    return this.cache.getRoomByToken(token);
  }

  savePlayer(player: Player): void {
    this.cache.savePlayer(player);
    this.writeThrough(() => this.repository.savePlayer(player));
  }

  getPlayer(playerId: string): Player | undefined {
    return this.cache.getPlayer(playerId);
  }

  listPlayers(roomId: string): Player[] {
    return this.cache.listPlayers(roomId);
  }

  saveCharacter(character: Character): void {
    this.cache.saveCharacter(character);
    this.writeThrough(() => this.repository.saveCharacter(character));
  }

  getCharacter(characterId: string): Character | undefined {
    return this.cache.getCharacter(characterId);
  }

  listCharactersByRoom(roomId: string): Character[] {
    return this.cache.listCharactersByRoom(roomId);
  }

  /**
   * Load all durable room state (rooms, players, characters) into the in-memory
   * cache so subsequent synchronous reads reflect persisted data.
   */
  async hydrate(): Promise<void> {
    for (const room of await this.repository.listRooms()) {
      this.cache.saveRoom(room);
    }
    for (const player of await this.repository.listAllPlayers()) {
      this.cache.savePlayer(player);
    }
    for (const character of await this.repository.listAllCharacters()) {
      this.cache.saveCharacter(character);
    }
  }

  /** Await all pending background write-throughs. */
  async flush(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }
}
