/**
 * Write-through {@link CharacterStateStore} adapter: a synchronous,
 * Postgres-backed mutable Character State store.
 *
 * The orchestrator reads/writes a room's Character States synchronously through
 * {@link CharacterStateStore}; this adapter serves reads from an in-memory cache
 * and mirrors every {@link save} through to the durable
 * {@link CharacterStateRepository} as a best-effort background write, so the
 * live and durable copies converge without blocking the hot path (mirrors
 * {@link import("./pg-clock-store.js").PgClockStore}). Hydration re-normalizes
 * each persisted document through the in-memory store's copy semantics
 * (`makeCharacterState`), so malformed numeric fields are clamped on load.
 */
import type { CharacterState } from "../core/character-state.js";
import {
  InMemoryCharacterStateStore,
  type CharacterStateStore,
} from "../services/character-state-store.js";
import type { CharacterStateRepository } from "./types.js";

export interface PgCharacterStateStoreOptions {
  /** Invoked when a background durable write fails. Defaults to a no-op. */
  onPersistError?: (error: unknown) => void;
}

export class PgCharacterStateStore implements CharacterStateStore {
  private readonly cache = new InMemoryCharacterStateStore();
  private readonly pending = new Set<Promise<void>>();
  private readonly onPersistError: (error: unknown) => void;

  constructor(
    private readonly repository: CharacterStateRepository,
    options: PgCharacterStateStoreOptions = {},
  ) {
    this.onPersistError = options.onPersistError ?? (() => undefined);
  }

  get(roomId: string): CharacterState[] {
    return this.cache.get(roomId);
  }

  save(roomId: string, states: readonly CharacterState[]): void {
    this.cache.save(roomId, states);
    let task: Promise<void>;
    try {
      task = this.repository.save(roomId, states);
    } catch (error) {
      this.onPersistError(error);
      return;
    }
    const tracked = task
      .catch((error: unknown) => this.onPersistError(error))
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }

  /** Load all persisted character states into the in-memory cache. */
  async hydrate(): Promise<void> {
    for (const record of await this.repository.listAll()) {
      this.cache.save(record.roomId, record.states);
    }
  }

  /** Await all pending background write-throughs. */
  async flush(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }
}
