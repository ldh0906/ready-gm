import { describe, it, expect } from "vitest";
import { FakePgClient } from "./fake-pg.js";
import { PgClockRepository } from "./pg-clock-repository.js";
import { PgSceneRepository } from "./pg-scene-repository.js";
import { PgClockStore } from "./pg-clock-store.js";
import { PgSceneStore } from "./pg-scene-store.js";
import { makeClock } from "../core/progress-clock.js";
import { makeSceneState } from "../core/scene-state.js";

const clock = () =>
  makeClock({ id: "crypt_alert", name: "묘지 경계도", scope: "scene", max: 6, value: 2, onComplete: "patrol" });
const scene = () =>
  makeSceneState({ sceneId: "s1", location: "복도", sceneGoal: "g", availableClues: ["a"] });

describe("PgClockRepository", () => {
  it("reads clocks as a parsed jsonb array (empty when absent)", async () => {
    const db = new FakePgClient();
    const repo = new PgClockRepository(db);

    expect(await repo.get("room-1")).toEqual([]);

    db.enqueueRows([{ clocks: [clock()] }]);
    expect(await repo.get("room-1")).toEqual([clock()]);
  });

  it("upserts the whole clock array as a jsonb param", async () => {
    const db = new FakePgClient();
    await new PgClockRepository(db).save("room-1", [clock()]);

    expect(db.lastCall?.text).toContain("INSERT INTO room_clocks");
    expect(db.lastCall?.text).toContain("ON CONFLICT (room_id)");
    expect(db.lastCall?.values?.[0]).toBe("room-1");
    expect(JSON.parse(String(db.lastCall?.values?.[1]))).toEqual([clock()]);
  });

  it("lists all persisted clock records", async () => {
    const db = new FakePgClient();
    db.enqueueRows([{ room_id: "room-1", clocks: [clock()] }]);
    expect(await new PgClockRepository(db).listAll()).toEqual([
      { roomId: "room-1", clocks: [clock()] },
    ]);
  });
});

describe("PgSceneRepository", () => {
  it("reads a scene as parsed jsonb (undefined when absent)", async () => {
    const db = new FakePgClient();
    const repo = new PgSceneRepository(db);

    expect(await repo.get("room-1")).toBeUndefined();

    db.enqueueRows([{ scene: scene() }]);
    expect(await repo.get("room-1")).toEqual(scene());
  });

  it("upserts the scene as a jsonb param", async () => {
    const db = new FakePgClient();
    await new PgSceneRepository(db).save("room-1", scene());

    expect(db.lastCall?.text).toContain("INSERT INTO room_scenes");
    expect(db.lastCall?.values?.[0]).toBe("room-1");
    expect(JSON.parse(String(db.lastCall?.values?.[1]))).toEqual(scene());
  });
});

describe("PgClockStore (write-through)", () => {
  it("serves reads from cache synchronously and mirrors saves to the repository", async () => {
    const db = new FakePgClient();
    const store = new PgClockStore(new PgClockRepository(db));

    store.save("room-1", [clock()]);
    // Synchronous read from cache.
    expect(store.get("room-1")).toEqual([clock()]);

    await store.flush();
    // The durable upsert was issued in the background.
    expect(db.calls.some((c) => c.text.includes("INSERT INTO room_clocks"))).toBe(true);
  });

  it("hydrates the cache from the repository", async () => {
    const db = new FakePgClient();
    db.enqueueRows([{ room_id: "room-1", clocks: [clock()] }]);
    const store = new PgClockStore(new PgClockRepository(db));

    await store.hydrate();
    expect(store.get("room-1")).toEqual([clock()]);
  });

  it("reports background persist failures without throwing on save", async () => {
    const db = new FakePgClient();
    db.enqueueError(new Error("db down"));
    const errors: unknown[] = [];
    const store = new PgClockStore(new PgClockRepository(db), {
      onPersistError: (e) => errors.push(e),
    });

    expect(() => store.save("room-1", [clock()])).not.toThrow();
    await store.flush();
    expect(errors).toHaveLength(1);
    // The live cache still reflects the write.
    expect(store.get("room-1")).toEqual([clock()]);
  });
});

describe("PgSceneStore (write-through)", () => {
  it("serves reads from cache and mirrors saves to the repository", async () => {
    const db = new FakePgClient();
    const store = new PgSceneStore(new PgSceneRepository(db));

    store.save("room-1", scene());
    expect(store.get("room-1")).toEqual(scene());

    await store.flush();
    expect(db.calls.some((c) => c.text.includes("INSERT INTO room_scenes"))).toBe(true);
  });

  it("hydrates the cache from the repository", async () => {
    const db = new FakePgClient();
    db.enqueueRows([{ room_id: "room-1", scene: scene() }]);
    const store = new PgSceneStore(new PgSceneRepository(db));

    await store.hydrate();
    expect(store.get("room-1")).toEqual(scene());
  });
});
