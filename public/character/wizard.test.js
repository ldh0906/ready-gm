import { describe, expect, it } from "vitest";
import { deriveWizardSteps, wizardCanAdvance } from "./logic.js";

describe("character-sheet wizard helpers", () => {
  it("skips the role-card step for non-card schemas", () => {
    expect(deriveWizardSteps({ characterCards: [] }).map((step) => step.id)).toEqual([
      "sheet",
      "confirm",
      "readiness",
    ]);
  });

  it("includes role cards first for card-based schemas", () => {
    expect(deriveWizardSteps({ characterCards: [{ id: "a" }] }).map((step) => step.id)).toEqual([
      "cards",
      "sheet",
      "confirm",
      "readiness",
    ]);
  });

  it("blocks next on missing card or blank required name", () => {
    const cardSchema = { characterCards: [{ id: "a" }] };
    expect(wizardCanAdvance("cards", { activeSchema: cardSchema, selectedCardId: null })).toBe(false);
    expect(wizardCanAdvance("cards", { activeSchema: cardSchema, selectedCardId: "a" })).toBe(true);
    expect(wizardCanAdvance("sheet", { narrativeValues: { name: "   " } })).toBe(false);
    expect(wizardCanAdvance("sheet", { narrativeValues: { name: "나리" } })).toBe(true);
  });
});
