import { describe, it, expect } from "vitest";
import { InMemorySceneStore } from "./scene-store.js";
import { makeSceneState } from "../core/scene-state.js";

describe("InMemorySceneStore", () => {
  const scene = () =>
    makeSceneState({
      sceneId: "s1",
      location: "복도",
      sceneGoal: "단서를 찾는다",
      presentNpcs: [{ id: "n1", name: "시종", disposition: "wary", visibleIntent: "지연" }],
      availableClues: ["a", "b"],
      exits: ["north"],
    });

  it("returns undefined for an unknown room", () => {
    expect(new InMemorySceneStore().get("nope")).toBeUndefined();
  });

  it("round-trips a saved scene", () => {
    const store = new InMemorySceneStore();
    store.save("room-1", scene());
    expect(store.get("room-1")).toEqual(scene());
  });

  it("returns an independent copy (mutation cannot corrupt stored state)", () => {
    const store = new InMemorySceneStore();
    store.save("room-1", scene());

    const got = store.get("room-1")!;
    got.availableClues.push("x");
    got.presentNpcs[0]!.disposition = "hostile";

    const again = store.get("room-1")!;
    expect(again.availableClues).toEqual(["a", "b"]);
    expect(again.presentNpcs[0]?.disposition).toBe("wary");
  });

  it("stores a copy of the input (later input mutation is not reflected)", () => {
    const store = new InMemorySceneStore();
    const input = scene();
    store.save("room-1", input);
    input.availableClues.push("x");
    expect(store.get("room-1")?.availableClues).toEqual(["a", "b"]);
  });
});
