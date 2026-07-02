import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { QueryResultLike, QueryResultRow } from "./pg-client.js";
import {
  checksumSql,
  defaultMigrationsDir,
  listMigrationFiles,
  runMigrations,
} from "./migrate.js";

describe("listMigrationFiles", () => {
  it("returns the .sql files in the repo migrations dir, sorted", async () => {
    const files = await listMigrationFiles(defaultMigrationsDir());
    expect(files).toContain("0001_init.sql");
    const sorted = [...files].sort((a, b) => a.localeCompare(b));
    expect(files).toEqual(sorted);
    expect(files.every((f) => f.endsWith(".sql"))).toBe(true);
  });
});

/** Records SQL statements run via the pool and via per-migration clients. */
class FakeMigrationPool {
  readonly poolQueries: string[] = [];
  readonly poolValues: Array<readonly unknown[] | undefined> = [];
  readonly clientQueries: string[] = [];
  readonly clientValues: Array<readonly unknown[] | undefined> = [];

  constructor(
    private readonly applied: Array<{ filename: string; checksumSha256?: string | null }> = [],
  ) {}

  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResultLike<R>> {
    this.poolQueries.push(text);
    this.poolValues.push(values);
    if (text.includes("SELECT filename, checksum_sha256 FROM schema_migrations")) {
      const rows = this.applied.map((migration) => ({
        filename: migration.filename,
        checksum_sha256: migration.checksumSha256 ?? null,
      })) as unknown as R[];
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 0 };
  }

  async connect(): Promise<{
    query: (text: string, values?: readonly unknown[]) => Promise<QueryResultLike>;
    release: () => void;
  }> {
    return {
      query: async (text: string, values?: readonly unknown[]): Promise<QueryResultLike> => {
        this.clientQueries.push(text);
        this.clientValues.push(values);
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    };
  }
}

describe("runMigrations", () => {
  it("computes stable sha256 checksums for migration SQL", () => {
    expect(checksumSql("SELECT 1;\n")).toMatch(/^[a-f0-9]{64}$/);
    expect(checksumSql("SELECT 1;\n")).toBe(checksumSql("SELECT 1;\n"));
    expect(checksumSql("SELECT 2;\n")).not.toBe(checksumSql("SELECT 1;\n"));
  });

  it("applies pending migrations inside a transaction and records them", async () => {
    const pool = new FakeMigrationPool();
    const result = await runMigrations(pool as unknown as Pool);

    expect(result.applied).toContain("0001_init.sql");
    expect(result.skipped).toEqual([]);
    // Ensures the schema_migrations table is created first.
    expect(pool.poolQueries[0]).toContain("CREATE TABLE IF NOT EXISTS schema_migrations");
    expect(pool.poolQueries.some((sql) => sql.includes("pg_advisory_lock"))).toBe(true);
    expect(pool.poolQueries.some((sql) => sql.includes("pg_advisory_unlock"))).toBe(true);
    // Each migration is wrapped in BEGIN/COMMIT.
    expect(pool.clientQueries).toContain("BEGIN");
    expect(pool.clientQueries).toContain("COMMIT");
    expect(pool.clientQueries.some((sql) => sql.includes("checksum_sha256"))).toBe(true);
  });

  it("skips migrations already recorded as applied", async () => {
    // Mark ALL current migration files as already applied so nothing is pending,
    // keeping this test robust as new migrations are added.
    const allFiles = await listMigrationFiles(defaultMigrationsDir());
    const applied = await Promise.all(
      allFiles.map(async (filename) => ({
        filename,
        checksumSha256: checksumSql(
          await (await import("node:fs/promises")).readFile(join(defaultMigrationsDir(), filename), "utf8"),
        ),
      })),
    );
    const pool = new FakeMigrationPool(applied);
    const result = await runMigrations(pool as unknown as Pool);

    expect(result.applied).toEqual([]);
    expect(result.skipped).toContain("0001_init.sql");
    // No transaction was opened because nothing needed applying.
    expect(pool.clientQueries).toEqual([]);
  });

  it("fails fast when an applied migration file checksum changed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ready-gm-migrations-"));
    await writeFile(join(dir, "0001_test.sql"), "SELECT 1;\n", "utf8");
    const pool = new FakeMigrationPool([
      { filename: "0001_test.sql", checksumSha256: checksumSql("SELECT 2;\n") },
    ]);

    await expect(runMigrations(pool as unknown as Pool, dir)).rejects.toThrow(
      /checksum drift/i,
    );
  });
});
