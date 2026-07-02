/**
 * Test double for the {@link Queryable} Postgres surface.
 *
 * `FakePgClient` records every `query()` call and returns canned rows from a
 * FIFO queue (falling back to an empty result), so the repositories and the
 * event sink can be unit-tested without a live database. Errors can be queued
 * to exercise best-effort/failure paths.
 *
 * This is test-support code with no production dependencies.
 */
import type { QueryResultLike, QueryResultRow, Queryable } from "./pg-client.js";

/** A single recorded `query()` invocation. */
export interface RecordedCall {
  text: string;
  values: readonly unknown[] | undefined;
}

type QueuedResponse = QueryResultRow[] | Error;

/** Records queries and replays canned responses; implements {@link Queryable}. */
export class FakePgClient implements Queryable {
  readonly calls: RecordedCall[] = [];
  private readonly queue: QueuedResponse[] = [];

  /** Queue the rows to return from the next `query()` call. */
  enqueueRows(rows: QueryResultRow[]): this {
    this.queue.push(rows);
    return this;
  }

  /** Queue an error to reject the next `query()` call with. */
  enqueueError(error: Error): this {
    this.queue.push(error);
    return this;
  }

  /** The most recent recorded call, or `undefined` when none has happened. */
  get lastCall(): RecordedCall | undefined {
    return this.calls[this.calls.length - 1];
  }

  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResultLike<R>> {
    this.calls.push({ text, values });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text.trim().toUpperCase())) {
      return { rows: [], rowCount: null };
    }
    const next = this.queue.shift();
    if (next instanceof Error) {
      throw next;
    }
    const rows = (next ?? []) as R[];
    return { rows, rowCount: rows.length };
  }
}
