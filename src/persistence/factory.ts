/**
 * Persistence selector — one entry point for the rest of the system (task 16
 * wiring) to obtain its stores.
 *
 * When a Postgres connection string is configured (`DATABASE_URL` /
 * `SUPABASE_DB_URL`), this returns durable, Postgres-backed stores: write-through
 * synchronous {@link RoomStore}/{@link TurnStateStore} adapters plus the async
 * repositories and the durable {@link QueryableEventSink}. Otherwise it returns
 * the synchronous in-memory implementations so development and tests run with no
 * database.
 *
 * No connection is opened at import time, and none is opened unless the Postgres
 * branch is selected.
 */
import process from "node:process";
import { InMemoryRoomStore, type RoomStore } from "../services/room-store.js";
import {
  InMemoryScenarioStore,
  type Scenario,
  type ScenarioStore,
} from "../services/scenario-service.js";
import {
  InMemoryTurnStateStore,
  type TurnStateStore,
} from "../services/turn-state-store.js";
import { InMemoryClockStore, type ClockStore } from "../services/clock-store.js";
import { InMemorySceneStore, type SceneStore } from "../services/scene-store.js";
import {
  InMemoryCharacterStateStore,
  type CharacterStateStore,
} from "../services/character-state-store.js";
import { InMemoryBlackboardStore, type BlackboardStore } from "../services/blackboard-store.js";
import { InMemoryMemoryStore, type MemoryStore } from "../services/memory-store.js";
import { InMemoryEventSink, type EventSink } from "../observability/event-sink.js";
import { getPool, isDatabaseConfigured, type EnvLike } from "./pg-client.js";
import { PgRoomRepository } from "./pg-room-repository.js";
import { PgTurnStateRepository } from "./pg-turn-state-repository.js";
import { PgEventSink } from "./pg-event-sink.js";
import {
  InMemorySessionSummaryRepository,
  PgSessionSummaryRepository,
} from "./pg-session-summary-repository.js";
import { PgRoomStore } from "./pg-room-store.js";
import { PgTurnStateStore } from "./pg-turn-state-store.js";
import { PgClockRepository } from "./pg-clock-repository.js";
import { PgClockStore } from "./pg-clock-store.js";
import { PgSceneRepository } from "./pg-scene-repository.js";
import { PgSceneStore } from "./pg-scene-store.js";
import { PgCharacterStateRepository } from "./pg-character-state-repository.js";
import { PgCharacterStateStore } from "./pg-character-state-store.js";
import { PgBlackboardRepository } from "./pg-blackboard-repository.js";
import { PgBlackboardStore } from "./pg-blackboard-store.js";
import { PgMemoryRepository } from "./pg-memory-repository.js";
import { PgMemoryStore } from "./pg-memory-store.js";
import type { SessionSummaryRepository } from "./types.js";
import type { RoomRepository } from "./types.js";

export type PersistenceMode = "durable" | "memory";

/** The bundle of stores the engine wiring depends on. */
export interface Persistence {
  /** Which backend was selected. */
  backend: "postgres" | "memory";
  /** Async durable room repository, present only for the Postgres backend. */
  roomRepository?: RoomRepository;
  roomStore: RoomStore;
  turnStateStore: TurnStateStore;
  /** Per-room Progress Clocks (Postgres-durable, in-memory otherwise). */
  clockStore: ClockStore;
  /** Per-room Scene State (Postgres-durable, in-memory otherwise). */
  sceneStore: SceneStore;
  /** Per-room mutable Character State (Postgres-durable, in-memory otherwise). */
  characterStateStore: CharacterStateStore;
  /** Per-room ScenarioBlackboard (Postgres-durable, in-memory otherwise). */
  blackboardStore: BlackboardStore;
  /** Per-room Memory Clerk records (Postgres-durable, in-memory otherwise). */
  memoryStore: MemoryStore;
  scenarioStore: ScenarioStore;
  sessionSummaryRepository: SessionSummaryRepository;
  eventSink: EventSink;
}

/** Optional overrides for {@link createPersistence}. */
export interface PersistenceOptions {
  /**
   * Catalog seeded into the in-memory scenario store. Defaults to the single
   * MVP scenario; the local playtest server passes a multi-scenario catalog so
   * the lobby can offer a scenario picker.
   */
  scenarioCatalog?: readonly Scenario[];
}

