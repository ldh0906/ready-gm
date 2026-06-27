/**
 * Postgres-backed {@link QueryableEventSink}: a durable, queryable destination
 * for the five QA event types (Requirements 18.1, 18.2).
 *
 * Like the in-memory sink, {@link emit} is fire-and-forget — it returns `void`,
 * never blocks the caller, and never throws (Requirement 18.7). The actual
 * INSERT runs in the background; tests can `await flush()` to wait for pending
 * writes.
 *
 * Events are stored with their correlation envelope split into columns
 * (`event_id`, `session_id`, `round_no`, `event_type`, `ts`) plus the entire
 * event preserved verbatim in the `payload` jsonb column. Queries return events
 * ordered by `ts` ascending with a monotonic `seq` as a stable tie-break, so
 * events sharing a timestamp keep insertion order — giving the "five event
 * types per round in chronological order" guarantee.
 */
import type { QaEvent } from "../observability/events.js";
import type { Queryable } from "./pg-client.js";
import { qaEventToRow, rowToQaEvent } from "./mappers.js";
import type { QueryableEventSink } from "./types.js";

const ORDER_BY = `ORDER BY ts ASC, seq ASC`;

export class PgEventSink implements QueryableEventSink {
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly db: Queryable) {}

  emit(event: QaEvent): void {
    try {
      const task = this.persist(event);
      this.pending.add(task);
      // Detach so neither a rejection nor a slow write ever reaches the caller.
      void task.finally(() => this.pending.delete(task)).catch(() => undefined);
    } catch {
      // Best-effort: swallow everything so game flow is never affected.
    }
  }

  /** Run a single parameterized INSERT, swallowing any error (best-effort). */
  private async persist(event: QaEvent): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO qa_events (event_id, session_id, round_no, event_type, ts, payload)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (event_id) DO NOTHING`,
        qaEventToRow(event),
      );
    } catch {
      // A logging failure must never propagate into game flow (Requirement 18.7).
    }
  }

  /** Resolve once all events emitted so far have been written (or failed). */
  async flush(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  /** Alias of {@link flush}. */
  drain(): Promise<void> {
    return this.flush();
  }

  async queryBySession(sessionId: string): Promise<QaEvent[]> {
    const { rows } = await this.db.query(
      `SELECT payload FROM qa_events WHERE session_id = $1 ${ORDER_BY}`,
      [sessionId],
    );
    return rows.map(rowToQaEvent);
  }

  async queryByRound(sessionId: string, roundNo: number): Promise<QaEvent[]> {
    const { rows } = await this.db.query(
      `SELECT payload FROM qa_events WHERE session_id = $1 AND round_no = $2 ${ORDER_BY}`,
      [sessionId, roundNo],
    );
    return rows.map(rowToQaEvent);
  }
}
