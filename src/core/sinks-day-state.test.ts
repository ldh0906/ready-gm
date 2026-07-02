import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  advanceSinksDay,
  applySinksResolutions,
  assignSinksTarget,
  canEndSinksSession,
  cloneSinksDayState,
  createSinksDayState,
  unresolvedRequiredCardIds,
  type SinksDayState,
} from "./sinks-day-state.js";
import { buildSinksEventSchedule, type SinksEventSchedule } from "../services/sinks-event-deck.js";

function advanceToFinal(state: SinksDayState, schedule: SinksEventSchedule): SinksDayState {
  let current = state;
  while (!current.finalDayReached) {
    const result = advanceSinksDay(current, schedule);
    if (!result.ok) throw new Error(`unexpected advance failure: ${result.reason}`);
    current = result.state;
  }
  return current;
}

describe("sinks day state", () => {
  it("creates day 1 with fisherman_found revealed and no mutable facts", () => {
    const schedule = buildSinksEventSchedule("room-sinks-alpha");

    const state = createSinksDayState("room-sinks-alpha", schedule);

    expect(state).toEqual({
      roomId: "room-sinks-alpha",
      day: 1,
      revealedCardIds: ["fisherman_found"],
      resolutions: [],
      targetByCardId: {},
      finalDayReached: false,
    });
  });

  it("advances days and reveals cards in schedule order", () => {
    const schedule = buildSinksEventSchedule("room-sinks-alpha");
    let state = createSinksDayState("room-sinks-alpha", schedule);

    for (const event of schedule.days) {
      const result = advanceSinksDay(state, schedule);
      expect(result).toMatchObject({ ok: true, revealedCard: event.card, revealedEvent: event });
      if (!result.ok) throw new Error(result.reason);
      state = result.state;
      expect(state.day).toBe(event.day);
      expect(state.revealedCardIds).toEqual([
        "fisherman_found",
        ...schedule.days.filter((scheduled) => scheduled.day <= event.day).map((scheduled) => scheduled.card.id),
      ]);
      expect(state.finalDayReached).toBe(event.card.id === "island_sinks");
    }
  });

  it("rejects advancing after the final day", () => {
    const schedule = buildSinksEventSchedule("room-sinks-alpha");
    const state = advanceToFinal(createSinksDayState("room-sinks-alpha", schedule), schedule);

    expect(advanceSinksDay(state, schedule)).toEqual({
      ok: false,
      reason: "FINAL_DAY_REACHED",
      message: "Cannot advance after island_sinks has been revealed.",
    });
  });

  it("rejects advancing when the schedule has no next day", () => {
    const schedule = buildSinksEventSchedule("room-sinks-alpha");
    const state = { ...createSinksDayState("room-sinks-alpha", schedule), day: 99 };

    expect(advanceSinksDay(state, schedule)).toMatchObject({ ok: false, reason: "NO_SCHEDULED_CARD" });
  });

  it("records a lowest_roll target only for a revealed lowest_roll card", () => {
    const schedule = buildSinksEventSchedule("room-sinks-alpha");
    const lowestRollEvent = schedule.days.find((event) => event.card.resolution === "lowest_roll");
    if (lowestRollEvent === undefined) throw new Error("fixture room should reveal a lowest_roll card");
    let state = createSinksDayState("room-sinks-alpha", schedule);
    while (!state.revealedCardIds.includes(lowestRollEvent.card.id)) {
      const result = advanceSinksDay(state, schedule);
      if (!result.ok) throw new Error(result.reason);
      state = result.state;
    }

    const assigned = assignSinksTarget(state, lowestRollEvent.card.id, "char-a");
    expect(assigned).toMatchObject({ ok: true });
    if (!assigned.ok) throw new Error(assigned.reason);
    expect(assigned.state.targetByCardId).toEqual({ [lowestRollEvent.card.id]: "char-a" });
    expect(state.targetByCardId).toEqual({});
  });

  it("rejects invalid lowest_roll target assignments", () => {
    const schedule = buildSinksEventSchedule("room-sinks-alpha");
    const lowestRollEvent = schedule.days.find((event) => event.card.resolution === "lowest_roll");
    if (lowestRollEvent === undefined) throw new Error("fixture room should reveal a lowest_roll card");
    let state = createSinksDayState("room-sinks-alpha", schedule);
    while (!state.revealedCardIds.includes(lowestRollEvent.card.id)) {
      const result = advanceSinksDay(state, schedule);
      if (!result.ok) throw new Error(result.reason);
      state = result.state;
    }
    const assigned = assignSinksTarget(state, lowestRollEvent.card.id, "char-a");
    if (!assigned.ok) throw new Error(assigned.reason);

    expect(assignSinksTarget(createSinksDayState("room-sinks-alpha", schedule), "poison", "char-a")).toMatchObject({
      ok: false,
      reason: "CARD_NOT_REVEALED",
    });
    expect(assignSinksTarget(state, "fisherman_found", "char-a")).toMatchObject({
      ok: false,
      reason: "CARD_NOT_LOWEST_ROLL",
    });
    expect(assignSinksTarget(assigned.state, lowestRollEvent.card.id, "char-b")).toMatchObject({
      ok: false,
      reason: "TARGET_ALREADY_ASSIGNED",
    });
  });

  it("applies only valid resolution proposals and reports each rejection reason", () => {
    const schedule = buildSinksEventSchedule("room-sinks-alpha");
    const state = advanceToFinal(createSinksDayState("room-sinks-alpha", schedule), schedule);
    const firstGeneralId = state.revealedCardIds.find((id) => id !== "fisherman_found" && id !== "island_sinks")!;
    const withExisting = applySinksResolutions(state, [
      { cardId: firstGeneralId, explanation: "The group agrees on the cause." },
    ]).state;

    const result = applySinksResolutions(withExisting, [
      { cardId: "not_revealed", explanation: "No one saw this." },
      { cardId: firstGeneralId, explanation: "Contradicting the permanent truth." },
      { cardId: "island_sinks", explanation: "The island explains itself." },
      { cardId: "fisherman_found", explanation: "   " },
      { cardId: "fisherman_found", explanation: "He was killed before the first dinner." },
    ]);

    expect(result.applied).toEqual([
      { cardId: "fisherman_found", explanation: "He was killed before the first dinner.", day: state.day },
    ]);
    expect(result.rejected.map((entry) => entry.reason)).toEqual([
      "CARD_NOT_REVEALED",
      "ALREADY_RESOLVED",
      "CARD_DOES_NOT_REQUIRE_RESOLUTION",
      "EMPTY_EXPLANATION",
    ]);
  });

  it("rejects fisherman_found before final day and allows it on the final day", () => {
    const schedule = buildSinksEventSchedule("room-sinks-alpha");
    const beforeFinal = createSinksDayState("room-sinks-alpha", schedule);
    const early = applySinksResolutions(beforeFinal, [
      { cardId: "fisherman_found", explanation: "A premature theory." },
    ]);
    expect(early).toMatchObject({
      state: beforeFinal,
      applied: [],
      rejected: [{ reason: "FISHERMAN_FOUND_LOCKED" }],
    });

    const final = advanceToFinal(beforeFinal, schedule);
    const late = applySinksResolutions(final, [
      { cardId: "fisherman_found", explanation: "The last-day explanation." },
    ]);
    expect(late.applied).toEqual([
      { cardId: "fisherman_found", explanation: "The last-day explanation.", day: final.day },
    ]);
  });

  it("can end only on the final day after every required revealed card is resolved", () => {
    const schedule = buildSinksEventSchedule("room-sinks-alpha");
    const initial = createSinksDayState("room-sinks-alpha", schedule);
    expect(canEndSinksSession(initial)).toBe(false);

    const final = advanceToFinal(initial, schedule);
    expect(canEndSinksSession(final)).toBe(false);
    expect(unresolvedRequiredCardIds(final)).toEqual(
      final.revealedCardIds.filter((id) => id !== "island_sinks"),
    );

    const resolved = applySinksResolutions(
      final,
      unresolvedRequiredCardIds(final).map((cardId) => ({ cardId, explanation: `Resolved ${cardId}` })),
    ).state;
    expect(unresolvedRequiredCardIds(resolved)).toEqual([]);
    expect(canEndSinksSession(resolved)).toBe(true);
  });

  it("does not mutate input state while advancing or applying resolutions", () => {
    const schedule = buildSinksEventSchedule("room-sinks-alpha");
    const state = createSinksDayState("room-sinks-alpha", schedule);
    const snapshot = cloneSinksDayState(state);

    advanceSinksDay(state, schedule);
    applySinksResolutions(state, [{ cardId: "fisherman_found", explanation: "Too soon." }]);

    expect(state).toEqual(snapshot);
  });

  it("reveals exactly the schedule when advanced to completion for arbitrary room ids", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (roomId) => {
        const schedule = buildSinksEventSchedule(roomId);
        let state = createSinksDayState(roomId, schedule);

        for (const event of schedule.days) {
          const result = advanceSinksDay(state, schedule);
          expect(result).toMatchObject({ ok: true });
          if (!result.ok) return false;
          expect(result.revealedCard).toEqual(event.card);
          expect(result.revealedEvent).toEqual(event);
          state = result.state;
        }

        expect(state.revealedCardIds).toEqual([
          schedule.opening.id,
          ...schedule.days.map((event) => event.card.id),
        ]);
        expect(state.day).toBe(schedule.endsOnDay);
        expect(state.finalDayReached).toBe(true);
      }),
    );
  });
});
