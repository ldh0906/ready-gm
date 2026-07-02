import { describe, expect, it } from "vitest";
import {
  DEFAULT_SAFETY_PROFILE,
  findSafetyViolations,
  formatSafetyPolicy,
  resolveSafetyProfile,
  type SafetyProfile,
} from "./safety-profile.js";

const profile: SafetyProfile = {
  id: "test-safety",
  bannedTopics: ["고문 묘사", "Animal Cruelty"],
  toneBoundary: "PG-13",
  tableNotes: ["불편 신호 시 페이드아웃"],
};

describe("SafetyProfile — deterministic banned-topic gate", () => {
  it("finds banned topics case-insensitively and passes clean text", () => {
    expect(findSafetyViolations("어둠 속에서 고문 묘사가 이어졌다", profile)).toEqual(["고문 묘사"]);
    expect(findSafetyViolations("the scene hints at animal cruelty", profile)).toEqual([
      "Animal Cruelty",
    ]);
    expect(findSafetyViolations("파티는 조용히 지하로 내려갔다", profile)).toEqual([]);
  });

  it("resolves registered profiles and falls back to the default", () => {
    expect(resolveSafetyProfile("default-table-safety")).toBe(DEFAULT_SAFETY_PROFILE);
    expect(resolveSafetyProfile("unknown")).toBe(DEFAULT_SAFETY_PROFILE);
    expect(resolveSafetyProfile()).toBe(DEFAULT_SAFETY_PROFILE);
  });

  it("formats a SYSTEM policy block and stays empty without a profile", () => {
    const block = formatSafetyPolicy(profile);
    expect(block).toContain("SAFETY_POLICY");
    expect(block).toContain("고문 묘사");
    expect(block).toContain("PG-13");
    expect(formatSafetyPolicy(undefined)).toBe("");
  });
});
