/**
 * Session summary read interface for the REST surface.
 *
 * The durable persistence layer (src/persistence/, built concurrently) owns the
 * authoritative end-of-session recap. To stay decoupled from that work, the HTTP
 * layer depends only on this narrow read-only port: given a room id, return its
 * {@link SessionSummaryView} or `undefined` when none has been persisted yet
 * (Requirement 15.3). A persistence-backed adapter can implement this interface
 * later without any change to the route handlers.
 *
 * Sources: design.md "HTTP/REST Surface" (`GET /rooms/:id/summary`), Screen 7 —
 * Ending & Session Summary.
 * Requirements: 15.3
 */

/**
 * The end-of-session recap surfaced over REST after a one-shot concludes
 * (Requirement 15.3). Shape mirrors the persistence layer's summary record so a
 * durable reader can be substituted without reshaping responses. Named with a
 * `View` suffix as it is the REST response shape, distinct from the AI GM's
 * internal {@link import("../ai/index.js").SessionSummary}.
 */
export interface SessionSummaryView {
  /** The Room this summary belongs to (1:1 with the ended Room). */
  roomId: string;
  /** The AI GM's Korean closing narration (Requirement 15.1). */
  closingNarration: string;
  /** The AI GM's recap of the session's key events (Requirement 15.2). */
  summaryText: string;
  /** ISO timestamp of when the summary was persisted (Requirement 15.3). */
  createdAt: string;
}

/**
 * Read-only port the REST surface uses to fetch a room's persisted summary.
 * Returns `undefined` when the room has no summary yet (e.g. still in session).
 */
export interface SummaryReader {
  getSummary(roomId: string): SessionSummaryView | undefined;
}

/**
 * Default in-memory {@link SummaryReader}. Holds summaries in a Map keyed by
 * room id; `set` upserts so a later write wins. Suitable as the standalone
 * default until the durable reader is wired in.
 */
export class InMemorySummaryReader implements SummaryReader {
  private readonly summaries = new Map<string, SessionSummaryView>();

  constructor(initial: readonly SessionSummaryView[] = []) {
    for (const summary of initial) {
      this.summaries.set(summary.roomId, { ...summary });
    }
  }

  getSummary(roomId: string): SessionSummaryView | undefined {
    const found = this.summaries.get(roomId);
    return found ? { ...found } : undefined;
  }

  /** Record (or replace) the summary for a room. */
  set(summary: SessionSummaryView): void {
    this.summaries.set(summary.roomId, { ...summary });
  }
}
