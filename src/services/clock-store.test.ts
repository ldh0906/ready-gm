import { describe, it, expect } from "vitest";
import { InMemoryClockStore } from "./clock-store.js";
import { makeClock } from "../core/progress-clock.js";

describe("InMemoryClockStore", () => {
  const clock = () =>
    makeClock({ id: "crypt_alert", name: "묘지 경계도", scope: "scene", max: 6, value: 2, onComplete: "patrol" });

  it("returns an empty array for an unknown room", () => {
    expect(new InMemoryClockStore().get("nope")).toEqual([]);
  });

  it("round-trips saved clocks", () => {
    const store = new InMemoryClockStore();
    store.save("room-1", [clock()]);
    expect(store.get("room-1")).toEqual([clock()]);
  });

  it("returns independent copies (external mutation cannot corrupt stored state)", () => {
    const store = new InMemoryClockStore();
    store.save("room-1", [clock()]);

    const first = store.get("room-1");
    first[0]!.value = 99;

    expect(store.get("room-1")[0]?.value).toBe(2);
  });

  it("stores a copy of the input array (later input mutation is not reflected)", () => {
    const store = new InMemoryClockStore();
    const input = [clock()];
    store.save("room-1", input);
    input[0]!.value = 99;

    expect(store.get("room-1")[0]?.value).toBe(2);
  });

  it("replaces the room's clocks on save", () => {
    const store = new InMemoryClockStore();
    store.save("room-1", [clock()]);
    store.save("room-1", []);
    expect(store.get("room-1")).toEqual([]);
  });
});
