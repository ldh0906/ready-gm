/**
 * Unit tests for the scenario-adaptive sheet schema: the pre-authored sheets,
 * the scenario→sheet mapping (with metadata injection), and the derived trait
 * spec the server uses to validate recorded attributes.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ATTRIBUTE_LADDER } from "../core/ezfudge.js";
import {
  GEESE_SHEET,
  SINKS_SHEET,
  UNIVERSAL_SHEET,
  expectedTraitSpecForScenario,
  parseDiceFormula,
  projectSheetForViewer,
  rollAllocationValues,
  rollDiceFormula,
  sheetSchemaForScenario,
  type SheetSchema,
} from "./sheet-schema.js";
import {
  ASHFALL_MONASTERY,
  MVP_SCENARIO,
  TERRIBLE_GEESE,
  TIDEWATCH_SMUGGLERS,
  UNTIL_IT_SINKS,
} from "./scenario-service.js";

function fieldIds(schema: SheetSchema): string[] {
  return schema.narrativeFields.map((f) => f.id);
}
function traitKeys(schema: SheetSchema): string[] {
  return schema.traits.map((t) => t.key);
}

describe("pre-authored sheets", () => {
  it("UNIVERSAL_SHEET has the 4 EZFudge traits plus name/concept", () => {
    expect(traitKeys(UNIVERSAL_SHEET)).toEqual(["Might", "Agility", "Wits", "Spirit"]);
    for (const trait of UNIVERSAL_SHEET.traits) {
      expect(trait.ladder).toEqual(DEFAULT_ATTRIBUTE_LADDER);
      expect(trait.rungLabels).toBeUndefined();
    }
    expect(fieldIds(UNIVERSAL_SHEET)).toEqual(["name", "concept", "bonds"]);
    const name = UNIVERSAL_SHEET.narrativeFields.find((f) => f.id === "name");
    const concept = UNIVERSAL_SHEET.narrativeFields.find((f) => f.id === "concept");
    expect(name?.maxLength).toBe(100);
    expect(concept?.maxLength).toBe(2000);
    expect(UNIVERSAL_SHEET.hasSpecialRules).toBe(false);
    expect(UNIVERSAL_SHEET.system).toBe("EZFudge");
  });

  it("GEESE_SHEET has 3 traits on a [1,4] ladder plus a special narrative field", () => {
    expect(traitKeys(GEESE_SHEET)).toEqual(["Sneaky", "Fast", "Tenacious"]);
    for (const trait of GEESE_SHEET.traits) {
      expect(trait.ladder).toEqual({ min: 1, max: 4 });
      expect(trait.rungLabels).toEqual({ "1": "1", "2": "2", "3": "3", "4": "4" });
      expect(trait.sectionId).toBe("attributes");
    }
    expect(fieldIds(GEESE_SHEET)).toEqual(["name", "concept", "special", "bonds"]);
    const special = GEESE_SHEET.narrativeFields.find((f) => f.id === "special");
    expect(special?.sectionId).toBe("narrative");
    expect(special?.maxLength).toBe(2000);
    expect(GEESE_SHEET.hasSpecialRules).toBe(true);
  });

  it("SINKS_SHEET is narrative-only with name/concept/disposition/goal", () => {
    expect(SINKS_SHEET.traits).toEqual([]);
    expect(SINKS_SHEET.sections).toEqual([{ id: "narrative", label: "인물" }]);
    expect(fieldIds(SINKS_SHEET)).toEqual(["name", "concept", "disposition", "goal"]);
    for (const field of SINKS_SHEET.narrativeFields) {
      expect(field.sectionId).toBe("narrative");
    }
    expect(SINKS_SHEET.narrativeFields.find((f) => f.id === "name")?.maxLength).toBe(100);
  });
});

describe("projectSheetForViewer", () => {
  const schema: SheetSchema = {
    genre: "test",
    category: "test",
    system: "test",
    hasSpecialRules: true,
    sections: [{ id: "narrative", label: "서사" }],
    narrativeFields: [
      { id: "name", label: "이름", guidance: "", maxLength: 100, sectionId: "narrative" },
      { id: "concept", label: "컨셉", guidance: "", maxLength: 100, sectionId: "narrative" },
      { id: "publicNote", label: "공개", guidance: "", maxLength: 100, sectionId: "narrative" },
      {
        id: "secret",
        label: "비밀",
        guidance: "",
        maxLength: 100,
        sectionId: "narrative",
        visibility: "private",
      },
      { id: "empty", label: "빈 값", guidance: "", maxLength: 100, sectionId: "narrative" },
    ],
    traits: [
      {
        key: "Sneaky",
        label: "은밀",
        ladder: { min: 1, max: 4 },
        rungLabels: { "1": "초보", "3": "능숙" },
        sectionId: "attributes",
      },
      {
        key: "Fast",
        label: "빠름",
        ladder: { min: 1, max: 4 },
        rungLabels: { "1": "느림" },
        sectionId: "attributes",
      },
    ],
    allocation: { mode: "LADDER_SELECT" },
    attributeProposalSupported: true,
    characterCards: [{ id: "scout", roleLabel: "정찰병", premise: "앞장선다" }],
  };

  const character = {
    name: "나리",
    concept: "조심스러운 정찰병",
    attributes: { Sneaky: 3 },
    selectedCardId: "scout",
    sheetData: {
      narrativeFields: {
        name: "중복 이름",
        concept: "중복 컨셉",
        publicNote: "모두 아는 사실",
        secret: "숨겨야 할 비밀",
        empty: "   ",
      },
    },
  };

  it("omits private and blank narrative fields from another player's view", () => {
    const view = projectSheetForViewer(character, schema, false);
    expect(view.isSelf).toBe(false);
    expect(view.narrativeFields).toEqual([
      { id: "publicNote", label: "공개", value: "모두 아는 사실" },
    ]);
  });

  it("includes private narrative fields for the owner only", () => {
    const view = projectSheetForViewer(character, schema, true);
    expect(view.isSelf).toBe(true);
    expect(view.narrativeFields).toEqual([
      { id: "publicNote", label: "공개", value: "모두 아는 사실" },
      { id: "secret", label: "비밀", value: "숨겨야 할 비밀" },
    ]);
  });

  it("keeps name and concept top-level and resolves card and trait labels", () => {
    const view = projectSheetForViewer(character, schema, true);
    expect(view.name).toBe("나리");
    expect(view.concept).toBe("조심스러운 정찰병");
    expect(view.narrativeFields.map((field) => field.id)).not.toContain("name");
    expect(view.narrativeFields.map((field) => field.id)).not.toContain("concept");
    expect(view.card).toEqual({ id: "scout", roleLabel: "정찰병" });
    expect(view.attributes).toEqual([
      { key: "Sneaky", label: "은밀", value: 3, rungLabel: "능숙" },
      { key: "Fast", label: "빠름", value: 1, rungLabel: "느림" },
    ]);
  });

  it("falls back to an unknown selected card id as its role label", () => {
    const view = projectSheetForViewer(
      { ...character, selectedCardId: "unknown-card" },
      schema,
      true,
    );
    expect(view.card).toEqual({ id: "unknown-card", roleLabel: "unknown-card" });
  });
});

describe("sheetSchemaForScenario", () => {
  it("maps universal scenarios to the EZFudge sheet and injects metadata", () => {
    for (const scenario of [MVP_SCENARIO, TIDEWATCH_SMUGGLERS, ASHFALL_MONASTERY]) {
      const schema = sheetSchemaForScenario(scenario);
      expect(traitKeys(schema)).toEqual(["Might", "Agility", "Wits", "Spirit"]);
      expect(schema.scenarioId).toBe(scenario.id);
      expect(schema.genre).toBe(scenario.genre);
      expect(schema.category).toBe(scenario.category);
      expect(schema.hasSpecialRules).toBe(scenario.hasSpecialRules);
      expect(schema.system).toBe(scenario.system);
    }
  });

  it("maps terrible-geese to the geese sheet", () => {
    const schema = sheetSchemaForScenario(TERRIBLE_GEESE);
    expect(traitKeys(schema)).toEqual(["Sneaky", "Fast", "Tenacious"]);
    expect(fieldIds(schema)).toContain("special");
    expect(schema.scenarioId).toBe("terrible-geese");
    expect(schema.system).toBe("D6 다이스 풀");
  });

  it("maps until-it-sinks to the narrative-only sinks sheet", () => {
    const schema = sheetSchemaForScenario(UNTIL_IT_SINKS);
    expect(schema.traits).toEqual([]);
    expect(fieldIds(schema)).toEqual(["name", "concept", "disposition", "goal"]);
    expect(schema.scenarioId).toBe("until-it-sinks");
    expect(schema.hasSpecialRules).toBe(true);
  });

  it("returns a deep copy that cannot mutate the shared template", () => {
    const schema = sheetSchemaForScenario(MVP_SCENARIO);
    schema.traits[0].ladder.max = 999;
    schema.narrativeFields[0].label = "changed";
    expect(UNIVERSAL_SHEET.traits[0].ladder.max).toBe(DEFAULT_ATTRIBUTE_LADDER.max);
    expect(UNIVERSAL_SHEET.narrativeFields[0].label).toBe("이름");
  });
});

describe("expectedTraitSpecForScenario", () => {
  it("derives the EZFudge keys/ladder for universal scenarios", () => {
    const spec = expectedTraitSpecForScenario(MVP_SCENARIO);
    expect(spec.keys).toEqual(["Might", "Agility", "Wits", "Spirit"]);
    expect(spec.ladder).toEqual(DEFAULT_ATTRIBUTE_LADDER);
  });

  it("derives the geese keys/ladder", () => {
    const spec = expectedTraitSpecForScenario(TERRIBLE_GEESE);
    expect(spec.keys).toEqual(["Sneaky", "Fast", "Tenacious"]);
    expect(spec.ladder).toEqual({ min: 1, max: 4 });
  });

  it("returns empty keys with the default ladder for narrative-only scenarios", () => {
    const spec = expectedTraitSpecForScenario(UNTIL_IT_SINKS);
    expect(spec.keys).toEqual([]);
    expect(spec.ladder).toEqual(DEFAULT_ATTRIBUTE_LADDER);
  });
});

describe("DICE_ROLL server-side allocation roll", () => {
  it("parses NdM / NdF formulas with optional modifiers and rejects junk", () => {
    expect(parseDiceFormula("2d6")).toEqual({ count: 2, sides: 6, modifier: 0 });
    expect(parseDiceFormula(" 4dF ")).toEqual({ count: 4, sides: "F", modifier: 0 });
    expect(parseDiceFormula("1d8+1")).toEqual({ count: 1, sides: 8, modifier: 1 });
    expect(parseDiceFormula("3d6-2")).toEqual({ count: 3, sides: 6, modifier: -2 });
    for (const junk of ["", "d6", "2d", "0d6", "2d1", "2d101", "21d6", "banana", "2d6+"]) {
      expect(parseDiceFormula(junk)).toBeNull();
    }
  });

  it("rolls within the formula bounds using the injected RNG", () => {
    const spec = parseDiceFormula("2d6+1")!;
    expect(rollDiceFormula(spec, () => 0)).toBe(3); // two 1s + 1
    expect(rollDiceFormula(spec, () => 0.999999)).toBe(13); // two 6s + 1
    const fudge = parseDiceFormula("4dF")!;
    expect(rollDiceFormula(fudge, () => 0)).toBe(-4);
    expect(rollDiceFormula(fudge, () => 0.999999)).toBe(4);
  });

  it("rolls one clamped value per rated trait for a DICE_ROLL schema", () => {
    const schema: SheetSchema = {
      ...UNIVERSAL_SHEET,
      traits: UNIVERSAL_SHEET.traits.map((t) => ({ ...t })),
      allocation: { mode: "DICE_ROLL", diceFormula: "2d6", forcedRandom: true },
    };
    const values = rollAllocationValues(schema, () => 0.999999);
    expect(values).not.toBeNull();
    for (const trait of schema.traits) {
      // 2d6 max (12) clamps to the trait ladder max.
      expect(values![trait.key]).toBe(trait.ladder.max);
      expect(Number.isInteger(values![trait.key])).toBe(true);
    }
  });

  it("fail-closed: non-DICE_ROLL schemas and invalid formulas roll nothing", () => {
    expect(rollAllocationValues(UNIVERSAL_SHEET)).toBeNull();
    const broken: SheetSchema = {
      ...UNIVERSAL_SHEET,
      allocation: { mode: "DICE_ROLL", diceFormula: "banana", forcedRandom: false },
    };
    expect(rollAllocationValues(broken)).toBeNull();
  });
});