/**
 * Resolve the explicit persistence mode switch used by server entrypoints.
 * Defaults to memory so local playtests stay friction-free even when a
 * developer has DATABASE_URL in their shell.
 */
export function resolvePersistenceMode(env: EnvLike = process.env): PersistenceMode {
  const raw = env.PERSISTENCE_MODE;
  if (raw === undefined || raw.trim().length === 0) return "memory";
  const normalized = raw.trim().toLowerCase();
  if (normalized === "durable" || normalized === "memory") return normalized;
  throw new Error(`Invalid PERSISTENCE_MODE "${raw}". Expected "durable" or "memory".`);
}

/**
 * Build the persistence bundle for the current environment. Selects the
 * Postgres backend when a connection string is configured, otherwise the
 * in-memory backend.
 */
export function createPersistence(
  env: EnvLike = process.env,
  opts: PersistenceOptions = {},
): Persistence {
  const scenarioStore = new InMemoryScenarioStore(opts.scenarioCatalog);
  if (isDatabaseConfigured(env)) {
    const pool = getPool(env);
    const roomRepository = new PgRoomRepository(pool);
    return {
      backend: "postgres",
      roomRepository,
      roomStore: new PgRoomStore(roomRepository),
      turnStateStore: new PgTurnStateStore(new PgTurnStateRepository(pool)),
      // Durable Postgres-backed clocks + scenes (one jsonb document per room).
      clockStore: new PgClockStore(new PgClockRepository(pool)),
      sceneStore: new PgSceneStore(new PgSceneRepository(pool)),
      // Durable Postgres-backed mutable Character State (one jsonb document
      // per room), so AI-applied state survives restarts like clocks/scenes.
      characterStateStore: new PgCharacterStateStore(new PgCharacterStateRepository(pool)),
      blackboardStore: new PgBlackboardStore(new PgBlackboardRepository(pool)),
      memoryStore: new PgMemoryStore(new PgMemoryRepository(pool)),
      // The catalog is static; durable selection/listing is available via the
      // async PgScenarioRepository for the REST surface (task 16.1).
      scenarioStore,
      sessionSummaryRepository: new PgSessionSummaryRepository(pool),
      eventSink: new PgEventSink(pool),
    };
  }
  return {
    backend: "memory",
    roomStore: new InMemoryRoomStore(),
    turnStateStore: new InMemoryTurnStateStore(),
    clockStore: new InMemoryClockStore(),
    sceneStore: new InMemorySceneStore(),
    characterStateStore: new InMemoryCharacterStateStore(),
    blackboardStore: new InMemoryBlackboardStore(),
    memoryStore: new InMemoryMemoryStore(),
    scenarioStore,
    sessionSummaryRepository: new InMemorySessionSummaryRepository(),
    eventSink: new InMemoryEventSink(),
  };
}

/** A store that can load its persisted rows into its live in-memory cache. */
interface Hydratable {
  hydrate(): Promise<void>;
}

/** True when the store exposes a `hydrate()` method (the Pg adapters do). */
function isHydratable(store: unknown): store is Hydratable {
  return (
    typeof store === "object" &&
    store !== null &&
    typeof (store as Hydratable).hydrate === "function"
  );
}

/**
 * Load all durable rows into the synchronous stores' live caches. The Postgres
 * adapters are write-through caches whose synchronous reads never touch the
 * database, so without this bootstrap a restarted process cannot see any
 * previously persisted room/turn-state/clock/scene/character-state. Call once
 * at startup after {@link createPersistence} when durable recovery is wanted.
 * A no-op on the in-memory backend.
 */
export async function hydratePersistence(persistence: Persistence): Promise<void> {
  if (persistence.backend !== "postgres") return;
  // Rooms first so membership lookups resolve while later stores hydrate.
  const stores: unknown[] = [
    persistence.roomStore,
    persistence.turnStateStore,
    persistence.clockStore,
    persistence.sceneStore,
    persistence.characterStateStore,
    persistence.blackboardStore,
    persistence.memoryStore,
  ];
  for (const store of stores) {
    if (isHydratable(store)) await store.hydrate();
  }
}
