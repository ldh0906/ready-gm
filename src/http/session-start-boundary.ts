import type { AiCostGuard } from "./ai-cost-guard.js";
import type { OrchestratorCommand } from "../realtime/room-orchestrator.js";
import type { RoomRepository } from "../persistence/types.js";
import type { Room } from "../services/types.js";

export interface SessionStartCharacterGate {
  canStart(roomId: string): boolean;
}

export interface SessionStartRoomStore {
  getRoom(roomId: string): Room | undefined;
  saveRoom(room: Room): void;
}

export interface SessionStartOrchestrator {
  dispatch(roomId: string, command: OrchestratorCommand): Promise<void>;
}

export interface StartMultiplayerSessionOptions {
  roomId: string;
  characterGate: SessionStartCharacterGate;
  roomStore: SessionStartRoomStore;
  durableRoomRepository?: Pick<
    RoomRepository,
    "getRoom" | "markRoomInSessionIfLobby" | "saveRoom"
  >;
  startedRooms: Set<string>;
  aiGuard: Pick<AiCostGuard, "acquire">;
  orchestrator: SessionStartOrchestrator;
  broadcastToRoom(roomId: string, payload: unknown): void;
  logFailure?(message: string): void;
}

export interface StartMultiplayerSessionOutcome {
  started: boolean;
  reason?: string;
}

export async function startMultiplayerSession(
  options: StartMultiplayerSessionOptions,
): Promise<StartMultiplayerSessionOutcome> {
  const {
    roomId,
    characterGate,
    roomStore,
    durableRoomRepository,
    startedRooms,
    aiGuard,
    orchestrator,
    broadcastToRoom,
    logFailure,
  } = options;

  if (!characterGate.canStart(roomId)) return { started: false, reason: "NOT_ALL_CONFIRMED" };
  if (startedRooms.has(roomId)) {
    if (durableRoomRepository === undefined) return { started: true };
    const durableRoom = await durableRoomRepository.getRoom(roomId);
    return durableRoom?.state === "in_session"
      ? { started: true }
      : { started: false, reason: durableRoom === undefined ? "UNKNOWN_ROOM" : "NOT_LOBBY" };
  }

  const room = roomStore.getRoom(roomId);
  if (room === undefined) return { started: false, reason: "UNKNOWN_ROOM" };
  if (room.state !== "lobby") {
    return room.state === "in_session"
      ? { started: true }
      : { started: false, reason: "NOT_LOBBY" };
  }

  const acquired = aiGuard.acquire({ roomId, playerId: room.hostPlayerId });
  if (!acquired.ok) {
    return {
      started: false,
      reason: acquired.reason === "SESSION_CAPACITY" ? "AT_CAPACITY" : acquired.reason,
    };
  }

  if (durableRoomRepository !== undefined) {
    const changed = await durableRoomRepository.markRoomInSessionIfLobby(roomId);
    if (!changed) {
      acquired.release();
      const durableRoom = await durableRoomRepository.getRoom(roomId);
      if (durableRoom?.state === "in_session") {
        startedRooms.add(roomId);
        roomStore.saveRoom(durableRoom);
        return { started: true };
      }
      return { started: false, reason: durableRoom === undefined ? "UNKNOWN_ROOM" : "NOT_LOBBY" };
    }
  }

  startedRooms.add(roomId);
  roomStore.saveRoom({ ...room, state: "in_session" });

  try {
    await orchestrator.dispatch(roomId, { type: "START_SESSION", by: room.hostPlayerId });
  } catch (error) {
    logFailure?.(`START_SESSION dispatch failed: ${String(error)}`);
    startedRooms.delete(roomId);
    acquired.release();
    const lobbyRoom: Room = { ...room, state: "lobby" };
    if (durableRoomRepository !== undefined) await durableRoomRepository.saveRoom(lobbyRoom);
    roomStore.saveRoom(lobbyRoom);
    return { started: false, reason: "START_FAILED" };
  }

  broadcastToRoom(roomId, { type: "turn_state", state: { roundNumber: 1, roomState: "in_session" } });
  return { started: true };
}

export function isStartFailureHttpError(outcome: StartMultiplayerSessionOutcome): boolean {
  return !outcome.started && outcome.reason === "START_FAILED";
}
