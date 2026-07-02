/**
 * Postgres-backed {@link SessionSummaryRepository} plus an in-memory fallback.
 *
 * Persists the end-of-session {@link SessionSummaryRecord} associated with a
 * Room so it can be loaded after the session ends (Requirement 15.3). One
 * summary per room; saves upsert on `room_id`.
 */
import type { Queryable } from "./pg-client.js";
import { rowToSessionSummary, sessionSummaryToRow } from "./mappers.js";
import type { SessionSummaryRecord, SessionSummaryRepository } from "./types.js";

export class PgSessionSummaryRepository implements SessionSummaryRepository {
  constructor(private readonly db: Queryable) {}

  async save(summary: SessionSummaryRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO session_summaries (room_id, closing_narration, summary_text, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (room_id) DO UPDATE SET
         closing_narration = EXCLUDED.closing_narration,
         summary_text = EXCLUDED.summary_text,
         updated_at = now()`,
      sessionSummaryToRow(summary),
    );
  }

  async get(roomId: string): Promise<SessionSummaryRecord | undefined> {
    const { rows } = await this.db.query(`SELECT * FROM session_summaries WHERE room_id = $1`, [
      roomId,
    ]);
    return rows[0] ? rowToSessionSummary(rows[0]) : undefined;
  }
}

/**
 * In-memory {@link SessionSummaryRepository} used when no database is
 * configured. Stores a single summary per room.
 */
export class InMemorySessionSummaryRepository implements SessionSummaryRepository {
  private readonly summaries = new Map<string, SessionSummaryRecord>();

  async save(summary: SessionSummaryRecord): Promise<void> {
    this.summaries.set(summary.roomId, { ...summary });
  }

  async get(roomId: string): Promise<SessionSummaryRecord | undefined> {
    const found = this.summaries.get(roomId);
    return found ? { ...found } : undefined;
  }
}
