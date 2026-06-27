/**
 * Write-through {@link TurnStateStore} adapter: a synchronous, Postgres-backed
 * Turn_State store.
 *
 * The orchestrator persists Turn_State on every tracked change (Requirement
 * 12.3) through the synchronous {@link TurnStateStore} interface. This adapter
 * serves synchronous reads from an in-memory cache and mirrors every
 * {@link save} through to the durable {@link TurnStateRepository} as a
 * best-effort background write, so the live and durable copies converge without
 * blocking the hot path.
 *
 * Use {@link hydrate} to load persisted Turn_States into the cache, and
 * {@link flush} (tests) to await pending write-throughs.
 */
import type { TurnState } from "../core/turn-state.js";
import { InMemoryTurnStateStore, type TurnStateStore } from "../services/turn-state-store.js";
import type { TurnStateRepository } from "./types.js";

export interface PgTurnStateStoreOptions {
  /** Invoked when a background durable write fails. Defaults to a no-op. */
  onPersistError?: (error: unknown) => void;
}

export class PgTurnStateStore implements TurnStateStore {
  private readonly cache = new InMemoryTurnStateStore();
  private readonly pending = new Set<Promise<void>>();
  private readonly onPersistError: (error: unknown) => void;

  constructor(
    private readonly repository: TurnStateRepository,
    options: PgTurnStateStoreOptions = {},
  ) {
    this.onPersistError = options.onPersistError ?? (() => undefined);
  }

  get(roomId: string): TurnState | undefined {
    return this.cache.get(roomId);
  }

  save(turnState: TurnState): void {
    // Update the live cache synchronously...
    this.cache.save(turnState);
    // ...then mirror to the durable store in the background (best-effort).
    let task: Promise<void>;
    try {
      task = this.repository.save(turnState);
    } catch (error) {
      this.onPersistError(error);
      return;
    }
    const tracked = task
      .catch((error: unknown) => this.onPersistError(error))
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }

  /** Load all persisted Turn_States into the in-memory cache. */
  async hydrate(): Promise<void> {
    for (const state of await this.repository.listAll()) {
      this.cache.save(state);
    }
  }

  /** Await all pending background write-throughs. */
  async flush(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }
}
