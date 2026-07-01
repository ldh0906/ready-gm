/**
 * Write-through {@link ClockStore} adapter: a synchronous, Postgres-backed
 * Progress Clock store.
 *
 * The orchestrator reads/writes clocks synchronously through {@link ClockStore};
 * this adapter serves reads from an in-memory cache and mirrors every
 * {@link save} through to the durable {@link ClockRepository} as a best-effort
 * background write, so the live and durable copies converge without blocking the
 * hot path (mirrors {@link import("./pg-turn-state-store.js").PgTurnStateStore}).
 */
import type { ProgressClock } from "../core/progress-clock.js";
import { InMemoryClockStore, type ClockStore } from "../services/clock-store.js";
import type { ClockRepository } from "./types.js";

export interface PgClockStoreOptions {
  /** Invoked when a background durable write fails. Defaults to a no-op. */
  onPersistError?: (error: unknown) => void;
}

export class PgClockStore implements ClockStore {
  private readonly cache = new InMemoryClockStore();
  private readonly pending = new Set<Promise<void>>();
  private readonly onPersistError: (error: unknown) => void;

  constructor(
    private readonly repository: ClockRepository,
    options: PgClockStoreOptions = {},
  ) {
    this.onPersistError = options.onPersistError ?? (() => undefined);
  }

  get(roomId: string): ProgressClock[] {
    return this.cache.get(roomId);
  }

  save(roomId: string, clocks: readonly ProgressClock[]): void {
    this.cache.save(roomId, clocks);
    let task: Promise<void>;
    try {
      task = this.repository.save(roomId, clocks);
    } catch (error) {
      this.onPersistError(error);
      return;
    }
    const tracked = task
      .catch((error: unknown) => this.onPersistError(error))
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }

  /** Load all persisted clocks into the in-memory cache. */
  async hydrate(): Promise<void> {
    for (const record of await this.repository.listAll()) {
      this.cache.save(record.roomId, record.clocks);
    }
  }

  /** Await all pending background write-throughs. */
  async flush(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }
}
