import { describe, expect, it } from "vitest";
import {
  SINKS_GENERAL_EVENT_CARDS,
  SINKS_SPECIAL_EVENT_CARDS,
  buildSinksEventSchedule,
} from "./sinks-event-deck.js";

describe("buildSinksEventSchedule", () => {
  it("builds the same event schedule for the same room id", () => {
    const a = buildSinksEventSchedule("room-sinks-alpha");
    const b = buildSinksEventSchedule("room-sinks-alpha");

    expect(a).toEqual(b);
  });

  it("builds a different accepted event order for known different room ids", () => {
    const a = buildSinksEventSchedule("room-sinks-alpha");
    const b = buildSinksEventSchedule("room-sinks-bravo");

    expect(a.days.map((event) => event.card.id)).not.toEqual(b.days.map((event) => event.card.id));
  });

  it("follows the original schedule structure", () => {
    const schedule = buildSinksEventSchedule("room-sinks-alpha");
    const generalIds = new Set(SINKS_GENERAL_EVENT_CARDS.map((card) => card.id));
    const removedIds = new Set(schedule.removedCardIds);
    const dayTwoToFourIds = schedule.days.slice(0, 3).map((event) => event.card.id);
    const acceptedRegularIds = SINKS_GENERAL_EVENT_CARDS.map((card) => card.id).filter(
      (id) => !removedIds.has(id),
    );
    const revealedRegularIds = schedule.days
      .map((event) => event.card.id)
      .filter((id) => id !== "island_sinks");

    expect(schedule.opening.id).toBe("fisherman_found");
    expect(schedule.days.slice(0, 3).map((event) => event.day)).toEqual([2, 3, 4]);
    expect(schedule.days.slice(0, 3).every((event) => generalIds.has(event.card.id))).toBe(true);
    expect(schedule.removedCardIds).toHaveLength(8);
    expect(removedIds.size).toBe(8);
    expect(schedule.removedCardIds.every((id) => generalIds.has(id))).toBe(true);
    expect(acceptedRegularIds).toHaveLength(5);
    expect(acceptedRegularIds.every((id) => generalIds.has(id))).toBe(true);
    expect(new Set([...acceptedRegularIds, ...schedule.removedCardIds]).size).toBe(13);
    expect(revealedRegularIds.every((id) => acceptedRegularIds.includes(id))).toBe(true);
    expect(dayTwoToFourIds).toHaveLength(3);
    expect(schedule.endsOnDay).toBeGreaterThanOrEqual(5);
    expect(schedule.endsOnDay).toBeLessThanOrEqual(7);
    expect(schedule.days.at(-1)).toMatchObject({
      day: schedule.endsOnDay,
      isFinalDay: true,
      card: { id: "island_sinks" },
    });
    expect(schedule.days.slice(0, -1).every((event) => event.card.id !== "island_sinks")).toBe(true);
    expect(schedule.days.map((event) => event.day)).toEqual(
      Array.from({ length: schedule.endsOnDay - 1 }, (_, index) => index + 2),
    );
  });

  it("defines unique card ids across all event cards", () => {
    const ids = [
      ...SINKS_SPECIAL_EVENT_CARDS.map((card) => card.id),
      ...SINKS_GENERAL_EVENT_CARDS.map((card) => card.id),
    ];

    expect(ids).toHaveLength(15);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
