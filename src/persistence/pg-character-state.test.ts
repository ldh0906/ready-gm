import { describe, it, expect } from "vitest";
import { FakePgClient } from "./fake-pg.js";
import { PgCharacterStateRepository } from "./pg-character-state-repository.js";
import { PgCharacterStateStore } from "./pg-character-state-store.js";
import {
  applyCharacterDeltas,
  makeCharacterState,
  type CharacterState,
} from "../core/character-state.js";

const state = (): CharacterState =>
  makeCharacterState({
    characterId: "char-1",
    conditions: [{ name: "부상", severity: 2, reason: "낙석" }],
    inventory: [{ name: "밧줄", tags: ["도구"], reason: "습득" }],
    resources: { 기력: 3 },
    relationships: { "npc-1": { targetId: "npc-1", attitude: "경계", reason: "첫 만남" } },
    personalClocks: [{ id: "curse", name: "저주", value: 1, max: 4 }],
    memories: [{ text: "지하에서 속삭임을 들었다", salience: 3, reason: "탐색" }],
    flags: { marked: true },
  });

describe("PgCharacterStateRepository", () => {
  it("reads states as a parsed jsonb array (empty when absent)", async () => {
    const db = new FakePgClient();
    const repo = new PgCharacterStateRepository(db);

    expect(await repo.get("room-1")).toEqual([]);

    db.enqueueRows([{ states: [state()] }]);
    expect(await repo.get("room-1")).toEqual([state()]);
  });

  it("upserts the whole state array as a jsonb param", async () => {
    const db = new FakePgClient();
    await new PgCharacterStateRepository(db).save("room-1", [state()]);

    expect(db.lastCall?.text).toContain("INSERT INTO room_character_states");
    expect(db.lastCall?.text).toContain("ON CONFLICT (room_id)");
    expect(db.lastCall?.values?.[0]).toBe("room-1");
    expect(JSON.parse(String(db.lastCall?.values?.[1]))).toEqual([state()]);
  });

  it("lists all persisted state records", async () => {
    const db = new FakePgClient();
    db.enqueueRows([{ room_id: "room-1", states: [state()] }]);
    expect(await new PgCharacterStateRepository(db).listAll()).toEqual([
      { roomId: "room-1", states: [state()] },
    ]);
  });
});

describe("PgCharacterStateStore (write-through)", () => {
  it("serves reads from cache synchronously and mirrors saves to the repository", async () => {
    const db = new FakePgClient();
    const store = new PgCharacterStateStore(new PgCharacterStateRepository(db));

    store.save("room-1", [state()]);
    expect(store.get("room-1")).toEqual([state()]);

    await store.flush();
    expect(db.calls.some((c) => c.text.includes("INSERT INTO room_character_states"))).toBe(true);
  });

  it("hydrates the cache from the repository", async () => {
    const db = new FakePgClient();
    db.enqueueRows([{ room_id: "room-1", states: [state()] }]);
    const store = new PgCharacterStateStore(new PgCharacterStateRepository(db));

    await store.hydrate();
    expect(store.get("room-1")).toEqual([state()]);
  });

  it("reports background persist failures without throwing on save", async () => {
    const db = new FakePgClient();
    db.enqueueError(new Error("db down"));
    const errors: unknown[] = [];
    const store = new PgCharacterStateStore(new PgCharacterStateRepository(db), {
      onPersistError: (e) => errors.push(e),
    });

    expect(() => store.save("room-1", [state()])).not.toThrow();
    await store.flush();
    expect(errors).toHaveLength(1);
    // The live cache still reflects the write.
    expect(store.get("room-1")).toEqual([state()]);
  });

  it("round-trips reducer-applied deltas through save -> hydrate on a fresh store", async () => {
    // Simulate: round N applies deltas, states are persisted; the process
    // restarts; a fresh store hydrates and round N+1 sees the applied state.
    const application = applyCharacterDeltas(
      [state()],
      [
        { type: "spend_resource", characterId: "char-1", resource: "기력", amount: 1, reason: "질주" },
        { type: "add_condition", characterId: "char-1", condition: "탈진", reason: "질주" },
      ],
    );
    expect(application.applied).toHaveLength(2);

    const db = new FakePgClient();
    const before = new PgCharacterStateStore(new PgCharacterStateRepository(db));
    before.save("room-1", application.states);
    await before.flush();

    // Replay the persisted jsonb param as the fresh store's hydration row.
    const persisted = JSON.parse(String(db.lastCall?.values?.[1])) as CharacterState[];
    const db2 = new FakePgClient();
    db2.enqueueRows([{ room_id: "room-1", states: persisted }]);
    const after = new PgCharacterStateStore(new PgCharacterStateRepository(db2));
    await after.hydrate();

    const restored = after.get("room-1");
    expect(restored).toEqual(application.states);
    expect(restored[0]?.resources["기력"]).toBe(2);
    expect(restored[0]?.conditions.map((c) => c.name)).toContain("탈진");
  });
});
