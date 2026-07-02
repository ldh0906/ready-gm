// @ts-nocheck
/**
 * Property-based tests for Game_Play_App ServerEvent → Action reduction.
 * Feature: game-play
 *
 * Covers:
 * - Property 3: 실시간 이벤트는 액션으로 정확히 환원된다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { eventToAction } from "./logic.js";

const anyJson = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.record({ a: fc.string(), b: fc.integer() }),
);

describe("game-play property tests — eventToAction", () => {
  it("Property 3: 실시간 이벤트는 액션으로 정확히 환원된다", () => {
    // Feature: game-play, Property 3: 실시간 이벤트는 액션으로 정확히 환원된다
    const turnStateEvt = fc.record({ state: anyJson }).map((p) => ({
      event: { type: "turn_state", state: p.state },
      expected: { type: "TURN_STATE", state: p.state },
    }));

    const chatEvt = fc.record({ message: anyJson }).map((p) => ({
      event: { type: "chat_message", message: p.message },
      expected: { type: "CHAT_MESSAGE", message: p.message },
    }));

    const narrationEvt = fc
      .record({
        kind: fc.constantFrom("opening", "resolution", "closing"),
        roundNumber: fc.integer(),
        text: fc.fullUnicodeString(),
      })
      .map((n) => ({
        event: { type: "narration", narration: { kind: n.kind, roundNumber: n.roundNumber, text: n.text } },
        expected: { type: "NARRATION", kind: n.kind, roundNumber: n.roundNumber, text: n.text },
      }));

    const readinessEvt = fc.record({ readiness: fc.array(anyJson) }).map((p) => ({
      event: { type: "readiness_updated", readiness: p.readiness },
      expected: { type: "READINESS_UPDATED", readiness: p.readiness },
    }));

    const scenarioEvt = fc
      .record({ scenarioId: fc.string(), title: fc.string(), summary: fc.string() })
      .map((p) => ({
        event: { type: "scenario_set", scenarioId: p.scenarioId, title: p.title, summary: p.summary },
        expected: { type: "SCENARIO_SET", scenarioId: p.scenarioId, title: p.title, summary: p.summary },
      }));

    const deliveryEvt = fc.record({ failedType: fc.string(), detail: fc.string() }).map((p) => ({
      event: { type: "delivery_failed", failedType: p.failedType, detail: p.detail },
      expected: { type: "DELIVERY_FAILED", failedType: p.failedType, detail: p.detail },
    }));

    const checksPendingEvt = fc.record({ checks: fc.array(anyJson) }).map((p) => ({
      event: { type: "checks_pending", checks: p.checks },
      expected: { type: "CHECKS_PENDING", checks: p.checks },
    }));

    const checkRolledEvt = fc.record({ check: anyJson }).map((p) => ({
      event: { type: "check_rolled", check: p.check },
      expected: { type: "CHECK_ROLLED", check: p.check },
    }));

    const connOpenEvt = fc.constant({
      event: { type: "connection-open" },
      expected: { type: "CONNECTION_OPENED" },
    });
    const connLostEvt = fc.constant({
      event: { type: "connection-lost" },
      expected: { type: "CONNECTION_LOST" },
    });

    // player_list_updated와 알 수 없는 type은 null(게임 화면 무시).
    const ignoredEvt = fc
      .oneof(
        fc.record({ type: fc.constant("player_list_updated"), players: fc.array(anyJson) }),
        fc.record({ type: fc.string().filter((t) => ![
          "turn_state",
          "chat_message",
          "narration",
          "readiness_updated",
          "scenario_set",
          "delivery_failed",
          "checks_pending",
          "check_rolled",
          "connection-open",
          "connection-lost",
          "player_list_updated",
        ].includes(t)) }),
      )
      .map((event) => ({ event, expected: null }));

    const caseGen = fc.oneof(
      turnStateEvt,
      chatEvt,
      narrationEvt,
      readinessEvt,
      scenarioEvt,
      deliveryEvt,
      checksPendingEvt,
      checkRolledEvt,
      connOpenEvt,
      connLostEvt,
      ignoredEvt,
    );

    fc.assert(
      fc.property(caseGen, ({ event, expected }) => {
        expect(eventToAction(event)).toStrictEqual(expected);
      }),
      { numRuns: 100 },
    );
  });
});
