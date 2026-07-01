/**
 * Unit tests for the solo-play pure helpers and the `runSoloAct` orchestration.
 *
 * No real CLI / LLM is invoked — `runSoloAct` is exercised with a FAKE
 * coordinator so the session-update logic is tested without Express or the AI.
 */
import { describe, expect, it } from "vitest";
import type { CheckRecord } from "../core/turn-state.js";
import type { Character } from "../services/types.js";
import { MVP_SCENARIO } from "../services/scenario-service.js";
import {
  appendNarrative,
  buildResolvingState,
  countHiddenChecks,
  createSoloSessionStore,
  makeSoloCharacter,
  runSoloAct,
  summarizeChecks,
  type SoloCoordinator,
  type SoloSession,
} from "./solo-play.js";

const CONFIG = { readyCheckTimeoutMs: 90_000 };

function makeCharacter(): Character {
  return makeSoloCharacter(
    { displayName: "테스터", concept: "조심스러운 도둑" },
    { playerId: "p1", characterId: "c1", roomId: "room-1" },
  );
}

function makeSession(): SoloSession {
  return {
    id: "room-1",
    scenario: MVP_SCENARIO,
    character: makeCharacter(),
    narrativeContext: [],
    roundNumber: 1,
    ended: false,
  };
}

describe("makeSoloCharacter", () => {
  it("applies the default attribute spread and confirms the character", () => {
    const character = makeSoloCharacter(
      {},
      { playerId: "p1", characterId: "c1", roomId: "r1" },
    );
    expect(character.attributes).toEqual({ Might: 1, Agility: 1, Wits: 1, Spirit: 1 });
    expect(character.confirmed).toBe(true);
    expect(character.id).toBe("c1");
    expect(character.playerId).toBe("p1");
    expect(character.roomId).toBe("r1");
  });

  it("falls back to Korean defaults for blank name/concept", () => {
    const character = makeSoloCharacter(
      { displayName: "  ", concept: "" },
      { playerId: "p1", characterId: "c1", roomId: "r1" },
    );
    expect(character.name).toBe("모험가");
    expect(character.concept).toBe("용감한 모험가");
  });

  it("uses the supplied name and concept when provided", () => {
    const character = makeSoloCharacter(
      { displayName: "아린", concept: "불의 마법사" },
      { playerId: "p1", characterId: "c1", roomId: "r1" },
    );
    expect(character.name).toBe("아린");
    expect(character.concept).toBe("불의 마법사");
  });
});

describe("buildResolvingState", () => {
  it("produces a resolving Turn_State carrying the confirmed action", () => {
    const session = makeSession();
    session.narrativeContext = [{ round: 1, text: "이전 서사" }];
    session.roundNumber = 3;

    const state = buildResolvingState(session, "무너진 다리를 뛰어넘는다", CONFIG);

    expect(state.roomId).toBe("room-1");
    expect(state.roundNumber).toBe(3);
    expect(state.phase).toBe("resolving");
    expect(state.resolutionRequested).toBe(true);
    expect(state.readyCheckTimeoutMs).toBe(90_000);
    expect(state.readyCheckDeadline).toBeNull();
    expect(state.chatLog).toEqual([]);
    expect(state.checks).toEqual([]);
    expect(state.readiness).toEqual([
      {
        playerId: "p1",
        status: "ready",
        actionKind: "confirmed_action",
        actionText: "무너진 다리를 뛰어넘는다",
      },
    ]);
    // Carries the session's accumulated narrative context.
    expect(state.narrativeContext).toEqual([{ round: 1, text: "이전 서사" }]);
  });
});

describe("appendNarrative", () => {
  it("appends an entry immutably without mutating the input", () => {
    const list = [{ round: 1, text: "a" }];
    const next = appendNarrative(list, 2, "b");
    expect(next).toEqual([
      { round: 1, text: "a" },
      { round: 2, text: "b" },
    ]);
    expect(list).toEqual([{ round: 1, text: "a" }]);
  });

  it("keeps only the most recent `cap` entries (oldest trimmed first)", () => {
    let list: { round: number; text: string }[] = [];
    for (let i = 1; i <= 12; i++) {
      list = appendNarrative(list, i, `n${i}`, 10);
    }
    expect(list).toHaveLength(10);
    expect(list[0]).toEqual({ round: 3, text: "n3" });
    expect(list[9]).toEqual({ round: 12, text: "n12" });
  });
});

describe("summarizeChecks", () => {
  it("maps CheckRecord fields incl. advantage and rolls to the client shape", () => {    const checks: CheckRecord[] = [
      {
        characterId: "c1",
        attribute: "Agility",
        difficulty: "Hard",
        roll: 3,
        outcome: "Success",
        advantage: "advantage",
        rolls: [1, 3],
        visibility: "player",
      },
      {
        characterId: "c1",
        attribute: "Might",
        difficulty: "Easy",
        roll: -1,
        outcome: "Partial Success",
        advantage: "none",
        rolls: [-1],
        visibility: "player",
      },
    ];
    expect(summarizeChecks(checks)).toEqual([
      {
        attribute: "Agility",
        difficulty: "Hard",
        advantage: "advantage",
        rolls: [1, 3],
        roll: 3,
        outcome: "Success",
      },
      {
        attribute: "Might",
        difficulty: "Easy",
        advantage: "none",
        rolls: [-1],
        roll: -1,
        outcome: "Partial Success",
      },
    ]);
  });
});

