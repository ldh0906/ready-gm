import { describe, it, expect } from "vitest";
import {
  ScenarioService,
  InMemoryScenarioStore,
  MVP_SCENARIO,
  UnknownScenarioError,
  type Scenario,
} from "./scenario-service.js";

const SECOND_SCENARIO: Scenario = {
  id: "the-frost-hollow",
  title: "The Frost Hollow",
  summary: "A frozen vale hides a sleeping terror.",
  openingSeed: "Snow falls on a silent pass.",
  endingCondition: "The terror is laid to rest or wakes fully.",
  genre: "판타지 던전 탐험",
  category: "판타지 액션·탐험",
  hasSpecialRules: false,
  system: "EZFudge",
};

describe("ScenarioService — listing", () => {
  it("lists the single MVP scenario by default (R3.1)", () => {
    const svc = new ScenarioService();
    const list = svc.listScenarios();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(MVP_SCENARIO.id);
  });

  it("returns copies so callers cannot mutate the catalog", () => {
    const svc = new ScenarioService();
    svc.listScenarios()[0].title = "tampered";
    expect(svc.listScenarios()[0].title).toBe(MVP_SCENARIO.title);
  });
});

describe("ScenarioService — single-scenario default (R3.4)", () => {
  it("pre-selects the only scenario as the default for any room", () => {
    const svc = new ScenarioService();
    expect(svc.getDefaultScenarioId()).toBe(MVP_SCENARIO.id);
    expect(svc.getSelectedScenarioId("room-1")).toBe(MVP_SCENARIO.id);
    expect(svc.getSelectedScenario("room-1")?.id).toBe(MVP_SCENARIO.id);
    expect(svc.isSelectionResolved("room-1")).toBe(true);
    expect(svc.isExplicitSelectionRequired()).toBe(false);
  });
});

describe("ScenarioService — association round-trip (R3.2)", () => {
  it("reads back the scenario that was selected", () => {
    const svc = new ScenarioService();
    svc.selectScenario("room-1", MVP_SCENARIO.id);
    expect(svc.getSelectedScenarioId("room-1")).toBe(MVP_SCENARIO.id);
    expect(svc.getSelectedScenario("room-1")).toEqual(MVP_SCENARIO);
  });

  it("keeps selections independent per room", () => {
    const store = new InMemoryScenarioStore([MVP_SCENARIO, SECOND_SCENARIO]);
    const svc = new ScenarioService(store);
    svc.selectScenario("room-a", MVP_SCENARIO.id);
    svc.selectScenario("room-b", SECOND_SCENARIO.id);
    expect(svc.getSelectedScenarioId("room-a")).toBe(MVP_SCENARIO.id);
    expect(svc.getSelectedScenarioId("room-b")).toBe(SECOND_SCENARIO.id);
  });

  it("rejects selecting an unknown scenario", () => {
    const svc = new ScenarioService();
    expect(() => svc.selectScenario("room-1", "does-not-exist")).toThrow(UnknownScenarioError);
  });
});

describe("ScenarioService — explicit selection required (R3.5)", () => {
  it("has no default and requires explicit choice when multiple scenarios exist", () => {
    const store = new InMemoryScenarioStore([MVP_SCENARIO, SECOND_SCENARIO]);
    const svc = new ScenarioService(store);
    expect(svc.isExplicitSelectionRequired()).toBe(true);
    expect(svc.getDefaultScenarioId()).toBeNull();
    expect(svc.getSelectedScenarioId("room-1")).toBeNull();
    expect(svc.getSelectedScenario("room-1")).toBeNull();
    expect(svc.isSelectionResolved("room-1")).toBe(false);
  });

  it("resolves once the host explicitly selects", () => {
    const store = new InMemoryScenarioStore([MVP_SCENARIO, SECOND_SCENARIO]);
    const svc = new ScenarioService(store);
    svc.selectScenario("room-1", SECOND_SCENARIO.id);
    expect(svc.isSelectionResolved("room-1")).toBe(true);
    expect(svc.getSelectedScenario("room-1")).toEqual(SECOND_SCENARIO);
  });
});
