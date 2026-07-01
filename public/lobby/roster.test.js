// @ts-nocheck
/**
 * Property-based tests for Room_Lobby_App roster replacement/rendering and
 * the session-start enable predicate.
 * Feature: room-lobby
 *
 * Covers:
 * - Property 10: 로스터 교체와 인원·정원 표시
 * - Property 11: 세션 시작 활성 술어
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  reduce,
  renderRoster,
  computeStartEnabled,
  createInitialState,
  ConnectionStatus,
  ROSTER_EMPTY_MESSAGE,
} from "./logic.js";

const validHandoff = { roomId: "r1", hostPlayerId: "h1", token: "" };

// 동일한 HTML 이스케이프(logic.js의 esc()와 일치).
const esc = (v) =>
  String(v).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// 비-ASCII·이모지·특수문자(&<>)를 포함하는 displayName.
const nameGen = fc.oneof(
  fc.string(),
  fc.fullUnicodeString(),
  fc.constantFrom("a&b", "<tag>", "x>y", "호스트님", "😀플레이어", "O'Reilly & <Co>"),
);
const playerGen = fc.record({
  id: fc.string(),
  displayName: nameGen,
  isHost: fc.boolean(),
});
const rosterGen = fc.array(playerGen, { maxLength: 6 });

describe("room-lobby property tests — roster", () => {
  it("Property 10: 로스터 교체와 인원·정원 표시", () => {
    // Feature: room-lobby, Property 10: 로스터 교체와 인원·정원 표시
    const maxPlayersGen = fc.oneof(
      fc.integer({ min: 0, max: 99 }),
      fc.constant(null),
      fc.constant(undefined),
      fc.double({ min: 1.1, max: 50, noNaN: true, noDefaultInfinity: true }).filter((n) => !Number.isInteger(n)),
    );

    fc.assert(
      fc.property(rosterGen, rosterGen, maxPlayersGen, (prior, players, maxPlayers) => {
        // PLAYER_LIST_UPDATED는 로스터를 이벤트 목록으로 완전 교체한다.
        const state = { ...createInitialState(validHandoff), roster: prior };
        const next = reduce(state, { type: "PLAYER_LIST_UPDATED", players });
        expect(next.roster).toEqual(players);

        const markup = renderRoster(next.roster, maxPlayers);
        const count = players.length;
        const maxText =
          typeof maxPlayers === "number" && Number.isInteger(maxPlayers) ? String(maxPlayers) : "?";
        // 현재 인원 수와 정원 표시를 포함한다.
        expect(markup).toContain(`현재 인원: ${count} / ${maxText}명`);

        if (count === 0) {
          // 빈 목록 안내.
          expect(markup).toContain(ROSTER_EMPTY_MESSAGE);
        } else {
          // 모든 displayName이 이스케이프되어 포함된다.
          for (const p of players) {
            expect(markup).toContain(esc(p.displayName));
          }
          // 호스트가 있으면 호스트 표시가 포함된다.
          if (players.some((p) => p.isHost)) {
            expect(markup).toContain("(호스트)");
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("Property 11: 세션 시작 활성 술어", () => {
    // Feature: room-lobby, Property 11: 세션 시작 활성 술어
    const connectionGen = fc.constantFrom(
      ConnectionStatus.CONNECTING,
      ConnectionStatus.OPEN,
      ConnectionStatus.DISCONNECTED,
    );
    const selectedScenarioGen = fc.record({
      scenarioId: fc.oneof(fc.constant(null), fc.constant(""), fc.string({ minLength: 1 })),
      title: fc.oneof(fc.constant(null), fc.constant(""), fc.string({ minLength: 1 })),
      summary: fc.oneof(fc.constant(null), fc.string()),
    });

    fc.assert(
      fc.property(connectionGen, selectedScenarioGen, rosterGen, (connection, sel, roster) => {
        const state = {
          ...createInitialState(validHandoff),
          connection,
          selectedScenario: sel,
          roster,
        };
        const isNonEmpty = (v) => typeof v === "string" && v.length > 0;
        const expected =
          connection === ConnectionStatus.OPEN &&
          (isNonEmpty(sel.scenarioId) || isNonEmpty(sel.title)) &&
          roster.length >= 1;
        expect(computeStartEnabled(state)).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });
});
