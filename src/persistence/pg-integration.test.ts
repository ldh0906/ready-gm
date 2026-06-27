/**
 * Live-database integration test.
 *
 * This suite is GATED: it only runs when a Postgres connection string is
 * configured (`DATABASE_URL` / `SUPABASE_DB_URL`). With no database configured
 * — the default for `npm test` and CI — the entire suite is skipped, so the
 * offline test run stays green. Run it against a real (throwaway) database by
 * exporting a connection string before `npm test`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getConnectionString } from "./pg-client.js";
import { createPool } from "./pg-client.js";
import { runMigrations } from "./migrate.js";
import { PgRoomRepository } from "./pg-room-repository.js";
import { PgScenarioRepository } from "./pg-scenario-repository.js";
import { PgEventSink } from "./pg-event-sink.js";
import { makeDiceRollEvent } from "../observability/events.js";
import type { Pool } from "pg";
import type { Room } from "../services/types.js";

const hasDb = getConnectionString() !== undefined;

describe.skipIf(!hasDb)("Postgres integration (live database)", () => {
  // Created in beforeAll (not at collection time) so importing this suite never
  // opens a connection or throws when no database is configured/skipped.
  let pool: Pool;

  beforeAll(() => {
    pool = createPool();
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("migrates and lists the seeded MVP scenario", async () => {
    await runMigrations(pool);
    const scenarios = await new PgScenarioRepository(pool).listScenarios();
    expect(scenarios.some((s) => s.id === "the-sunless-crypt")).toBe(true);
  });

  it("round-trips a room", async () => {
    const repo = new PgRoomRepository(pool);
    const room: Room = {
      id: `it-room-${Date.now()}`,
      inviteToken: `it-tok-${Date.now()}`,
      hostPlayerId: "it-host",
      scenarioId: null,
      state: "lobby",
      maxPlayers: 6,
      createdAt: new Date().toISOString(),
    };
    await repo.saveRoom(room);
    expect(await repo.getRoom(room.id)).toEqual(room);
  });

  it("stores and retrieves QA events in chronological order per round", async () => {
    const sink = new PgEventSink(pool);
    const sessionId = `it-sess-${Date.now()}`;
    const earlier = makeDiceRollEvent(
      { sessionId, roundNo: 1 },
      { roller: "dice", expression: "u", range: { min: -4, max: 4 }, rawValues: [1], result: 1, seed: 1 },
      { generateId: () => `${sessionId}-a`, now: () => new Date("2024-01-01T00:00:00.000Z") },
    );
    const later = makeDiceRollEvent(
      { sessionId, roundNo: 1 },
      { roller: "dice", expression: "u", range: { min: -4, max: 4 }, rawValues: [2], result: 2, seed: 2 },
      { generateId: () => `${sessionId}-b`, now: () => new Date("2024-01-01T00:00:01.000Z") },
    );
    sink.emit(later);
    sink.emit(earlier);
    await sink.flush();

    const events = await sink.queryByRound(sessionId, 1);
    expect(events.map((e) => e.eventId)).toEqual([`${sessionId}-a`, `${sessionId}-b`]);
  });
});
