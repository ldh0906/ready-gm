import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { makeEngineConfig } from "../core/config.js";
import { createDiceService, type UniformIntSource } from "../core/dice.js";
import { resolveCheck } from "../core/ezfudge.js";
import type { AttributeKey, AttributeLevel, EngineConfig, ModelTier, RequestType } from "../core/types.js";
import type { TurnState } from "../core/turn-state.js";
import type { ContextScenario } from "../services/turn-state-context.js";
import type { Character } from "../services/types.js";
import { FakeAiGmClient, type CompleteRequest, type FakeCompletion } from "./ai-gm-client.js";
import { AiGmRouter } from "./ai-gm-router.js";
import { AiGmCoordinator } from "./ai-gm-coordinator.js";

/**
 * Property-based tests for the AI GM Coordinator + Router.
 * Feature: trpg-session-engine
 */

const SCENARIO: ContextScenario = {
  title: "태양 없는 지하실",
  summary: "사라진 아이들을 찾아 지하 묘지로 내려간다.",
  openingSeed: "황혼의 마을, 차가운 묘지의 계단.",
  endingCondition: "아이들을 데리고 묘지를 탈출하거나, 묘지에 갇힌다.",
};

const ATTRS: Record<AttributeKey, AttributeLevel> = { Might: 1, Agility: 0, Wits: 2, Spirit: -1 };

/** First character is always named 보린 so the default check selection resolves. */
function makeCharacters(playerIds: readonly string[]): Character[] {
  return playerIds.map((playerId, i) => ({
    id: `char-${playerId}`,
    playerId,
    roomId: "room-1",
    name: i === 0 ? "보린" : `용사-${i}`,
    concept: "용감한 모험가",
    attributes: { ...ATTRS },
    confirmed: true,
  }));
}

function makeState(playerIds: readonly string[]): TurnState {
  return {
    roomId: "room-1",
    roundNumber: 2,
    phase: "resolving",
    readiness: playerIds.map((playerId) => ({
      playerId,
      status: "ready",
      actionKind: "confirmed_action",
      actionText: `${playerId}의 행동`,
    })),
    chatLog: [],
    checks: [],
    narrativeContext: [],
    readyCheckDeadline: null,
    readyCheckTimeoutMs: 90000,
    resolutionRequested: true,
  };
}

function loggingDiceSource(value: number, log: string[]): UniformIntSource {
  return () => {
    log.push("dice");
    return value;
  };
}

interface ResponderCfg {
  log?: string[];
  narration?: FakeCompletion;
  opening?: FakeCompletion;
  checkSelection?: FakeCompletion;
}

function phaseResponder(cfg: ResponderCfg = {}) {
  return (req: CompleteRequest): FakeCompletion => {
    const u = req.prompt.user;
    if (u.includes("PHASE: opening")) {
      cfg.log?.push("ai:opening");
      return cfg.opening ?? { text: JSON.stringify({ narration: "한국어 도입부 서사입니다." }) };
    }
    if (u.includes("PHASE: decision")) {
      cfg.log?.push("ai:check-selection");
      return (
        cfg.checkSelection ?? {
          text: JSON.stringify({
            checks: [{ characterName: "보린", attribute: "Might", difficulty: "Hard" }],
            noRollRationales: [
              { characterName: "용사-1", rationale: "이번 라운드에는 별도 판정 없이 보조합니다." },
              { characterName: "용사-2", rationale: "이번 라운드에는 별도 판정 없이 보조합니다." },
              { characterName: "용사-3", rationale: "이번 라운드에는 별도 판정 없이 보조합니다." },
              { characterName: "용사-4", rationale: "이번 라운드에는 별도 판정 없이 보조합니다." },
              { characterName: "용사-5", rationale: "이번 라운드에는 별도 판정 없이 보조합니다." },
            ],
            stateChanges: [],
          }),
        }
      );
    }
    if (u.includes("PHASE: narration")) {
      cfg.log?.push("ai:narration");
      return (
        cfg.narration ?? {
          text: JSON.stringify({ narration: "한국어 결과 서사.", endingReached: false, stateChanges: [] }),
        }
      );
    }
    return { text: "{}" };
  };
}

