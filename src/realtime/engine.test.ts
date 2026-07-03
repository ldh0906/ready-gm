/**
 * Engine composition tests — the fan-out state decorator.
 *
 * The gateway's `decorateState` enriches the Turn_State sent to clients (both
 * broadcast and on-(re)connect resync) with display-only data: readiness roster
 * names and the player-visible character states. These tests drive the wired
 * engine's gateway with a fake connection and assert the delivered payload.
 */
import { describe, expect, it } from "vitest";
import { createEngine } from "./engine.js";
import type { Connection, ServerEvent } from "./connection.js";
import type { AiGmClient } from "../ai/ai-gm-client.js";
import { makeTokenUsage } from "../ai/ai-gm-client.js";
import { makeCharacterState, type VisibleCharacterState } from "../core/character-state.js";
import type { TurnState } from "../core/turn-state.js";

const fakeAiClient: AiGmClient = {
  complete: async () => ({ model: "fake", text: "{}", usage: makeTokenUsage() }),
};

function makeTurnState(roomId: string): TurnState {
  return {
    roomId,
    roundNumber: 1,
    phase: "free_chat",
    readiness: [{ playerId: "p1", status: "not_ready", actionKind: null, actionText: null }],
    actionHistory: [],
    chatLog: [],
    checks: [],
    narrativeContext: [],
    readyCheckDeadline: null,
    readyCheckTimeoutMs: 90_000,
    resolutionRequested: false,
  };
}

/** A fake Connection that records every delivered event. */
function makeConnection(roomId: string, playerId: string) {
  const events: ServerEvent[] = [];
  const connection: Connection = {
    id: `conn-${playerId}`,
    roomId,
    playerId,
    send: (event) => {
      events.push(event);
    },
    close: () => undefined,
    ping: () => undefined,
    onMessage: () => undefined,
    onClose: () => undefined,
  };
  return { connection, events };
}

describe("createEngine — fan-out state decoration", () => {
  function setup() {
    const engine = createEngine({ aiClient: fakeAiClient, env: {} });
    const roomId = "room-1";
    engine.persistence.roomStore.saveRoom({
      id: roomId,
      inviteToken: "invite-1",
      hostPlayerId: "p1",
      scenarioId: null,
      state: "in_session",
      maxPlayers: 6,
      createdAt: new Date().toISOString(),
    });
    engine.persistence.roomStore.savePlayer({
      id: "p1",
      roomId,
      displayName: "라면",
      isHost: true,
      characterId: "c1",
      connectionStatus: "connected",
    });
    engine.persistence.roomStore.saveCharacter({
      id: "c1",
      playerId: "p1",
      roomId,
      name: "고블린 사냥꾼",
      concept: "사냥꾼",
      attributes: { Might: 1, Agility: 1, Wits: 1, Spirit: 1 },
      confirmed: true,
    });
    engine.persistence.turnStateStore.save(makeTurnState(roomId));
    return { engine, roomId };
  }

  it("delivers player-visible character states on (re)connect, excluding GM-only data", () => {
    const { engine, roomId } = setup();
    engine.persistence.characterStateStore.save(roomId, [
      makeCharacterState({
        characterId: "c1",
        conditions: [{ name: "부상", severity: 2, reason: "낙석" }],
        resources: { 기력: 3 },
        memories: [{ text: "GM만 아는 비밀", salience: 5, reason: "은닉" }],
        flags: { marked: true },
      }),
    ]);

    const { connection, events } = makeConnection(roomId, "p1");
    engine.gateway.connect(connection);

    const turnStateEvent = events.find((event) => event.type === "turn_state");
    expect(turnStateEvent).toBeDefined();
    const state = (turnStateEvent as { state: TurnState }).state;
    const visible = state.characterStates as VisibleCharacterState[];
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      characterId: "c1",
      name: "고블린 사냥꾼",
      conditions: [{ name: "부상", severity: 2 }],
      resources: { 기력: 3 },
    });
    // GM-only material never reaches the fan-out payload.
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain("비밀");
    expect(serialized).not.toContain("memories");
    expect(serialized).not.toContain("flags");
    // Roster decoration still applies alongside the character states.
    expect(state.readiness[0]).toMatchObject({ characterName: "고블린 사냥꾼", displayName: "라면" });
  });

  it("omits the characterStates key when the room has no character state", () => {
    const { engine, roomId } = setup();
    const { connection, events } = makeConnection(roomId, "p1");
    engine.gateway.connect(connection);

    const turnStateEvent = events.find((event) => event.type === "turn_state");
    expect(turnStateEvent).toBeDefined();
    const state = (turnStateEvent as { state: TurnState }).state;
    expect("characterStates" in state).toBe(false);
  });

  it("decorates actionHistory entries with character and display names", () => {
    const { engine, roomId } = setup();
    engine.persistence.turnStateStore.save({
      ...makeTurnState(roomId),
      readiness: [],
      actionHistory: [
        { round: 1, playerId: "p1", kind: "confirmed_action", text: "파이를 엎는다" },
      ],
    });

    const { connection, events } = makeConnection(roomId, "p1");
    engine.gateway.connect(connection);

    const turnStateEvent = events.find((event) => event.type === "turn_state");
    expect(turnStateEvent).toBeDefined();
    const state = (turnStateEvent as { state: TurnState }).state;
    expect(state.actionHistory[0]).toMatchObject({
      characterName: "고블린 사냥꾼",
      displayName: "라면",
    });
  });
});
