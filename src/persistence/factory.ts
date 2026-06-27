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
  type ScenarioStore,
} from "../services/scenario-service.js";
import {
  InMemoryTurnStateStore,
  type TurnStateStore,
} from "../services/turn-state-store.js";
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
import type { SessionSummaryRepository } from "./types.js";

/** The bundle of stores the engine wiring depends on. */
export interface Persistence {
  /** Which backend was selected. */
  backend: "postgres" | "memory";
  roomStore: RoomStore;
  turnStateStore: TurnStateStore;
  scenarioStore: ScenarioStore;
  sessionSummaryRepository: SessionSummaryRepository;
  eventSink: EventSink;
}

/**
 * Build the persistence bundle for the current environment. Selects the
 * Postgres backend when a connection string is configured, otherwise the
 * in-memory backend.
 */
export function createPersistence(env: EnvLike = process.env): Persistence {
  if (isDatabaseConfigured(env)) {
    const pool = getPool(env);
    return {
      backend: "postgres",
      roomStore: new PgRoomStore(new PgRoomRepository(pool)),
      turnStateStore: new PgTurnStateStore(new PgTurnStateRepository(pool)),
      // The MVP catalog is static; durable selection/listing is available via
      // the async PgScenarioRepository for the REST surface (task 16.1).
      scenarioStore: new InMemoryScenarioStore(),
      sessionSummaryRepository: new PgSessionSummaryRepository(pool),
      eventSink: new PgEventSink(pool),
    };
  }
  return {
    backend: "memory",
    roomStore: new InMemoryRoomStore(),
    turnStateStore: new InMemoryTurnStateStore(),
    scenarioStore: new InMemoryScenarioStore(),
    sessionSummaryRepository: new InMemorySessionSummaryRepository(),
    eventSink: new InMemoryEventSink(),
  };
}