function harness(opts: { config?: EngineConfig; responder?: (req: CompleteRequest) => FakeCompletion; diceValue?: number; log?: string[] } = {}) {
  const log = opts.log ?? [];
  const config = opts.config ?? makeEngineConfig();
  const client = new FakeAiGmClient({ responder: opts.responder ?? phaseResponder({ log }) });
  const router = new AiGmRouter({ client, config });
  const dice = createDiceService(config.diceRange, loggingDiceSource(opts.diceValue ?? 2, log));
  const coordinator = new AiGmCoordinator({ router, dice, config });
  return { coordinator, client, router, dice, log, config };
}

const playersGen = fc.uniqueArray(fc.hexaString({ minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 6 });

describe("AI GM Router/Coordinator — property tests", async () => {
  it("Property 33: AI requests are routed to their configured model tier", async () => {
    // Feature: trpg-session-engine, Property 33: AI requests are routed to their configured model tier
    const tier = fc.constantFrom<ModelTier>("fast", "standard", "premium");
    const tiersGen = fc.record({ opening: tier, attributes: tier, resolution: tier, ending: tier });
    await fc.assert(
      fc.asyncProperty(tiersGen, async (modelTiers) => {
        const config = makeEngineConfig({ modelTiers });
        const client = new FakeAiGmClient();
        const router = new AiGmRouter({ client, config });
        const types: RequestType[] = ["opening", "attributes", "resolution", "ending"];
        for (const t of types) {
          await router.complete(t, { user: `PHASE: ${t}` });
          expect(client.calls.at(-1)!.tier).toBe(modelTiers[t]);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("Property 22 & 24: dice are server-side and each check records a consistent EZFudge outcome", async () => {
    // Feature: trpg-session-engine, Property 22: Dice are server-side and never AI-sourced
    // Feature: trpg-session-engine, Property 24: Each check is fully recorded and internally consistent
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: -4, max: 4 }), async (diceValue) => {
        const { coordinator } = harness({ diceValue });
        const players = ["p0"];
        const res = await coordinator.resolveRound({
          state: makeState(players),
          scenario: SCENARIO,
          characters: makeCharacters(players),
        });
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.checks).toHaveLength(1);
        const check = res.checks[0];
        // The roll always comes from the Dice_Service (never the AI).
        expect(check.roll).toBe(diceValue);
        // The recorded outcome equals resolveCheck(attribute, difficulty, roll).
        expect(check.outcome).toBe(resolveCheck(ATTRS.Might, "Hard", diceValue));
        expect(check.difficulty).toBe("Hard");
        expect(check.attribute).toBe("Might");
      }),
      { numRuns: 100 },
    );
  });

  it("Property 21: checks are resolved before narration uses their outcomes", async () => {
    // Feature: trpg-session-engine, Property 21: Checks resolved before narration uses their outcomes
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: -4, max: 4 }), async (diceValue) => {
        const log: string[] = [];
        const { coordinator } = harness({ diceValue, log });
        const players = ["p0"];
        const res = await coordinator.resolveRound({
          state: makeState(players),
          scenario: SCENARIO,
          characters: makeCharacters(players),
        });
        expect(res.ok).toBe(true);
        // The dice roll happens after check selection and before narration.
        const dice = log.indexOf("dice");
        const narration = log.indexOf("ai:narration");
        const selection = log.indexOf("ai:check-selection");
        expect(selection).toBeGreaterThanOrEqual(0);
        expect(dice).toBeGreaterThan(selection);
        expect(narration).toBeGreaterThan(dice);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 18: resolution incorporates every player's submission", async () => {
    // Feature: trpg-session-engine, Property 18: Resolution incorporates every player's submission
    await fc.assert(
      fc.asyncProperty(playersGen, async (players) => {
        const { coordinator } = harness();
        const res = await coordinator.resolveRound({
          state: makeState(players),
          scenario: SCENARIO,
          characters: makeCharacters(players),
        });
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        // The narration context contains an action entry for every active player.
        expect(res.context.thisRound.actions).toHaveLength(players.length);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 30: non-Korean narration is withheld, never substituted", async () => {
    // Feature: trpg-session-engine, Property 30: Non-Korean narration is withheld, never substituted
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }).filter((s) => !/[\uac00-\ud7a3]/.test(s)), async (english) => {
        const { coordinator } = harness({
          responder: phaseResponder({
            narration: { text: JSON.stringify({ narration: `English: ${english}`, endingReached: false }) },
          }),
        });
        const players = ["p0"];
        const state = makeState(players);
        const res = await coordinator.resolveRound({ state, scenario: SCENARIO, characters: makeCharacters(players) });
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.error.reason).toBe("non_korean");
        // The round's recorded actions are preserved (only the guard is cleared).
        expect(res.preservedState.readiness).toStrictEqual(state.readiness);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 35: AI retry bound — at most 3 total attempts, stopping on success", async () => {
    // Feature: trpg-session-engine, Property 35: AI retry bound
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 4 }), async (maxRetries) => {
        const config = makeEngineConfig({ aiMaxRetries: maxRetries });
        const maxAttempts = maxRetries + 1;

        // (a) Always-invalid (non-Korean) opening => exactly maxAttempts calls.
        let calls = 0;
        const failClient = new FakeAiGmClient({
          responder: () => {
            calls += 1;
            return { text: JSON.stringify({ narration: "English only, no Hangul." }) };
          },
        });
        const failCo = new AiGmCoordinator({
          router: new AiGmRouter({ client: failClient, config }),
          dice: createDiceService(config.diceRange, () => 2),
          config,
        });
        const failed = await failCo.generateOpening({
          roomId: "room-1",
          roundNumber: 0,
          scenario: SCENARIO,
          characters: [],
          thisRound: { actions: [], checks: [] },
          recentNarrative: [],
        });
        expect(failed.ok).toBe(false);
        expect(calls).toBe(maxAttempts);

        // (b) Immediate success => exactly one call (stops on success).
        let okCalls = 0;
        const okClient = new FakeAiGmClient({
          responder: () => {
            okCalls += 1;
            return { text: JSON.stringify({ narration: "한국어 도입부." }) };
          },
        });
        const okCo = new AiGmCoordinator({
          router: new AiGmRouter({ client: okClient, config }),
          dice: createDiceService(config.diceRange, () => 2),
          config,
        });
        const ok = await okCo.generateOpening({
          roomId: "room-1",
          roundNumber: 0,
          scenario: SCENARIO,
          characters: [],
          thisRound: { actions: [], checks: [] },
          recentNarrative: [],
        });
        expect(ok.ok).toBe(true);
        expect(okCalls).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 36: failed resolution preserves the round's state", async () => {
    // Feature: trpg-session-engine, Property 36: Failed resolution preserves the round's state
    await fc.assert(
      fc.asyncProperty(playersGen, async (players) => {
        // Force failure via non-Korean narration after a valid selection + dice.
        const { coordinator } = harness({
          responder: phaseResponder({ narration: { text: JSON.stringify({ narration: "English only." }) } }),
        });
        const state = makeState(players);
        const res = await coordinator.resolveRound({ state, scenario: SCENARIO, characters: makeCharacters(players) });
        expect(res.ok).toBe(false);
        if (res.ok) return;
        // preservedState equals the input with only resolutionRequested cleared.
        expect(res.preservedState).toStrictEqual({ ...state, resolutionRequested: false });
      }),
      { numRuns: 100 },
    );
  });
});


