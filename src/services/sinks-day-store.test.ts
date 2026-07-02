import { describe, expect, it } from "vitest";
import { createSinksDayState } from "../core/sinks-day-state.js";
import { buildSinksEventSchedule } from "./sinks-event-deck.js";
import { InMemorySinksDayStore } from "./sinks-day-store.js";

describe("InMemorySinksDayStore", () => {
  const state = () => createSinksDayState("room-sinks-alpha", buildSinksEventSchedule("room-sinks-alpha"));

  it("returns undefined for an unknown room", () => {
    expect(new InMemorySinksDayStore().get("nope")).toBeUndefined();
  });

  it("round-trips a saved sinks day state", () => {
    const store = new InMemorySinksDayStore();
    store.save("room-sinks-alpha", state());
    expect(store.get("room-sinks-alpha")).toEqual(state());
  });

  it("returns an independent copy", () => {
    const store = new InMemorySinksDayStore();
    store.save("room-sinks-alpha", state());

    const got = store.get("room-sinks-alpha")!;
    got.revealedCardIds.push("poison");
    got.resolutions.push({ cardId: "fisherman_found", explanation: "mutated", day: 1 });
    got.targetByCardId.poison = "char-a";

    expect(store.get("room-sinks-alpha")).toEqual(state());
  });

  it("stores a copy of the input", () => {
    const store = new InMemorySinksDayStore();
    const input = state();
    store.save("room-sinks-alpha", input);
    input.revealedCardIds.push("poison");
    input.targetByCardId.poison = "char-a";

    expect(store.get("room-sinks-alpha")).toEqual(state());
  });

  it("deletes a room state", () => {
    const store = new InMemorySinksDayStore();
    store.save("room-sinks-alpha", state());
    store.delete("room-sinks-alpha");
    expect(store.get("room-sinks-alpha")).toBeUndefined();
  });
});
