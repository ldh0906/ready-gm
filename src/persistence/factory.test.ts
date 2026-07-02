import { describe, it, expect } from "vitest";
import {
  createPersistence,
  hydratePersistence,
  resolvePersistenceMode,
  type Persistence,
} from "./factory.js";

describe("resolvePersistenceMode", () => {
  it("defaults to memory so local playtests ignore database env by default", () => {
    expect(resolvePersistenceMode({ DATABASE_URL: "postgres://example/db" })).toBe("memory");
  });

  it("accepts explicit durable and memory modes case-insensitively", () => {
    expect(resolvePersistenceMode({ PERSISTENCE_MODE: "durable" })).toBe("durable");
    expect(resolvePersistenceMode({ PERSISTENCE_MODE: "MEMORY" })).toBe("memory");
  });

  it("rejects unknown modes fail-fast", () => {
    expect(() => resolvePersistenceMode({ PERSISTENCE_MODE: "postgres" })).toThrow(
      /PERSISTENCE_MODE/,
    );
  });
});

describe("createPersistence — backend selection", () => {
  it("selects the in-memory backend when no connection string is configured", () => {
    const persistence = createPersistence({});
    expect(persistence.backend).toBe("memory");
  });

  it("selects the Postgres backend (with a durable character-state store) when configured", () => {
    const persistence = createPersistence({ DATABASE_URL: "postgres://example/db" });
    expect(persistence.backend).toBe("postgres");
    // The character-state store is the Pg write-through adapter (hydratable),
    // not the plain in-memory store.
    expect(
      typeof (persistence.characterStateStore as { hydrate?: unknown }).hydrate,
    ).toBe("function");
  });
});

describe("hydratePersistence — startup cache load", () => {
  it("is a no-op on the in-memory backend", async () => {
    const persistence = createPersistence({});
    await expect(hydratePersistence(persistence)).resolves.toBeUndefined();
  });

  it("hydrates every hydratable store on the postgres backend", async () => {
    const hydrated: string[] = [];
    const hydratable = (name: string) => ({
      hydrate: async () => {
        hydrated.push(name);
      },
    });
    const persistence = {
      backend: "postgres",
      roomStore: hydratable("rooms"),
      turnStateStore: hydratable("turnStates"),
      clockStore: hydratable("clocks"),
      sceneStore: hydratable("scenes"),
      characterStateStore: hydratable("characterStates"),
      scenarioStore: {},
      sessionSummaryRepository: {},
      eventSink: {},
    } as unknown as Persistence;

    await hydratePersistence(persistence);
    expect(hydrated).toEqual(["rooms", "turnStates", "clocks", "scenes", "characterStates"]);
  });
});
