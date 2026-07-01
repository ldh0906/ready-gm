import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { InMemorySessionSummaryRepository } from "./pg-session-summary-repository.js";
import { rowToSessionSummary, sessionSummaryToRow } from "./mappers.js";
import type { SessionSummaryRecord } from "./types.js";

/**
 * Property-based test for Session_Summary persistence.
 * Feature: trpg-session-engine
 */

const summaryGen: fc.Arbitrary<SessionSummaryRecord> = fc.record({
  roomId: fc.string({ minLength: 1 }),
  closingNarration: fc.fullUnicodeString(),
  summaryText: fc.fullUnicodeString(),
  createdAt: fc.date().map((d) => d.toISOString()),
});

describe("Session_Summary persistence — property tests", () => {
  it("Property 31: Session summary persistence round-trip", async () => {
    // Feature: trpg-session-engine, Property 31: Session summary persistence round-trip
    await fc.assert(
      fc.asyncProperty(summaryGen, async (summary) => {
        // (a) Repository round-trip: the loaded summary equals what was saved.
        const repo = new InMemorySessionSummaryRepository();
        await repo.save(summary);
        const loaded = await repo.get(summary.roomId);
        expect(loaded).toStrictEqual(summary);
        // The closing narration and summary text are preserved verbatim.
        expect(loaded?.closingNarration).toBe(summary.closingNarration);
        expect(loaded?.summaryText).toBe(summary.summaryText);

        // (b) Row mapping round-trip (the actual durable encoding).
        const params = sessionSummaryToRow(summary);
        const row = {
          room_id: params[0],
          closing_narration: params[1],
          summary_text: params[2],
          created_at: params[3],
        };
        expect(rowToSessionSummary(row)).toStrictEqual(summary);
      }),
      { numRuns: 100 },
    );
  });
});
