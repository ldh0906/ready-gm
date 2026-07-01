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
import type { SessionSummaryRepository } from "./types.js";

/** The bundle of stores the engine wiring depends on. */
export interface Persistence {
  /** Which backend was selected. */
  backend: "postgres" | "memory";
  roomStore: RoomStore;
  turnStateStore: TurnStateStore;
  /** Per-room Progress Clocks (Postgres-durable, in-memory otherwise). */
  clockStore: ClockStore;
  /** Per-room Scene State (Postgres-durable, in-memory otherwise). */
  sceneStore: SceneStore;
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
    return {
      backend: "postgres",
      roomStore: new PgRoomStore(new PgRoomRepository(pool)),
      turnStateStore: new PgTurnStateStore(new PgTurnStateRepository(pool)),
      // Durable Postgres-backed clocks + scenes (one jsonb document per room).
      clockStore: new PgClockStore(new PgClockRepository(pool)),
      sceneStore: new PgSceneStore(new PgSceneRepository(pool)),
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
    scenarioStore,
    sessionSummaryRepository: new InMemorySessionSummaryRepository(),
    eventSink: new InMemoryEventSink(),
  };
}
