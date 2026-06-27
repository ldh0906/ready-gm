/**
 * EventSink — the async, non-blocking, best-effort destination for QA events.
 *
 * The defining contract: {@link EventSink.emit} is **fire-and-forget**. It
 * returns `void`, never blocks the caller, and never throws — a logging
 * failure must never propagate into or stall game flow (Requirement 18.7).
 *
 * Two implementations are provided:
 *  - {@link NoopEventSink} — the default; does nothing, so the engine runs with
 *    no instrumentation configured.
 *  - {@link InMemoryEventSink} — buffers events off the hot path (via
 *    `queueMicrotask`) and supports time-ordered queries by session and round.
 *    Tests can `await flush()` (alias `drain()`) to wait for pending writes.
 *
 * Requirements: 18.1, 18.2, 18.7.
 */
import type { QaEvent } from "./events.js";

/**
 * A fire-and-forget destination for QA events. Implementations MUST NOT throw
 * from {@link emit} and MUST NOT block the caller.
 */
export interface EventSink {
  /** Record an event. Never throws; returns immediately. */
  emit(event: QaEvent): void;
}

/** Default sink that discards every event (no instrumentation configured). */
export class NoopEventSink implements EventSink {
  emit(_event: QaEvent): void {
    // Intentionally does nothing.
  }
}

/** Options for {@link InMemoryEventSink}. */
export interface InMemoryEventSinkOptions {
  /**
   * Optional best-effort consumer invoked for each event after it is buffered.
   * Exceptions thrown here are swallowed so they never reach the emitter.
   */
  onEvent?: (event: QaEvent) => void;
}

/** A buffered event tagged with its insertion order for stable tie-breaking. */
interface StoredEvent {
  event: QaEvent;
  seq: number;
}

/**
 * In-memory {@link EventSink} that buffers events asynchronously and supports
 * time-ordered queries. `emit` defers the actual write to a microtask so it is
 * non-blocking; call {@link flush} to await all pending writes.
 */
export class InMemoryEventSink implements EventSink {
  private readonly stored: StoredEvent[] = [];
  private seq = 0;
  private readonly pending = new Set<Promise<void>>();
  private readonly onEvent: ((event: QaEvent) => void) | undefined;

  constructor(options: InMemoryEventSinkOptions = {}) {
    this.onEvent = options.onEvent;
  }

  emit(event: QaEvent): void {
    try {
      const task = this.enqueue(event);
      this.pending.add(task);
      // Detach: never let a rejection surface to the caller or the runtime.
      void task.finally(() => this.pending.delete(task)).catch(() => undefined);
    } catch {
      // Best-effort: swallow anything so game flow is never affected.
    }
  }

  /** Defer buffering of one event to a microtask so `emit` stays non-blocking. */
  private enqueue(event: QaEvent): Promise<void> {
    return new Promise<void>((resolve) => {
      globalThis.queueMicrotask(() => {
        try {
          this.stored.push({ event, seq: this.seq++ });
          this.onEvent?.(event);
        } catch {
          // A throwing consumer (or buffer issue) must not break draining.
        } finally {
          resolve();
        }
      });
    });
  }

  /**
   * Resolve once all events emitted so far have been buffered. Awaiting this in
   * tests makes the otherwise-async pipeline observable. Alias: {@link drain}.
   */
  async flush(): Promise<void> {
    // New tasks can be scheduled while draining; loop until quiescent.
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  /** Alias of {@link flush}. */
  drain(): Promise<void> {
    return this.flush();
  }

  /** All buffered events for a session, ordered by timestamp then insertion. */
  queryBySession(sessionId: string): QaEvent[] {
    return this.sorted(this.stored.filter((s) => s.event.sessionId === sessionId));
  }

  /**
   * All buffered events for a session+round, ordered by timestamp then
   * insertion order.
   */
  queryByRound(sessionId: string, roundNo: number): QaEvent[] {
    return this.sorted(
      this.stored.filter((s) => s.event.sessionId === sessionId && s.event.roundNo === roundNo),
    );
  }

  /** Every buffered event, ordered by timestamp then insertion order. */
  all(): QaEvent[] {
    return this.sorted(this.stored);
  }

  /** Number of events buffered so far. */
  get size(): number {
    return this.stored.length;
  }

  /** Sort by timestamp ascending, tie-broken by insertion order (stable). */
  private sorted(items: StoredEvent[]): QaEvent[] {
    return [...items]
      .sort((a, b) => {
        const ta = Date.parse(a.event.timestamp);
        const tb = Date.parse(b.event.timestamp);
        if (ta !== tb) return ta - tb;
        return a.seq - b.seq;
      })
      .map((s) => s.event);
  }
}
