/**
 * Postgres-backed {@link ClockRepository}: durable storage for the per-room
 * active Progress Clocks.
 *
 * The whole clock array is stored as one `jsonb` document per room (upsert by
 * `room_id`), mirroring the Turn_State table. Progress Clocks are plain JSON
 * data so they round-trip without a special serializer.
 */
import type { ProgressClock } from "../core/progress-clock.js";
import { parseJsonColumn, toJsonParam } from "./mappers.js";
import type { Queryable } from "./pg-client.js";
import type { ClockRecord, ClockRepository } from "./types.js";

export class PgClockRepository implements ClockRepository {
  constructor(private readonly db: Queryable) {}

  async get(roomId: string): Promise<ProgressClock[]> {
    const { rows } = await this.db.query(`SELECT clocks FROM room_clocks WHERE room_id = $1`, [
      roomId,
    ]);
    return rows[0] ? parseJsonColumn<ProgressClock[]>(rows[0].clocks) : [];
  }

  async save(roomId: string, clocks: readonly ProgressClock[]): Promise<void> {
    await this.db.query(
      `INSERT INTO room_clocks (room_id, clocks, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (room_id) DO UPDATE SET
         clocks = EXCLUDED.clocks,
         updated_at = now()`,
      [roomId, toJsonParam(clocks)],
    );
  }

  async listAll(): Promise<ClockRecord[]> {
    const { rows } = await this.db.query(`SELECT room_id, clocks FROM room_clocks`);
    return rows.map((row) => ({
      roomId: row.room_id as string,
      clocks: parseJsonColumn<ProgressClock[]>(row.clocks),
    }));
  }
}
