import type { MemoryRecord } from "../core/memory-record.js";
import { InMemoryMemoryStore, type MemoryStore } from "../services/memory-store.js";
import type { MemoryRepository } from "./types.js";

export interface PgMemoryStoreOptions {
  onPersistError?: (error: unknown) => void;
}

export class PgMemoryStore implements MemoryStore {
  private readonly cache = new InMemoryMemoryStore();
  private readonly pending = new Set<Promise<void>>();
  private readonly onPersistError: (error: unknown) => void;

  constructor(
    private readonly repository: MemoryRepository,
    options: PgMemoryStoreOptions = {},
  ) {
    this.onPersistError = options.onPersistError ?? (() => undefined);
  }

  list(roomId: string): MemoryRecord[] {
    return this.cache.list(roomId);
  }

  save(roomId: string, records: readonly MemoryRecord[]): void {
    this.cache.save(roomId, records);
    let task: Promise<void>;
    try {
      task = this.repository.save(roomId, records);
    } catch (error) {
      this.onPersistError(error);
      return;
    }
    const tracked = task
      .catch((error: unknown) => this.onPersistError(error))
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }

  async hydrate(): Promise<void> {
    for (const record of await this.repository.listAll()) {
      this.cache.save(record.roomId, record.records);
    }
  }

  async flush(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }
}
