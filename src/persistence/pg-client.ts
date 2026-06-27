/**
 * PostgreSQL connection plumbing for the durable persistence layer.
 *
 * This module is the ONLY place that touches the `pg` driver. Repositories and
 * the event sink depend on the small {@link Queryable} abstraction (just a
 * parameterized `query` method), so they can be unit-tested against a fake
 * client ({@link import("./fake-pg.js").FakePgClient}) with no live database.
 *
 * Connection rules (per task 14.1):
 *  - The connection string comes from `DATABASE_URL` (preferred) or
 *    `SUPABASE_DB_URL` (fallback) — the Supabase pooler/URI.
 *  - Pools are created LAZILY (never at import time) so importing this module —
 *    and therefore the whole persistence barrel — never opens a socket.
 *  - When no connection string is configured, callers fall back to the
 *    in-memory stores; {@link getConnectionString} reports `undefined`.
 *
 * Requirements: 12.3, 15.3, 18.1, 18.2 (durable storage substrate).
 */
import process from "node:process";
import pkg from "pg";
import type { Pool, PoolConfig } from "pg";

// `pg` is published as CommonJS; destructure the runtime value from the default
// import so this works under Node's native ESM loader.
const { Pool: PgPool } = pkg;

/** A single database row as a plain column map. */
export type QueryResultRow = Record<string, unknown>;

/**
 * The read-only environment shape this module needs — structurally compatible
 * with `process.env` without depending on the ambient `NodeJS` global.
 */
export type EnvLike = Record<string, string | undefined>;

/** The subset of a `pg` query result we depend on. */
export interface QueryResultLike<R extends QueryResultRow = QueryResultRow> {
  rows: R[];
  rowCount: number | null;
}

/**
 * Minimal parameterized-query surface the persistence layer depends on. Both a
 * real {@link Pool} and test fakes satisfy it.
 *
 * Implementations MUST use parameterized queries (`$1, $2, ...`) — never string
 * interpolation — to avoid SQL injection.
 */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResultLike<R>>;
}

/**
 * Resolve the Postgres connection string from the environment, preferring
 * `DATABASE_URL` and falling back to `SUPABASE_DB_URL`. Returns `undefined`
 * when neither is set (or is blank) — the signal to use the in-memory stores.
 */
export function getConnectionString(env: EnvLike = process.env): string | undefined {
  const url = env.DATABASE_URL ?? env.SUPABASE_DB_URL;
  return url !== undefined && url.trim().length > 0 ? url : undefined;
}

/** Whether a durable database is configured (a connection string is present). */
export function isDatabaseConfigured(env: EnvLike = process.env): boolean {
  return getConnectionString(env) !== undefined;
}

/**
 * Create a brand-new {@link Pool} from the configured connection string. Throws
 * when no connection string is set — gate on {@link isDatabaseConfigured} first.
 */
export function createPool(env: EnvLike = process.env, options: PoolConfig = {}): Pool {
  const connectionString = getConnectionString(env);
  if (connectionString === undefined) {
    throw new Error(
      "No database connection string configured. Set DATABASE_URL (or SUPABASE_DB_URL).",
    );
  }
  return new PgPool({ connectionString, ...options });
}

// Lazily-created process-wide pool. Never created at import time.
let cachedPool: Pool | undefined;

/**
 * Get the lazily-created shared {@link Pool}, creating it on first use. Throws
 * when no connection string is configured.
 */
export function getPool(env: EnvLike = process.env): Pool {
  if (cachedPool === undefined) {
    cachedPool = createPool(env);
  }
  return cachedPool;
}

/** Close and discard the shared pool, if one was created. Safe to call always. */
export async function closePool(): Promise<void> {
  if (cachedPool !== undefined) {
    const pool = cachedPool;
    cachedPool = undefined;
    await pool.end();
  }
}
