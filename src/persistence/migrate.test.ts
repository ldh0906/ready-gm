import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { QueryResultLike, QueryResultRow } from "./pg-client.js";
import { defaultMigrationsDir, listMigrationFiles, runMigrations } from "./migrate.js";

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
  readonly clientQueries: string[] = [];

  constructor(private readonly appliedFilenames: string[] = []) {}

  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
  ): Promise<QueryResultLike<R>> {
    this.poolQueries.push(text);
    if (text.includes("SELECT filename FROM schema_migrations")) {
      const rows = this.appliedFilenames.map((filename) => ({ filename })) as unknown as R[];
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 0 };
  }

  async connect(): Promise<{
    query: (text: string) => Promise<QueryResultLike>;
    release: () => void;
  }> {
    return {
      query: async (text: string): Promise<QueryResultLike> => {
        this.clientQueries.push(text);
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    };
  }
}

describe("runMigrations", () => {
  it("applies pending migrations inside a transaction and records them", async () => {
    const pool = new FakeMigrationPool();
    const result = await runMigrations(pool as unknown as Pool);

    expect(result.applied).toContain("0001_init.sql");
    expect(result.skipped).toEqual([]);
    // Ensures the schema_migrations table is created first.
    expect(pool.poolQueries[0]).toContain("CREATE TABLE IF NOT EXISTS schema_migrations");
    // Each migration is wrapped in BEGIN/COMMIT.
    expect(pool.clientQueries).toContain("BEGIN");
    expect(pool.clientQueries).toContain("COMMIT");
  });

  it("skips migrations already recorded as applied", async () => {
    const pool = new FakeMigrationPool(["0001_init.sql"]);
    const result = await runMigrations(pool as unknown as Pool);

    expect(result.applied).toEqual([]);
    expect(result.skipped).toContain("0001_init.sql");
    // No transaction was opened because nothing needed applying.
    expect(pool.clientQueries).toEqual([]);
  });
});
