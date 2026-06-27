import { describe, it, expect } from "vitest";
import { resolveCheck, difficultyTarget, DIFFICULTY_TARGET } from "./ezfudge.js";
import type { DifficultyGrade } from "./types.js";

describe("difficultyTarget", () => {
  it("maps each difficulty grade to its spec target", () => {
    // design.md: Trivial=-2, Easy=-1, Average=0, Hard=+1, Formidable=+2
    expect(difficultyTarget("Trivial")).toBe(-2);
    expect(difficultyTarget("Easy")).toBe(-1);
    expect(difficultyTarget("Average")).toBe(0);
    expect(difficultyTarget("Hard")).toBe(1);
    expect(difficultyTarget("Formidable")).toBe(2);
  });
});

describe("resolveCheck — margin thresholds (R11.3, R11.4)", () => {
  // Against Average (target 0), margin === attribute + roll.
  it("returns Failure when margin < 0", () => {
    expect(resolveCheck(0, "Average", -1)).toBe("Failure");
    expect(resolveCheck(-2, "Average", 1)).toBe("Failure");
  });

  it("returns Partial Success when margin === 0", () => {
    expect(resolveCheck(0, "Average", 0)).toBe("Partial Success");
    expect(resolveCheck(2, "Average", -2)).toBe("Partial Success");
  });

  it("returns Success when margin is 1 or 2", () => {
    expect(resolveCheck(1, "Average", 0)).toBe("Success");
    expect(resolveCheck(0, "Average", 2)).toBe("Success");
  });

  it("returns Critical Success when margin >= 3", () => {
    expect(resolveCheck(3, "Average", 0)).toBe("Critical Success");
    expect(resolveCheck(2, "Average", 4)).toBe("Critical Success");
  });
});

describe("resolveCheck — difficulty target shifts the margin (R11.4)", () => {
  it("harder difficulty raises the bar", () => {
    // attribute+roll = 2; Formidable target 2 => margin 0 => Partial Success
    expect(resolveCheck(0, "Formidable", 2)).toBe("Partial Success");
    // same total against Trivial target -2 => margin 4 => Critical Success
    expect(resolveCheck(0, "Trivial", 2)).toBe("Critical Success");
  });

  it("is consistent with difficultyTarget for every grade", () => {
    const grades: DifficultyGrade[] = ["Trivial", "Easy", "Average", "Hard", "Formidable"];
    for (const g of grades) {
      // attribute+roll exactly equal to the target yields margin 0.
      expect(resolveCheck(0, g, DIFFICULTY_TARGET[g])).toBe("Partial Success");
    }
  });
});
