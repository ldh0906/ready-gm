import { describe, expect, it } from "vitest";
import { makeCharacterState } from "../core/character-state.js";
import type { Character } from "./types.js";
import { InMemoryCharacterStateStore, seedCharacterStatesForCharacters } from "./character-state-store.js";

describe("InMemoryCharacterStateStore", () => {
  const state = () =>
    makeCharacterState({
      characterId: "c1",
      conditions: [{ name: "wounded", severity: 1, reason: "trap" }],
      resources: { focus: 2 },
      inventory: [{ name: "silver key", tags: ["key"], reason: "found" }],
    });

  it("returns an empty array for an unknown room", () => {
    expect(new InMemoryCharacterStateStore().get("nope")).toEqual([]);
  });

  it("round-trips saved character states", () => {
    const store = new InMemoryCharacterStateStore();
    store.save("room-1", [state()]);
    expect(store.get("room-1")).toEqual([state()]);
  });

  it("returns independent copies so external mutation cannot corrupt stored state", () => {
    const store = new InMemoryCharacterStateStore();
    store.save("room-1", [state()]);

    const got = store.get("room-1");
    got[0]!.conditions.push({ name: "poisoned" });
    got[0]!.resources.focus = 99;

    const again = store.get("room-1");
    expect(again[0]?.conditions).toEqual([{ name: "wounded", severity: 1, reason: "trap" }]);
    expect(again[0]?.resources.focus).toBe(2);
  });

  it("stores a copy of the input array", () => {
    const store = new InMemoryCharacterStateStore();
    const input = [state()];
    store.save("room-1", input);
    input[0]!.conditions.push({ name: "poisoned" });

    expect(store.get("room-1")[0]?.conditions).toEqual([{ name: "wounded", severity: 1, reason: "trap" }]);
  });

  it("replaces the room's states on save", () => {
    const store = new InMemoryCharacterStateStore();
    store.save("room-1", [state()]);
    store.save("room-1", []);
    expect(store.get("room-1")).toEqual([]);
  });
});

describe("seedCharacterStatesForCharacters", () => {
  const character = (id: string, confirmed: boolean): Character => ({
    id,
    playerId: `p-${id}`,
    roomId: "room-1",
    name: id,
    concept: "adventurer",
    attributes: { Might: 0, Agility: 0, Wits: 0, Spirit: 0 },
    confirmed,
  });

  it("creates one empty mutable state per confirmed character", () => {
    expect(seedCharacterStatesForCharacters([character("c1", true), character("c2", false)])).toEqual([
      makeCharacterState({ characterId: "c1" }),
    ]);
  });
});
