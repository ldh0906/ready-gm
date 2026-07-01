import { describe, it, expect } from "vitest";
import { makeEngineConfig } from "../core/config.js";
import { createDiceService } from "../core/dice.js";
import type { AttributeKey } from "../core/types.js";
import type { TurnState } from "../core/turn-state.js";
import type { ContextScenario } from "../services/turn-state-context.js";
import type { Character } from "../services/types.js";
import { FakeAiGmClient, type CompleteRequest, type FakeCompletion } from "./ai-gm-client.js";
import { AiGmRouter } from "./ai-gm-router.js";
import { AiGmCoordinator } from "./ai-gm-coordinator.js";

/**
 * Unit tests for dice-failure withholding (R17.3) and AI attribute completeness
 * (R4.2) — task 13.12.
 */

const SCENARIO: ContextScenario = {
  title: "지하실",
  summary: "요약",
  openingSeed: "씨앗",
  endingCondition: "끝",
};

function character(): Character {
  return {
    id: "char-p0",
    playerId: "p0",
    roomId: "room-1",
    name: "보린",
    concept: "전사",
    attributes: { Might: 1, Agility: 0, Wits: 2, Spirit: -1 },
    confirmed: true,
  };
}

function state(): TurnState {
  return {
    roomId: "room-1",
    roundNumber: 2,
    phase: "resolving",
    readiness: [{ playerId: "p0", status: "ready", actionKind: "confirmed_action", actionText: "행동" }],
    chatLog: [],
    checks: [],
    narrativeContext: [],
    readyCheckDeadline: null,
    readyCheckTimeoutMs: 90000,
    resolutionRequested: true,
  };
}

function responder(req: CompleteRequest): FakeCompletion {
  const u = req.prompt.user;
  if (u.includes("PHASE: decision")) {
    return { text: JSON.stringify({ checks: [{ characterName: "보린", attribute: "Might", difficulty: "Hard" }], stateChanges: [] }) };
  }
  if (u.includes("PHASE: narration")) {
    return { text: JSON.stringify({ narration: "한국어 결과 서사.", endingReached: false, stateChanges: [] }) };
  }
  if (u.includes("PHASE: attributes")) {
    return { text: JSON.stringify({ attributes: { Might: 2, Agility: 1, Wits: 0, Spirit: -1 } }) };
  }
  return { text: "{}" };
}

describe("AI GM Coordinator — dice failure withholding (R17.3)", () => {
  it("withholds the resolution and preserves state when the Dice_Service fails", async () => {
    const config = makeEngineConfig();
    const router = new AiGmRouter({ client: new FakeAiGmClient({ responder }), config });
    // An out-of-range source forces a DiceRollError, surfaced as a failed tryRoll.
    const dice = createDiceService(config.diceRange, () => 999);
    const coordinator = new AiGmCoordinator({ router, dice, config });

    const input = state();
    const res = await coordinator.resolveRound({ state: input, scenario: SCENARIO, characters: [character()] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.reason).toBe("dice_failed");
    // The round's recorded actions/passes are preserved (only the guard is cleared).
    expect(res.preservedState).toStrictEqual({ ...input, resolutionRequested: false });
  });
});

describe("AI GM Coordinator — attribute proposal completeness (R4.2)", () => {
  it("returns a complete EZFudge attribute set", async () => {
    const config = makeEngineConfig();
    const router = new AiGmRouter({ client: new FakeAiGmClient({ responder }), config });
    const dice = createDiceService(config.diceRange, () => 2);
    const coordinator = new AiGmCoordinator({ router, dice, config });

    const res = await coordinator.proposeAttributes("전사", SCENARIO);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const keys: AttributeKey[] = ["Might", "Agility", "Wits", "Spirit"];
    for (const k of keys) {
      expect(typeof res.value[k]).toBe("number");
    }
  });
});
