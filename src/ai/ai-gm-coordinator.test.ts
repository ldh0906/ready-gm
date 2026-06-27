import { describe, it, expect } from "vitest";
import { makeEngineConfig } from "../core/config.js";
import { createDiceService, type UniformIntSource } from "../core/dice.js";
import { resolveCheck } from "../core/ezfudge.js";
import type { AttributeKey, AttributeLevel, EngineConfig } from "../core/types.js";
import type { TurnState } from "../core/turn-state.js";
import { InMemoryEventSink } from "../observability/event-sink.js";
import type { AiOutputEvent, StateMutationEvent } from "../observability/events.js";
import type { ContextScenario } from "../services/turn-state-context.js";
import type { Character } from "../services/types.js";
import { FakeAiGmClient, type CompleteRequest, type FakeCompletion } from "./ai-gm-client.js";
import { AiGmRouter } from "./ai-gm-router.js";
import {
  AiGmCoordinator,
  containsHangul,
  type LanguageDetector,
} from "./ai-gm-coordinator.js";

// --- Fixtures ---------------------------------------------------------------

const SCENARIO: ContextScenario = {
  title: "태양 없는 지하실",
  summary: "사라진 아이들을 찾아 지하 묘지로 내려간다.",
  openingSeed: "황혼의 마을, 차가운 묘지의 계단.",
  endingCondition: "아이들을 데리고 묘지를 탈출하거나, 묘지에 갇힌다.",
};

const ATTRS: Record<AttributeKey, AttributeLevel> = {
  Might: 1,
  Agility: 0,
  Wits: 2,
  Spirit: -1,
};

function makeCharacter(playerId: string, name: string): Character {
  return {
    id: `char-${playerId}`,
    playerId,
    roomId: "room-1",
    name,
    concept: "용감한 모험가",
    attributes: { ...ATTRS },
    confirmed: true,
  };
}

function makeState(playerIds: readonly string[], overrides: Partial<TurnState> = {}): TurnState {
  return {
    roomId: "room-1",
    roundNumber: 2,
    phase: "resolving",
    readiness: playerIds.map((playerId) => ({
      playerId,
      status: "ready" as const,
      actionKind: "confirmed_action" as const,
      actionText: `${playerId}의 행동`,
    })),
    chatLog: [],
    checks: [],
    narrativeContext: [],
    readyCheckDeadline: null,
    readyCheckTimeoutMs: 90000,
    resolutionRequested: true,
    ...overrides,
  };
}

/** A dice source over [min, maxExclusive) that always returns `value` and logs. */
function loggingDiceSource(value: number, log?: string[]): UniformIntSource {
  return () => {
    log?.push("dice");
    return value;
  };
}

interface ResponderConfig {
  log?: string[];
  /** Override the narration-phase completion (e.g. to force non-Korean). */
  narration?: FakeCompletion;
  /** Override the opening-phase completion. */
  opening?: FakeCompletion;
  /** Override the check-selection completion. */
  checkSelection?: FakeCompletion;
}

