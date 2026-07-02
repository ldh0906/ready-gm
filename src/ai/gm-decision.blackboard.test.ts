import { describe, expect, it } from "vitest";
import { parseGmDecision } from "./gm-decision.js";

describe("parseGmDecision blackboardDeltas", () => {
  it("drops malformed blackboardDeltas defensively without failing the decision", () => {
    const result = parseGmDecision(
      JSON.stringify({
        needsRoll: false,
        blackboardDeltas: [
          { type: "reveal_clue", clueId: "clue-1", reason: "found" },
          { type: "reveal_clue", clueId: 7, reason: "bad" },
          { type: "unknown", reason: "bad" },
          "bad",
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.blackboardDeltas).toEqual([
      { type: "reveal_clue", clueId: "clue-1", reason: "found" },
    ]);
  });
});
