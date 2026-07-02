/**
 * Migration runner — applies the plain `.sql` files under `migrations/` in
 * filename order against the configured Postgres database.
 *
 * Applied migrations are recorded in a `schema_migrations` table so re-running
 * only applies new files. Each migration runs inside a transaction; the
 * individual `.sql` files are also written idempotently (IF NOT EXISTS / ON
 * CONFLICT) as a second layer of safety.
 *
 * Run it with `npm run db:migrate` (which builds first, then executes the
 * compiled output). The connection string is read from `DATABASE_URL`, falling
 * back to `SUPABASE_DB_URL` — nothing is hardcoded.
 *
 * Importing this module has no side effects; the runner only executes when the
 * file is invoked directly as a script.
 */
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { pathToFileURL } from "node:url";
import type { Pool } from "pg";
import { closePool, getConnectionString, getPool } from "./pg-client.js";

/** Default location of the `.sql` migration files, relative to the cwd. */
export function defaultMigrationsDir(): string {
  return path.join(process.cwd(), "migrations");
}

/** List the `.sql` migration filenames in a directory, sorted lexicographically. */
export async function listMigrationFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((name) => name.endsWith(".sql")).sort((a, b) => a.localeCompare(b));
}

const CREATE_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  checksum_sha256 TEXT
)
`;

const ADD_CHECKSUM_COLUMN = `
ALTER TABLE schema_migrations
  ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT
`;

const MIGRATION_ADVISORY_LOCK_ID = 733447021;

export function checksumSql(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

/** The outcome of a {@link runMigrations} invocation. */
export interface MigrationRunResult {
  /** Filenames applied during this run, in order. */
  applied: string[];
  /** Filenames skipped because they were already recorded as applied. */
  skipped: string[];
}

/**
 * Apply all pending migrations from `dir` against `pool`. Idempotent: files
 * already recorded in `schema_migrations` are skipped.
 */
export async function runMigrations(
  pool: Pool,
  dir: string = defaultMigrationsDir(),
): Promise<MigrationRunResult> {
  await pool.query(CREATE_MIGRATIONS_TABLE);
  await pool.query(ADD_CHECKSUM_COLUMN);
  await pool.query("SELECT pg_advisory_lock($1)", [MIGRATION_ADVISORY_LOCK_ID]);

  try {
    const files = await listMigrationFiles(dir);
    const fileChecksums = new Map<string, string>();
    for (const filename of files) {
      fileChecksums.set(filename, checksumSql(await readFile(path.join(dir, filename), "utf8")));
    }

    const { rows } = await pool.query<{ filename: string; checksum_sha256: string | null }>(
      "SELECT filename, checksum_sha256 FROM schema_migrations",
    );
    const alreadyApplied = new Set<string>();
    for (const row of rows) {
      alreadyApplied.add(row.filename);
      const currentChecksum = fileChecksums.get(row.filename);
      if (currentChecksum === undefined) continue;
      if (row.checksum_sha256 === null) {
        await pool.query(
          "UPDATE schema_migrations SET checksum_sha256 = $2 WHERE filename = $1 AND checksum_sha256 IS NULL",
          [row.filename, currentChecksum],
        );
        continue;
      }
      if (row.checksum_sha256 !== currentChecksum) {
        throw new Error(
          `Migration checksum drift detected for ${row.filename}: applied ${row.checksum_sha256}, current ${currentChecksum}`,
        );
      }
    }

    const result: MigrationRunResult = { applied: [], skipped: [] };

    for (const filename of files) {
      const checksum = fileChecksums.get(filename);
      if (checksum === undefined) throw new Error(`Internal migration checksum missing for ${filename}`);
      if (alreadyApplied.has(filename)) {
        result.skipped.push(filename);
        continue;
      }

      const sql = await readFile(path.join(dir, filename), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename, checksum_sha256) VALUES ($1, $2)",
          [filename, checksum],
        );
        await client.query("COMMIT");
        result.applied.push(filename);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    return result;
  } finally {
    await pool.query("SELECT pg_advisory_unlock($1)", [MIGRATION_ADVISORY_LOCK_ID]);
  }
}

/** Script entry point: run migrations against the env-configured database. */
async function main(): Promise<void> {
  // No connection string → nothing to migrate. Exit cleanly with guidance
  // rather than a hard failure, so `npm run db:migrate` is safe offline.
  if (getConnectionString() === undefined) {
    console.log(
      "Skipping migrations: no Postgres connection string configured. " +
        "Set DATABASE_URL (or SUPABASE_DB_URL) to apply migrations.",
    );
    return;
  }

  const pool = getPool();
  try {
    const { applied, skipped } = await runMigrations(pool);
    if (applied.length > 0) {
      console.log(`Applied ${applied.length} migration(s): ${applied.join(", ")}`);
    } else {
      console.log("No pending migrations.");
    }
    if (skipped.length > 0) {
      console.log(`Skipped ${skipped.length} already-applied migration(s).`);
    }
  } finally {
    await closePool();
  }
}

// Only execute when invoked directly as a script, not when imported.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  });
}
