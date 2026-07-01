import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  InMemoryScenarioStore,
  ScenarioService,
  type Scenario,
} from "./scenario-service.js";

/**
 * Property-based test for scenario association.
 * Feature: trpg-session-engine
 */

const CATALOG: Scenario[] = [
  { id: "s1", title: "One", summary: "first", openingSeed: "o1", endingCondition: "e1", genre: "g", category: "c", hasSpecialRules: false, system: "EZFudge" },
  { id: "s2", title: "Two", summary: "second", openingSeed: "o2", endingCondition: "e2", genre: "g", category: "c", hasSpecialRules: false, system: "EZFudge" },
  { id: "s3", title: "Three", summary: "third", openingSeed: "o3", endingCondition: "e3", genre: "g", category: "c", hasSpecialRules: false, system: "EZFudge" },
];

describe("Scenario Service — property tests", () => {
  it("Property 6: Scenario association round-trip", () => {
    // Feature: trpg-session-engine, Property 6: Scenario association round-trip
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.constantFrom(...CATALOG.map((s) => s.id)),
        (roomId, scenarioId) => {
          // Multiple scenarios => explicit selection required, so the read-back
          // must reflect exactly what was selected.
          const svc = new ScenarioService(new InMemoryScenarioStore(CATALOG));
          svc.selectScenario(roomId, scenarioId);
          expect(svc.getSelectedScenarioId(roomId)).toBe(scenarioId);
          expect(svc.getSelectedScenario(roomId)?.id).toBe(scenarioId);
          expect(svc.isSelectionResolved(roomId)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
