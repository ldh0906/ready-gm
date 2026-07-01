import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  reduce,
  reduceMany,
  createInitialTurnState,
  type Command,
} from "./round-loop.js";
import type { TurnState } from "./turn-state.js";

/**
 * Property-based tests for the round-loop reducer.
 * Feature: trpg-session-engine
 */

/** Unique player ids (host included as first when needed). */
const playersGen = (min: number) =>
  fc.uniqueArray(fc.hexaString({ minLength: 1, maxLength: 6 }), { minLength: min, maxLength: 6 });

/** Start a session with the given active players; host is the first player. */
function start(players: string[]): { state: TurnState; host: string } {
  const host = players[0];
  const state = reduce(createInitialTurnState("room-1"), {
    type: "START_SESSION",
    by: host,
    hostId: host,
    activePlayers: players,
  });
  return { state, host };
}

/** Mark a player ready via confirm (with text) or pass. */
function ready(state: TurnState, player: string, kind: "confirm" | "pass", action = "act"): TurnState {
  return kind === "confirm"
    ? reduce(state, { type: "CONFIRM_ACTION", from: player, action, deadline: null })
    : reduce(state, { type: "PASS", from: player, deadline: null });
}

describe("round-loop reducer — property tests", () => {
  it("Property 10: Turn_State initialization on start", () => {
    // Feature: trpg-session-engine, Property 10: Turn_State initialization on start
    fc.assert(
      fc.property(playersGen(1), (players) => {
        const { state } = start(players);
        expect(state.roundNumber).toBe(1);
        expect(state.phase).toBe("free_chat");
        expect(state.readiness).toHaveLength(players.length);
        expect(state.readiness.every((e) => e.status === "not_ready")).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 11: Free-chat acceptance and attribution", () => {
    // Feature: trpg-session-engine, Property 11: Free-chat acceptance and attribution
    const chatsGen = fc.array(
      fc.record({ pi: fc.nat(), name: fc.fullUnicodeString(), text: fc.fullUnicodeString() }),
      { maxLength: 12 },
    );
    fc.assert(
      fc.property(playersGen(1), chatsGen, (players, chats) => {
        let state = start(players).state;
        const expected: { playerId: string; characterName: string; text: string }[] = [];
        for (const c of chats) {
          const player = players[c.pi % players.length];
          state = reduce(state, {
            type: "SEND_CHAT",
            from: player,
            characterName: c.name,
            text: c.text,
            ts: "2025-01-01T00:00:00.000Z",
          });
          expected.push({ playerId: player, characterName: c.name, text: c.text });
        }
        // A non-member chat is rejected (no-op).
        const before = state.chatLog.length;
        state = reduce(state, {
          type: "SEND_CHAT",
          from: "__ghost__",
          characterName: "G",
          text: "x",
          ts: "2025-01-01T00:00:00.000Z",
        });
        expect(state.chatLog.length).toBe(before);
        // Messages retained in send order and attributed to the sender's character.
        expect(state.chatLog.map((e) => ({ playerId: e.playerId, characterName: e.characterName, text: e.text }))).toStrictEqual(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 12: Readiness recording for confirm and pass", () => {
    // Feature: trpg-session-engine, Property 12: Readiness recording for confirm and pass
    fc.assert(
      fc.property(playersGen(1), fc.nat(), fc.fullUnicodeString(), (players, pi, action) => {
        const { state } = start(players);
        const player = players[pi % players.length];

        const confirmed = reduce(state, { type: "CONFIRM_ACTION", from: player, action, deadline: null });
        const cEntry = confirmed.readiness.find((e) => e.playerId === player)!;
        expect(cEntry.status).toBe("ready");
        expect(cEntry.actionKind).toBe("confirmed_action");
        expect(cEntry.actionText).toBe(action);

        const passed = reduce(state, { type: "PASS", from: player, deadline: null });
        const pEntry = passed.readiness.find((e) => e.playerId === player)!;
        expect(pEntry.status).toBe("ready");
        expect(pEntry.actionKind).toBe("pass");
        expect(pEntry.actionText).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it("Property 13: Resolution gating", () => {
    // Feature: trpg-session-engine, Property 13: Resolution gating
    fc.assert(
      fc.property(playersGen(2), fc.array(fc.boolean(), { minLength: 2, maxLength: 6 }), (players, kinds) => {
        // (a) All active ready => resolving.
        let all = start(players).state;
        for (const p of players) all = ready(all, p, "confirm");
        expect(all.phase).toBe("resolving");
        expect(all.resolutionRequested).toBe(true);

        // (b) At least one not ready (no force) => stays ready_check, not resolving.
        let partial = start(players).state;
        const readyCount = Math.max(1, Math.min(players.length - 1, kinds.filter(Boolean).length));
        for (let i = 0; i < readyCount; i++) partial = ready(partial, players[i], "pass");
        expect(partial.phase).toBe("ready_check");
        expect(partial.resolutionRequested).toBe(false);

        // (c) Host force-proceed with >=1 ready => resolving.
        const forced = reduce(partial, { type: "FORCE_PROCEED", by: players[0], hostId: players[0] });
        expect(forced.phase).toBe("resolving");
        expect(forced.resolutionRequested).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 14: Revision allowed only before resolution; locked during resolution", () => {
    // Feature: trpg-session-engine, Property 14: Revision allowed only before resolution; locked during resolution
    fc.assert(
      fc.property(playersGen(2), fc.fullUnicodeString(), (players, newAction) => {
        // ready_check (not all ready): revise the action -> accepted.
        let rc = start(players).state;
        rc = ready(rc, players[0], "confirm", "old");
        expect(rc.phase).toBe("ready_check");
        const revised = reduce(rc, { type: "REVISE", from: players[0], action: newAction });
        expect(revised.readiness.find((e) => e.playerId === players[0])!.actionText).toBe(newAction);

        // resolving (all ready): revise the action -> rejected (no-op).
        let res = start(players).state;
        for (const p of players) res = ready(res, p, "confirm", "old");
        expect(res.phase).toBe("resolving");
        const locked = reduce(res, { type: "REVISE", from: players[0], action: newAction });
        expect(locked).toStrictEqual(res);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 15: Mid-resolution revert halts and returns to ready-check", () => {
    // Feature: trpg-session-engine, Property 15: Mid-resolution revert halts and returns to ready-check
    fc.assert(
      fc.property(playersGen(2), fc.nat(), (players, pi) => {
        let res = start(players).state;
        for (const p of players) res = ready(res, p, "confirm");
        expect(res.phase).toBe("resolving");
        const player = players[pi % players.length];
        const halted = reduce(res, { type: "REVISE", from: player, action: null });
        expect(halted.phase).toBe("ready_check");
        expect(halted.resolutionRequested).toBe(false);
        expect(halted.readiness.find((e) => e.playerId === player)!.status).toBe("not_ready");
      }),
      { numRuns: 100 },
    );
  });

  it("Property 16: Ready-check timeout produces auto-pass", () => {
    // Feature: trpg-session-engine, Property 16: Ready-check timeout produces auto-pass
    fc.assert(
      fc.property(playersGen(2), (players) => {
        // Open the gate with one confirm; another player times out.
        let state = start(players).state;
        state = ready(state, players[0], "confirm");
        expect(state.phase).toBe("ready_check");
        const victim = players[players.length - 1];
        const after = reduce(state, { type: "TIMEOUT_EXPIRED", player: victim });
        const entry = after.readiness.find((e) => e.playerId === victim)!;
        expect(entry.status).toBe("ready");
        expect(entry.actionKind).toBe("auto_pass");
        // Distinguishable from a manual pass.
        expect(entry.actionKind).not.toBe("pass");
      }),
      { numRuns: 100 },
    );
  });

  it("Property 17: Force-proceed auto-passes all unready players (host only)", () => {
    // Feature: trpg-session-engine, Property 17: Force-proceed auto-passes all unready players (host only)
    fc.assert(
      fc.property(playersGen(2), (players) => {
        const host = players[0];
        // One player ready, the rest unready.
        let state = start(players).state;
        state = ready(state, host, "confirm");

        // Non-host invocation: state unchanged.
        const nonHost = players[players.length - 1];
        if (nonHost !== host) {
          expect(reduce(state, { type: "FORCE_PROCEED", by: nonHost, hostId: host })).toStrictEqual(state);
        }

        // Host invocation: all unready become auto_pass ready; resolves once.
        const forced = reduce(state, { type: "FORCE_PROCEED", by: host, hostId: host });
        expect(forced.phase).toBe("resolving");
        expect(forced.resolutionRequested).toBe(true);
        expect(forced.readiness.every((e) => e.status === "ready")).toBe(true);
        for (const e of forced.readiness) {
          if (e.playerId !== host) expect(e.actionKind).toBe("auto_pass");
        }
        // Re-invoking force-proceed does not re-trigger (at most once).
        expect(reduce(forced, { type: "FORCE_PROCEED", by: host, hostId: host })).toStrictEqual(forced);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 19: At-most-once resolution per round", () => {
    // Feature: trpg-session-engine, Property 19: At-most-once resolution per round
    const triggerGen = fc.array(
      fc.oneof(
        fc.record({ t: fc.constant("confirm" as const), pi: fc.nat() }),
        fc.record({ t: fc.constant("pass" as const), pi: fc.nat() }),
        fc.record({ t: fc.constant("timeout" as const), pi: fc.nat() }),
        fc.record({ t: fc.constant("force" as const), pi: fc.nat() }),
      ),
      { maxLength: 20 },
    );
    fc.assert(
      fc.property(playersGen(2), triggerGen, (players, triggers) => {
        const host = players[0];
        let state = start(players).state;
        let transitions = 0;
        for (const trig of triggers) {
          const p = players[trig.pi % players.length];
          const before = state.resolutionRequested;
          switch (trig.t) {
            case "confirm":
              state = reduce(state, { type: "CONFIRM_ACTION", from: p, action: "a", deadline: null });
              break;
            case "pass":
              state = reduce(state, { type: "PASS", from: p, deadline: null });
              break;
            case "timeout":
              state = reduce(state, { type: "TIMEOUT_EXPIRED", player: p });
              break;
            case "force":
              state = reduce(state, { type: "FORCE_PROCEED", by: host, hostId: host });
              break;
          }
          if (!before && state.resolutionRequested) transitions += 1;
        }
        // Without a RESOLUTION_READY/revert in the sequence, resolution is requested at most once.
        expect(transitions).toBeLessThanOrEqual(1);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 20: Round advancement after delivery", () => {
    // Feature: trpg-session-engine, Property 20: Round advancement after delivery
    fc.assert(
      fc.property(playersGen(1), fc.fullUnicodeString(), (players, narration) => {
        let state = start(players).state;
        for (const p of players) state = ready(state, p, "confirm");
        expect(state.phase).toBe("resolving");
        const advanced = reduce(state, {
          type: "RESOLUTION_READY",
          narration,
          checks: [],
          endingReached: false,
        });
        expect(advanced.roundNumber).toBe(state.roundNumber + 1);
        expect(advanced.phase).toBe("free_chat");
        expect(advanced.resolutionRequested).toBe(false);
        expect(advanced.readiness.every((e) => e.status === "not_ready")).toBe(true);
        // The narration was appended to recent narrative context.
        expect(advanced.narrativeContext.at(-1)).toStrictEqual({ round: state.roundNumber, text: narration });
      }),
      { numRuns: 100 },
    );
  });

  it("Property 29: Concurrent readiness changes all converge", () => {
    // Feature: trpg-session-engine, Property 29: Concurrent readiness changes all converge
    const cmdSpecGen = fc.array(fc.record({ confirm: fc.boolean(), action: fc.fullUnicodeString() }), {
      minLength: 1,
      maxLength: 6,
    });
    fc.assert(
      fc.property(playersGen(2), cmdSpecGen, (players, specs) => {
        // Exactly one readiness command per player, with a CONSTANT deadline so
        // the first-submission deadline is order-independent.
        const n = Math.min(players.length, specs.length);
        const commands: Command[] = [];
        for (let i = 0; i < n; i++) {
          commands.push(
            specs[i].confirm
              ? { type: "CONFIRM_ACTION", from: players[i], action: specs[i].action, deadline: null }
              : { type: "PASS", from: players[i], deadline: null },
          );
        }
        const base = start(players).state;
        const forward = reduceMany(base, commands);
        const reversed = reduceMany(base, [...commands].reverse());
        const rotated = reduceMany(base, [...commands.slice(1), ...commands.slice(0, 1)]);
        // The single-writer reducer converges regardless of interleaving.
        expect(reversed).toStrictEqual(forward);
        expect(rotated).toStrictEqual(forward);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 32: Ended rooms are terminal", () => {
    // Feature: trpg-session-engine, Property 32: Ended rooms are terminal
    const anyCommandGen = (players: string[]) =>
      fc.oneof(
        fc.constant<Command>({ type: "START_SESSION", by: players[0], hostId: players[0], activePlayers: players }),
        fc.constant<Command>({ type: "CONFIRM_ACTION", from: players[0], action: "a", deadline: null }),
        fc.constant<Command>({ type: "PASS", from: players[0], deadline: null }),
        fc.constant<Command>({ type: "TIMEOUT_EXPIRED", player: players[0] }),
        fc.constant<Command>({ type: "FORCE_PROCEED", by: players[0], hostId: players[0] }),
        fc.constant<Command>({ type: "RESOLUTION_READY", narration: "n", checks: [], endingReached: false }),
        fc.constant<Command>({
          type: "SEND_CHAT",
          from: players[0],
          characterName: "C",
          text: "t",
          ts: "2025-01-01T00:00:00.000Z",
        }),
      );
    fc.assert(
      fc.property(
        playersGen(1).chain((players) => fc.tuple(fc.constant(players), fc.array(anyCommandGen(players), { maxLength: 10 }))),
        ([players, commands]) => {
          // Reach an ended state via a resolution with endingReached.
          let state = start(players).state;
          for (const p of players) state = ready(state, p, "confirm");
          const ended = reduce(state, { type: "RESOLUTION_READY", narration: "fin", checks: [], endingReached: true });
          expect(ended.phase).toBe("ended");
          // No command advances or mutates an ended room.
          const after = reduceMany(ended, commands);
          expect(after).toStrictEqual(ended);
          expect(after.roundNumber).toBe(ended.roundNumber);
        },
      ),
      { numRuns: 100 },
    );
  });
});
