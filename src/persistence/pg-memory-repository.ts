import type { MemoryRecord } from "../core/memory-record.js";
import { parseJsonColumn, toJsonParam } from "./mappers.js";
import type { MemoryRecordsRecord, MemoryRepository } from "./types.js";
import type { Queryable } from "./pg-client.js";

export class PgMemoryRepository implements MemoryRepository {
  constructor(private readonly db: Queryable) {}

  async list(roomId: string): Promise<MemoryRecord[]> {
    const { rows } = await this.db.query(`SELECT records FROM room_memories WHERE room_id = $1`, [
      roomId,
    ]);
    return rows[0] ? parseJsonColumn<MemoryRecord[]>(rows[0].records) : [];
  }

  async save(roomId: string, records: readonly MemoryRecord[]): Promise<void> {
    await this.db.query(
      `INSERT INTO room_memories (room_id, records, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (room_id) DO UPDATE SET
         records = EXCLUDED.records,
         updated_at = now()`,
      [roomId, toJsonParam(records)],
    );
  }

  async listAll(): Promise<MemoryRecordsRecord[]> {
    const { rows } = await this.db.query(`SELECT room_id, records FROM room_memories`);
    return rows.map((row) => ({
      roomId: row.room_id as string,
      records: parseJsonColumn<MemoryRecord[]>(row.records),
    }));
  }
}