describe("summarizeChecks — hidden GM rolls", () => {
  it("surfaces only public player checks, hiding GM rolls", () => {
    const checks: CheckRecord[] = [
      { characterId: "c1", attribute: "Agility", difficulty: "Hard", roll: 2, outcome: "Success", advantage: "none", rolls: [2], visibility: "player" },
      { characterId: "c1", attribute: "Wits", difficulty: "Formidable", roll: -1, outcome: "Failure", advantage: "none", rolls: [-1], visibility: "gm" },
    ];
    const summary = summarizeChecks(checks);
    expect(summary).toHaveLength(1);
    expect(summary[0].attribute).toBe("Agility");
  });

  it("counts hidden GM rolls separately from exposed checks", () => {
    const checks: CheckRecord[] = [
      { characterId: "c1", attribute: "Agility", difficulty: "Hard", roll: 2, outcome: "Success", advantage: "none", rolls: [2], visibility: "player" },
      { characterId: "c1", attribute: "Wits", difficulty: "Formidable", roll: -1, outcome: "Failure", advantage: "none", rolls: [-1], visibility: "gm" },
      { characterId: "c1", attribute: "Spirit", difficulty: "Average", roll: 0, outcome: "Partial Success", advantage: "none", rolls: [0], visibility: "gm" },
    ];
    expect(countHiddenChecks(checks)).toBe(2);
    expect(summarizeChecks(checks)).toHaveLength(1);
  });
});

describe("createSoloSessionStore", () => {
  it("creates, gets, and sets sessions keyed by the character roomId", () => {
    const store = createSoloSessionStore();
    const character = makeCharacter();
    const session = store.create(character, MVP_SCENARIO);
    expect(session.id).toBe("room-1");
    expect(session.roundNumber).toBe(1);
    expect(session.ended).toBe(false);
    expect(session.narrativeContext).toEqual([]);
    expect(store.get("room-1")).toBe(session);

    session.roundNumber = 5;
    store.set("room-1", session);
    expect(store.get("room-1")?.roundNumber).toBe(5);
    expect(store.get("missing")).toBeUndefined();
  });
});

describe("runSoloAct", () => {
  it("appends narration, increments the round, and records ending on success", async () => {
    const session = makeSession();
    const fakeChecks: CheckRecord[] = [
      {
        characterId: "c1",
        attribute: "Wits",
        difficulty: "Average",
        roll: 2,
        outcome: "Success",
        advantage: "none",
        rolls: [2],
        visibility: "player",
      },
    ];
    const coordinator: SoloCoordinator = {
      resolveRound: async () => ({
        ok: true,
        checks: fakeChecks,
        narration: "한국어 서술: 당신은 성공했다.",
        endingReached: false,
      }),
    };

    const response = await runSoloAct(session, "문을 연다", coordinator, CONFIG);

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.narration).toBe("한국어 서술: 당신은 성공했다.");
      expect(response.endingReached).toBe(false);
      expect(response.checks).toEqual(summarizeChecks(fakeChecks));
    }
    expect(session.roundNumber).toBe(2);
    expect(session.ended).toBe(false);
    expect(session.narrativeContext).toEqual([
      { round: 1, text: "한국어 서술: 당신은 성공했다." },
    ]);
  });

  it("marks the session ended when the coordinator reports endingReached", async () => {
    const session = makeSession();
    const coordinator: SoloCoordinator = {
      resolveRound: async () => ({
        ok: true,
        checks: [],
        narration: "막을 내린다.",
        endingReached: true,
      }),
    };

    const response = await runSoloAct(session, "탈출한다", coordinator, CONFIG);

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.endingReached).toBe(true);
      expect(response.checks).toEqual([]);
    }
    expect(session.ended).toBe(true);
    expect(session.roundNumber).toBe(2);
  });

  it("exposes only player checks and reports the hidden GM-roll count", async () => {
    const session = makeSession();
    const mixedChecks: CheckRecord[] = [
      { characterId: "c1", attribute: "Wits", difficulty: "Average", roll: 1, outcome: "Success", advantage: "none", rolls: [1], visibility: "player" },
      { characterId: "c1", attribute: "Spirit", difficulty: "Hard", roll: -2, outcome: "Failure", advantage: "none", rolls: [-2], visibility: "gm" },
    ];
    const coordinator: SoloCoordinator = {
      resolveRound: async () => ({
        ok: true,
        checks: mixedChecks,
        narration: "함정이 발동했지만 당신은 봉인을 읽어냈다.",
        endingReached: false,
      }),
    };

    const response = await runSoloAct(session, "봉인을 살펴본다", coordinator, CONFIG);

    expect(response.ok).toBe(true);
    if (response.ok) {
      // Only the public player check is surfaced as a roll.
      expect(response.checks).toHaveLength(1);
      expect(response.checks[0].attribute).toBe("Wits");
      // The hidden GM roll is folded into the narration but counted for debug.
      expect(response.hiddenCount).toBe(1);
    }
  });

  it("supports a no-roll narration (empty checks)", async () => {    const session = makeSession();
    const coordinator: SoloCoordinator = {
      resolveRound: async () => ({
        ok: true,
        checks: [],
        narration: "주변을 둘러본다. 아무 일도 없다.",
        endingReached: false,
      }),
    };

    const response = await runSoloAct(session, "둘러본다", coordinator, CONFIG);
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.checks).toEqual([]);
  });

  it("returns the failure reason/message and leaves the session untouched", async () => {
    const session = makeSession();
    const coordinator: SoloCoordinator = {
      resolveRound: async () => ({
        ok: false,
        error: { reason: "non_korean", message: "모델이 비한국어로 응답함" },
      }),
    };

    const response = await runSoloAct(session, "공격한다", coordinator, CONFIG);

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error).toBe("non_korean");
      expect(response.message).toBe("모델이 비한국어로 응답함");
    }
    // Session is unchanged on failure (retryable).
    expect(session.roundNumber).toBe(1);
    expect(session.ended).toBe(false);
    expect(session.narrativeContext).toEqual([]);
  });
});

