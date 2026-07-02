import { describe, it, expect } from "vitest";
import { parseGmDecision } from "./gm-decision.js";

describe("parseGmDecision", () => {
  it("parses a full hot-path decision", () => {
    const raw = JSON.stringify({
      intent: "inspect",
      gmMove: "reveal_clue_with_cost",
      needsRoll: true,
      checks: [{ characterName: "보린", attribute: "Wits", difficulty: "Average" }],
      clockDeltas: [{ clockId: "crypt_alert", delta: 1, condition: "on_partial_or_failure", reason: "조사 시간" }],
      stateChanges: [{ target: "clue", to: "footprints" }],
      characterDeltas: [
        {
          type: "add_condition",
          characterId: "char-p2",
          condition: "겁에 질림",
          severity: 1,
          reason: "무덤의 속삭임",
        },
      ],
      scenePurpose: "reveal",
      spotlightTarget: "세라",
      stakes: "아이들이 끌려간 방향을 알아낼 수 있는가",
      procedureNotes: ["clue_reveal hint followed"],
      offFront: false,
      climactic: false,
      safetyFlags: [],
    });

    const result = parseGmDecision(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.intent).toBe("inspect");
    expect(result.value.gmMove).toBe("reveal_clue_with_cost");
    expect(result.value.scenePurpose).toBe("reveal");
    expect(result.value.spotlightTarget).toBe("세라");
    expect(result.value.stakes).toBe("아이들이 끌려간 방향을 알아낼 수 있는가");
    expect(result.value.procedureNotes).toEqual(["clue_reveal hint followed"]);
    expect(result.value.characterDeltas).toEqual([
      {
        type: "add_condition",
        characterId: "char-p2",
        condition: "겁에 질림",
        severity: 1,
        reason: "무덤의 속삭임",
      },
    ]);
    expect(result.value.needsRoll).toBe(true);
    expect(result.value.checks).toHaveLength(1);
    expect(result.value.clockDeltas[0]).toEqual({
      clockId: "crypt_alert",
      delta: 1,
      condition: "on_partial_or_failure",
      reason: "조사 시간",
    });
  });

  it("defaults list/flag fields and infers needsRoll from checks", () => {
    const result = parseGmDecision(
      JSON.stringify({ checks: [{ characterName: "x", attribute: "Might", difficulty: "Hard" }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.needsRoll).toBe(true);
    expect(result.value.clockDeltas).toEqual([]);
    expect(result.value.stateChanges).toEqual([]);
    expect(result.value.characterDeltas).toEqual([]);
    expect(result.value.revealedClues).toEqual([]);
    expect(result.value.procedureNotes).toEqual([]);
    expect(result.value.safetyFlags).toEqual([]);
    expect(result.value.offFront).toBe(false);
    expect(result.value.climactic).toBe(false);
  });

  it("parses revealedClues (string ids only)", () => {
    const result = parseGmDecision(
      JSON.stringify({ checks: [], revealedClues: ["small_footprints", 42, "ritual_symbol"] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.revealedClues).toEqual(["small_footprints", "ritual_symbol"]);
  });

  it("drops unknown intent and gmMove rather than failing", () => {
    const result = parseGmDecision(
      JSON.stringify({ intent: "vibing", gmMove: "summon_dragon", checks: [] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.intent).toBeUndefined();
    expect(result.value.gmMove).toBeUndefined();
  });

  it("drops an unknown scenePurpose but keeps optional string guidance fields", () => {
    const result = parseGmDecision(
      JSON.stringify({
        checks: [],
        scenePurpose: "vibes",
        spotlightTarget: "보린",
        stakes: "문을 열 수 있는가",
        procedureNotes: ["pressure clock considered", 42],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scenePurpose).toBeUndefined();
    expect(result.value.spotlightTarget).toBe("보린");
    expect(result.value.stakes).toBe("문을 열 수 있는가");
    expect(result.value.procedureNotes).toEqual(["pressure clock considered"]);
  });

  it("accepts any non-empty attribute key (scenario-driven; e.g. custom stats)", () => {
    // Attributes are no longer restricted to the EZFudge set: custom-stat
    // scenarios (e.g. Sneaky/Fast/Tenacious) must parse. The coordinator later
    // drops checks whose attribute the acting character does not actually have.
    const result = parseGmDecision(
      JSON.stringify({ checks: [{ characterName: "거", attribute: "Sneaky", difficulty: "Hard" }] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.checks[0]?.attribute).toBe("Sneaky");
  });

  it("rejects a malformed check (empty/non-string attribute)", () => {
    const empty = parseGmDecision(
      JSON.stringify({ checks: [{ characterName: "x", attribute: "  ", difficulty: "Hard" }] }),
    );
    expect(empty.ok).toBe(false);
    const nonString = parseGmDecision(
      JSON.stringify({ checks: [{ characterName: "x", attribute: 7, difficulty: "Hard" }] }),
    );
    expect(nonString.ok).toBe(false);
  });

  it("rejects a clockDelta with a non-numeric delta", () => {
    const result = parseGmDecision(
      JSON.stringify({ clockDeltas: [{ clockId: "c", delta: "lots" }] }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects malformed characterDeltas instead of accepting arbitrary state mutation", () => {
    const result = parseGmDecision(
      JSON.stringify({ characterDeltas: [{ type: "spend_resource", characterId: "char-1", resource: "focus", amount: "all" }] }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects non-object / non-JSON input", () => {
    expect(parseGmDecision("not json").ok).toBe(false);
    expect(parseGmDecision(JSON.stringify([1, 2])).ok).toBe(false);
  });

  it("preserves a check's proposed advantage", () => {
    const result = parseGmDecision(
      JSON.stringify({
        checks: [{ characterName: "보린", attribute: "Agility", difficulty: "Hard", advantage: "disadvantage" }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.checks[0].advantage).toBe("disadvantage");
  });

  it("defaults a missing or invalid advantage to 'none' (fail-open)", () => {
    const missing = parseGmDecision(
      JSON.stringify({ checks: [{ characterName: "보린", attribute: "Might", difficulty: "Average" }] }),
    );
    expect(missing.ok).toBe(true);
    if (!missing.ok) return;
    expect(missing.value.checks[0].advantage).toBe("none");

    const invalid = parseGmDecision(
      JSON.stringify({ checks: [{ characterName: "보린", attribute: "Might", difficulty: "Average", advantage: "lucky" }] }),
    );
    expect(invalid.ok).toBe(true);
    if (!invalid.ok) return;
    expect(invalid.value.checks[0].advantage).toBe("none");
  });

  it("parses a check's proposed visibility ('gm' hidden roll)", () => {
    const result = parseGmDecision(
      JSON.stringify({
        checks: [{ characterName: "함정", attribute: "Agility", difficulty: "Hard", visibility: "gm" }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.checks[0].visibility).toBe("gm");
  });

  it("defaults a missing or invalid visibility to 'player' (fail-open)", () => {
    const missing = parseGmDecision(
      JSON.stringify({ checks: [{ characterName: "보린", attribute: "Might", difficulty: "Average" }] }),
    );
    expect(missing.ok).toBe(true);
    if (!missing.ok) return;
    expect(missing.value.checks[0].visibility).toBe("player");

    const invalid = parseGmDecision(
      JSON.stringify({ checks: [{ characterName: "보린", attribute: "Might", difficulty: "Average", visibility: "secret" }] }),
    );
    expect(invalid.ok).toBe(true);
    if (!invalid.ok) return;
    expect(invalid.value.checks[0].visibility).toBe("player");
  });
});
