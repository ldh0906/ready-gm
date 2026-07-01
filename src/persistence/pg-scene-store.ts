/**
 * Write-through {@link SceneStore} adapter: a synchronous, Postgres-backed Scene
 * State store.
 *
 * Reads are served from an in-memory cache; every {@link save} mirrors through
 * to the durable {@link SceneRepository} as a best-effort background write
 * (mirrors {@link import("./pg-turn-state-store.js").PgTurnStateStore}).
 */
import type { SceneState } from "../core/scene-state.js";
import { InMemorySceneStore, type SceneStore } from "../services/scene-store.js";
import type { SceneRepository } from "./types.js";

export interface PgSceneStoreOptions {
  /** Invoked when a background durable write fails. Defaults to a no-op. */
  onPersistError?: (error: unknown) => void;
}

export class PgSceneStore implements SceneStore {
  private readonly cache = new InMemorySceneStore();
  private readonly pending = new Set<Promise<void>>();
  private readonly onPersistError: (error: unknown) => void;

  constructor(
    private readonly repository: SceneRepository,
    options: PgSceneStoreOptions = {},
  ) {
    this.onPersistError = options.onPersistError ?? (() => undefined);
  }

  get(roomId: string): SceneState | undefined {
    return this.cache.get(roomId);
  }

  save(roomId: string, scene: SceneState): void {
    this.cache.save(roomId, scene);
    let task: Promise<void>;
    try {
      task = this.repository.save(roomId, scene);
    } catch (error) {
      this.onPersistError(error);
      return;
    }
    const tracked = task
      .catch((error: unknown) => this.onPersistError(error))
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }

  /** Load all persisted scenes into the in-memory cache. */
  async hydrate(): Promise<void> {
    for (const record of await this.repository.listAll()) {
      this.cache.save(record.roomId, record.scene);
    }
  }

  /** Await all pending background write-throughs. */
  async flush(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }
}