/** A deterministic responder branching on the PHASE marker in the prompt. */
function phaseResponder(cfg: ResponderConfig = {}) {
  return (req: CompleteRequest): FakeCompletion => {
    const u = req.prompt.user;
    if (u.includes("PHASE: opening")) {
      cfg.log?.push("ai:opening");
      return cfg.opening ?? { text: JSON.stringify({ narration: "한국어 도입부 서사입니다." }) };
    }
    if (u.includes("PHASE: attributes")) {
      cfg.log?.push("ai:attributes");
      return { text: JSON.stringify({ attributes: { Might: 2, Agility: 1, Wits: 0, Spirit: -1 } }) };
    }
    if (u.includes("PHASE: check-selection")) {
      cfg.log?.push("ai:check-selection");
      return (
        cfg.checkSelection ?? {
          text: JSON.stringify({
            checks: [{ characterName: "보린", attribute: "Might", difficulty: "Hard" }],
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
    if (u.includes("PHASE: ending")) {
      cfg.log?.push("ai:ending");
      return { text: JSON.stringify({ closing: "한국어 결말 서사.", summary: "한국어 요약." }) };
    }
    return { text: "{}" };
  };
}

interface HarnessOptions {
  config?: EngineConfig;
  responder?: (req: CompleteRequest) => FakeCompletion;
  diceValue?: number;
  diceSource?: UniformIntSource;
  detectKorean?: LanguageDetector;
  sink?: InMemoryEventSink;
  log?: string[];
}

function makeHarness(options: HarnessOptions = {}) {
  const config = options.config ?? makeEngineConfig();
  const client = new FakeAiGmClient({ responder: options.responder ?? phaseResponder() });
  const router = new AiGmRouter({ client, config });
  const source = options.diceSource ?? loggingDiceSource(options.diceValue ?? 2, options.log);
  const dice = createDiceService(config.diceRange, source);
  const coordinator = new AiGmCoordinator({
    router,
    dice,
    config,
    correlation: { sessionId: "room-1", roundNo: 2 },
    ...(options.sink ? { sink: options.sink } : {}),
    ...(options.detectKorean ? { detectKorean: options.detectKorean } : {}),
  });
  return { config, client, router, dice, coordinator };
}

// --- containsHangul heuristic ----------------------------------------------

describe("containsHangul default detector", () => {
  it("accepts Korean text and rejects non-Korean text", () => {
    expect(containsHangul("안녕하세요 모험가 여러분")).toBe(true);
    expect(containsHangul("The crypt is dark and cold.")).toBe(false);
    expect(containsHangul("")).toBe(false);
  });

  it("accepts Korean narration that embeds a foreign term (R14.3)", () => {
    expect(containsHangul("당신은 EZFudge 판정을 시도한다.")).toBe(true);
  });
});

// --- resolveRound: ordering, dice authority, every-player entry ------------

describe("AiGmCoordinator.resolveRound", () => {
  it("resolves checks (dice + EZFudge) before requesting narration", async () => {
    const log: string[] = [];
    const { coordinator, client } = makeHarness({ responder: phaseResponder({ log }), log });

    const result = await coordinator.resolveRound({
      state: makeState(["p1"]),
      scenario: SCENARIO,
      characters: [makeCharacter("p1", "보린")],
    });

    expect(result.ok).toBe(true);
    // Ordering: check-selection AI call, THEN dice, THEN narration AI call.
    expect(log).toEqual(["ai:check-selection", "dice", "ai:narration"]);
    // The narration prompt was given the already-resolved outcomes.
    const narrationCall = client.calls.find((c) => c.prompt.user.includes("PHASE: narration"));
    expect(narrationCall?.prompt.user).toContain("RESOLVED_CHECKS");
    expect(narrationCall?.prompt.user).toContain("\"outcome\"");
  });

  it("always sources the roll from the Dice_Service, never from the AI", async () => {
    // AI tries to smuggle a roll value; the coordinator must ignore it.
    const checkSelection = {
      text: JSON.stringify({
        checks: [{ characterName: "보린", attribute: "Wits", difficulty: "Average", roll: 999 }],
        stateChanges: [],
      }),
    };
    const { coordinator } = makeHarness({
      diceValue: 3,
      responder: phaseResponder({ checkSelection }),
    });

    const result = await coordinator.resolveRound({
      state: makeState(["p1"]),
      scenario: SCENARIO,
      characters: [makeCharacter("p1", "보린")],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.checks).toHaveLength(1);
    // Roll is the dice value (3), NOT the AI-provided 999.
    expect(result.checks[0]?.roll).toBe(3);
    // Outcome is computed by EZFudge from the server roll.
    expect(result.checks[0]?.outcome).toBe(resolveCheck(ATTRS.Wits, "Average", 3));
  });

  it("builds context with an action entry for every active player (R10.1)", async () => {
    const { coordinator } = makeHarness();
    const players = ["p1", "p2", "p3"];

    const result = await coordinator.resolveRound({
      state: makeState(players),
      scenario: SCENARIO,
      characters: [
        makeCharacter("p1", "보린"),
        makeCharacter("p2", "아리아"),
        makeCharacter("p3", "카라"),
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.thisRound.actions).toHaveLength(players.length);
    expect(result.context.thisRound.actions.map((a) => a.characterName)).toEqual([
      "보린",
      "아리아",
      "카라",
    ]);
  });

  it("drops hallucinated checks for unknown characters from the applied diff", async () => {
    const checkSelection = {
      text: JSON.stringify({
        checks: [
          { characterName: "보린", attribute: "Might", difficulty: "Hard" },
          { characterName: "유령", attribute: "Might", difficulty: "Hard" },
        ],
        stateChanges: [],
      }),
    };
    const sink = new InMemoryEventSink();
    const { coordinator } = makeHarness({
      responder: phaseResponder({ checkSelection }),
      sink,
    });

    const result = await coordinator.resolveRound({
      state: makeState(["p1"]),
      scenario: SCENARIO,
      characters: [makeCharacter("p1", "보린")],
    });
    await sink.flush();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only the real character's check is applied; the hallucinated one is dropped.
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]?.characterId).toBe("보린");

    const mutation = sink
      .queryByRound("room-1", 2)
      .find((e) => e.eventType === "state_mutation") as StateMutationEvent | undefined;
    expect(mutation).toBeDefined();
    const proposed = mutation?.proposedDiff as { checks: unknown[] };
    const applied = mutation?.appliedDiff as { checks: unknown[] };
    expect(proposed.checks).toHaveLength(2); // AI proposed both
    expect(applied.checks).toHaveLength(1); // engine applied one
  });

  it("withholds resolution when the Dice_Service fails", async () => {
    const failingSource: UniformIntSource = () => {
      throw new Error("rng offline");
    };
    const { coordinator } = makeHarness({ diceSource: failingSource });

    const result = await coordinator.resolveRound({
      state: makeState(["p1"]),
      scenario: SCENARIO,
      characters: [makeCharacter("p1", "보린")],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("dice_failed");
  });
});

// --- Korean validation + withholding ---------------------------------------

describe("AiGmCoordinator Korean validation", () => {
  it("withholds non-Korean narration and reports failure (never substitutes)", async () => {
    const { coordinator } = makeHarness({
      responder: phaseResponder({
        narration: { text: JSON.stringify({ narration: "The crypt is silent.", endingReached: false }) },
      }),
    });

    const result = await coordinator.resolveRound({
      state: makeState(["p1"]),
      scenario: SCENARIO,
      characters: [makeCharacter("p1", "보린")],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("non_korean");
    // No narration is fabricated/substituted on the failure result.
    expect(result).not.toHaveProperty("narration");
  });

  it("uses the injected detector to decide language (boundary control)", async () => {
    // Detector that rejects everything → even Korean text is withheld.
    const rejectAll: LanguageDetector = () => false;
    const result = await makeHarness({ detectKorean: rejectAll }).coordinator.generateOpening({
      roomId: "room-1",
      roundNumber: 0,
      scenario: SCENARIO,
      characters: [],
      thisRound: { actions: [], checks: [] },
      recentNarrative: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("non_korean");
  });
});

// --- Retry policy -----------------------------------------------------------

describe("AiGmCoordinator retry policy", () => {
  it("retries up to 2 additional times (3 total) then reports failure", async () => {
    const client = new FakeAiGmClient({
      responder: () => ({ text: JSON.stringify({ narration: "always english" }) }),
    });
    const config = makeEngineConfig();
    const router = new AiGmRouter({ client, config });
    const dice = createDiceService(config.diceRange, loggingDiceSource(0));
    const coordinator = new AiGmCoordinator({ router, dice, config });

    const result = await coordinator.generateOpening({
      roomId: "room-1",
      roundNumber: 0,
      scenario: SCENARIO,
      characters: [],
      thisRound: { actions: [], checks: [] },
      recentNarrative: [],
    });

    expect(result.ok).toBe(false);
    expect(client.calls).toHaveLength(3); // 1 + aiMaxRetries(2)
  });

  it("stops immediately on the first successful attempt", async () => {
    let attempt = 0;
    const client = new FakeAiGmClient({
      responder: () => {
        attempt += 1;
        return attempt === 1
          ? { text: JSON.stringify({ narration: "english first" }) }
          : { text: JSON.stringify({ narration: "한국어 도입부." }) };
      },
    });
    const config = makeEngineConfig();
    const router = new AiGmRouter({ client, config });
    const dice = createDiceService(config.diceRange, loggingDiceSource(0));
    const coordinator = new AiGmCoordinator({ router, dice, config });

    const result = await coordinator.generateOpening({
      roomId: "room-1",
      roundNumber: 0,
      scenario: SCENARIO,
      characters: [],
      thisRound: { actions: [], checks: [] },
      recentNarrative: [],
    });

    expect(result.ok).toBe(true);
    expect(client.calls).toHaveLength(2); // failed once, succeeded on retry
  });

  it("retries when the underlying AI request throws", async () => {
    let calls = 0;
    const throwingClient = {
      calls: [] as CompleteRequest[],
      complete() {
        calls += 1;
        return Promise.reject(new Error("provider down"));
      },
    };
    const config = makeEngineConfig();
    const router = new AiGmRouter({ client: throwingClient, config });
    const dice = createDiceService(config.diceRange, loggingDiceSource(0));
    const coordinator = new AiGmCoordinator({ router, dice, config });

    const result = await coordinator.generateOpening({
      roomId: "room-1",
      roundNumber: 0,
      scenario: SCENARIO,
      characters: [],
      thisRound: { actions: [], checks: [] },
      recentNarrative: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("ai_request_failed");
    expect(calls).toBe(3);
  });
});

// --- Failed-resolution state preservation ----------------------------------

describe("AiGmCoordinator failed-resolution state preservation", () => {
  it("leaves the caller's Turn_State unchanged and clears resolutionRequested", async () => {
    const { coordinator } = makeHarness({
      responder: phaseResponder({
        narration: { text: JSON.stringify({ narration: "english narration" }) },
      }),
    });

    const state = makeState(["p1", "p2"], { resolutionRequested: true });
    const snapshot = JSON.parse(JSON.stringify(state)) as TurnState;

    const result = await coordinator.resolveRound({
      state,
      scenario: SCENARIO,
      characters: [makeCharacter("p1", "보린"), makeCharacter("p2", "아리아")],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The original state object was not mutated at all (actions/passes intact).
    expect(state).toEqual(snapshot);
    // The preserved state keeps recorded actions but clears the resolution guard.
    expect(result.preservedState.readiness).toEqual(snapshot.readiness);
    expect(result.preservedState.resolutionRequested).toBe(false);
  });
});

// --- Generation methods (opening / attributes / ending) --------------------

describe("AiGmCoordinator generation methods", () => {
  it("generateOpening returns Korean narration", async () => {
    const { coordinator } = makeHarness();
    const result = await coordinator.generateOpening({
      roomId: "room-1",
      roundNumber: 0,
      scenario: SCENARIO,
      characters: [],
      thisRound: { actions: [], checks: [] },
      recentNarrative: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(containsHangul(result.value)).toBe(true);
  });

  it("proposeAttributes returns a complete attribute set", async () => {
    const { coordinator } = makeHarness();
    const result = await coordinator.proposeAttributes("불 같은 전사", SCENARIO);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value).sort()).toEqual(["Agility", "Might", "Spirit", "Wits"]);
    for (const key of ["Might", "Agility", "Wits", "Spirit"] as AttributeKey[]) {
      expect(typeof result.value[key]).toBe("number");
    }
  });

  it("proposeAttributes rejects an incomplete attribute set", async () => {
    const { coordinator } = makeHarness({
      responder: () => ({ text: JSON.stringify({ attributes: { Might: 1, Agility: 0 } }) }),
    });
    const result = await coordinator.proposeAttributes("불완전한 개념", SCENARIO);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("invalid_schema");
  });

  it("generateEnding returns Korean closing narration and a session summary", async () => {
    const { coordinator } = makeHarness();
    const result = await coordinator.generateEnding({
      roomId: "room-1",
      roundNumber: 5,
      scenario: SCENARIO,
      characters: [],
      thisRound: { actions: [], checks: [] },
      recentNarrative: [{ round: 4, text: "이전 라운드 서사." }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(containsHangul(result.value.closing)).toBe(true);
    expect(containsHangul(result.value.summary.text)).toBe(true);
  });
});

// --- ai_output QA event -----------------------------------------------------

describe("AiGmCoordinator ai_output QA event", () => {
  it("captures raw output and a passing validation result on success", async () => {
    const sink = new InMemoryEventSink();
    const { coordinator } = makeHarness({ sink });

    await coordinator.generateOpening({
      roomId: "room-1",
      roundNumber: 2,
      scenario: SCENARIO,
      characters: [],
      thisRound: { actions: [], checks: [] },
      recentNarrative: [],
    });
    await sink.flush();

    const outputs = sink
      .queryByRound("room-1", 2)
      .filter((e) => e.eventType === "ai_output") as AiOutputEvent[];
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.validationPassed).toBe(true);
    expect(outputs[0]?.rawOutput).toContain("narration");
    expect(outputs[0]?.failureReason).toBeUndefined();
  });

  it("captures the raw output and failure reason for each failed attempt", async () => {
    const sink = new InMemoryEventSink();
    const { coordinator } = makeHarness({
      sink,
      responder: () => ({ text: JSON.stringify({ narration: "english only" }) }),
    });

    await coordinator.generateOpening({
      roomId: "room-1",
      roundNumber: 2,
      scenario: SCENARIO,
      characters: [],
      thisRound: { actions: [], checks: [] },
      recentNarrative: [],
    });
    await sink.flush();

    const outputs = sink
      .queryByRound("room-1", 2)
      .filter((e) => e.eventType === "ai_output") as AiOutputEvent[];
    // One ai_output per attempt (3 total).
    expect(outputs).toHaveLength(3);
    expect(outputs.every((e) => e.validationPassed === false)).toBe(true);
    expect(outputs.every((e) => typeof e.failureReason === "string")).toBe(true);
  });
});
