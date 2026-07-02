// @ts-nocheck
/**
 * Property-based tests for Game_Play_App session-end detection
 * and its effect on input visibility.
 * Feature: game-play
 *
 * Covers:
 * - Property 11: 세션 종료 감지는 입력을 비활성화한다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  detectSessionEnded,
  reduce,
  createInitialState,
  computeVisibility,
  ConnectionStatus,
  Phase,
  NarrationKind,
} from "./logic.js";

const validHandoff = { roomId: "r1", hostPlayerId: "h1", token: "t1" };

describe("game-play property tests — session end", () => {
  it("Property 11: 세션 종료 감지는 입력을 비활성화한다", () => {
    // Feature: game-play, Property 11: 세션 종료 감지는 입력을 비활성화한다
    const phaseGen = fc.oneof(
      fc.constantFrom(Phase.FREE_CHAT, Phase.READY_CHECK, Phase.RESOLVING, Phase.ROLLING, Phase.ENDED),
      fc.string(),
      fc.constant(undefined),
    );
    const narrationKindGen = fc.oneof(
      fc.constantFrom(NarrationKind.OPENING, NarrationKind.RESOLUTION, NarrationKind.CLOSING),
      fc.string(),
      fc.constant(undefined),
    );

    fc.assert(
      fc.property(phaseGen, narrationKindGen, (phase, narrationKind) => {
        const expected = phase === Phase.ENDED || narrationKind === NarrationKind.CLOSING;
        expect(detectSessionEnded({ phase, narrationKind })).toBe(expected);

        if (expected) {
          // 평소라면 입력이 활성인 상태(연결됨·turn 수신·유효 인계·free_chat·오프닝 도착)에서 출발.
          const base = {
            ...createInitialState(validHandoff),
            connection: ConnectionStatus.OPEN,
            turnReceived: true,
            phase: Phase.FREE_CHAT,
            // 오프닝 서사가 이미 도착했다고 보고(오프닝 대기 잠금 해제) 평소 활성 상태를 만든다.
            narrationEntries: [{ kind: NarrationKind.OPENING, roundNumber: 1, text: "시작" }],
          };
          expect(computeVisibility(base).inputDisabled).toBe(false);

          // 종료 트리거를 reduce하면 ended가 되고 입력이 비활성으로 보고된다.
          const ended =
            narrationKind === NarrationKind.CLOSING
              ? reduce(base, { type: "NARRATION", kind: NarrationKind.CLOSING, roundNumber: 1, text: "끝" })
              : reduce(base, { type: "TURN_STATE", state: { phase: Phase.ENDED } });

          expect(ended.ended).toBe(true);
          expect(computeVisibility(ended).inputDisabled).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
