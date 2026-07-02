import type { ScenarioBlackboard } from "../core/scenario-blackboard.js";
import { InMemoryBlackboardStore, type BlackboardStore } from "../services/blackboard-store.js";
import type { BlackboardRepository } from "./types.js";

export interface PgBlackboardStoreOptions {
  onPersistError?: (error: unknown) => void;
}

export class PgBlackboardStore implements BlackboardStore {
  private readonly cache = new InMemoryBlackboardStore();
  private readonly pending = new Set<Promise<void>>();
  private readonly onPersistError: (error: unknown) => void;

  constructor(
    private readonly repository: BlackboardRepository,
    options: PgBlackboardStoreOptions = {},
  ) {
    this.onPersistError = options.onPersistError ?? (() => undefined);
  }

  get(roomId: string): ScenarioBlackboard | undefined {
    return this.cache.get(roomId);
  }

  save(roomId: string, blackboard: ScenarioBlackboard): void {
    this.cache.save(roomId, blackboard);
    let task: Promise<void>;
    try {
      task = this.repository.save(roomId, blackboard);
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
      this.cache.save(record.roomId, record.blackboard);
    }
  }

  async flush(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }
}
