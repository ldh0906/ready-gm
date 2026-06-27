/**
 * Persistence layer: durable PostgreSQL repositories, write-through stores, and
 * the queryable QA event sink.
 *
 * The synchronous in-memory stores in `services/` remain the default/test
 * fallback; this layer adds durable Postgres backing behind the same service
 * interfaces (via write-through adapters) plus async repositories for the
 * remaining durable entities.
 */
export * from "./pg-client.js";
export * from "./types.js";
export * from "./mappers.js";
export * from "./pg-room-repository.js";
export * from "./pg-turn-state-repository.js";
export * from "./pg-scenario-repository.js";
export * from "./pg-session-summary-repository.js";
export * from "./pg-event-sink.js";
export * from "./pg-room-store.js";
export * from "./pg-turn-state-store.js";
export * from "./factory.js";
export {
  runMigrations,
  listMigrationFiles,
  defaultMigrationsDir,
  type MigrationRunResult,
} from "./migrate.js";
