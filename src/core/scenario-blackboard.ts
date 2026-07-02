export type RevealState = "hidden" | "partially_revealed" | "revealed";
export type ClueVisibility = "undiscovered" | "discovered";

export type RevealCondition =
  | { kind: "scene_entry"; sceneId: string }
  | { kind: "action_intent"; intent: string }
  | { kind: "check_result"; characterId?: string; outcome: string }
  | { kind: "clock_state"; clockId: string; valueAtLeast: number }
  | { kind: "npc_state"; npcId: string; field: string; value: string }
  | { kind: "explicit_gm_trigger"; triggerId: string };

export interface Secret {
  id: string;
  truth: string;
  sensitivity: string;
  revealState: RevealState;
  relatedClueIds: string[];
}

export interface Clue {
  id: string;
  conclusion: string;
  discoveryCondition: RevealCondition;
  visibility: ClueVisibility;
  redundantPathGroup?: string;
}

export interface NpcState {
  npcId: string;
  name: string;
  role: string;
  attitudeByCharacter: Record<string, string>;
  goals: string[];
  knownSecretIds: string[];
  location: string;
  pressureClockId?: string;
}

export interface WorldFlag {
  key: string;
  value: boolean | string | number;
}

export interface SceneNode {
  id: string;
  name: string;
  status?: string;
}

export interface ThreatState {
  id: string;
  name: string;
  status?: string;
}

export interface FrontState {
  id: string;
  name: string;
  stage?: string;
}

export interface ScenarioBlackboard {
  roomId: string;
  scenarioId: string;
  sceneNodes: SceneNode[];
  activeThreats: ThreatState[];
  fronts: FrontState[];
  clues: Clue[];
  secrets: Secret[];
  npcs: NpcState[];
  worldFlags: WorldFlag[];
  memoryRefs: string[];
}

export type BlackboardDelta =
  | { type: "reveal_clue"; clueId: string; reason: string }
  | { type: "reveal_secret"; secretId: string; reveal: "partial" | "full"; reason: string }
  | { type: "npc_attitude"; npcId: string; characterId: string; attitude: string; reason: string }
  | { type: "npc_location"; npcId: string; location: string; reason: string }
  | { type: "npc_goal_update"; npcId: string; goals: string[]; reason: string }
  | { type: "add_threat"; threat: ThreatState; reason: string }
  | { type: "advance_front"; frontId: string; stage: string; reason: string }
  | { type: "set_world_flag"; key: string; value: boolean | string | number; reason: string };

export type BlackboardRejectReason =
  | "UNKNOWN_DELTA_TYPE"
  | "UNKNOWN_CLUE"
  | "UNKNOWN_SECRET"
  | "UNKNOWN_NPC"
  | "UNKNOWN_CHARACTER"
  | "UNKNOWN_FRONT"
  | "INVALID_DELTA"
  /** Rejected by the session safety profile's pre-apply gate. */
  | "SAFETY_REJECTED";

export interface RejectedBlackboardDelta {
  delta: unknown;
  reason: BlackboardRejectReason;
}

export interface BlackboardDeltaApplication {
  blackboard: ScenarioBlackboard;
  applied: BlackboardDelta[];
  rejected: RejectedBlackboardDelta[];
}

export interface BlackboardReducerOptions {
  characterIds?: readonly string[];
}

export interface VisibleBlackboard {
  clues: { id: string; conclusion: string; redundantPathGroup?: string }[];
  npcs: { npcId: string; name: string; role: string; attitudeByCharacter: Record<string, string>; location: string }[];
  activeThreats: ThreatState[];
  worldFlags: WorldFlag[];
}

export interface GmBlackboardProjection extends VisibleBlackboard {
  discoveredClues: VisibleBlackboard["clues"];
}

export function createEmptyBlackboard(roomId: string, scenarioId: string): ScenarioBlackboard {
  return {
    roomId,
    scenarioId,
    sceneNodes: [],
    activeThreats: [],
    fronts: [],
    clues: [],
    secrets: [],
    npcs: [],
    worldFlags: [],
    memoryRefs: [],
  };
}

export function applyBlackboardDeltas(
  bb: ScenarioBlackboard,
  deltas: readonly unknown[],
  options: BlackboardReducerOptions = {},
): BlackboardDeltaApplication {
  const blackboard = cloneBlackboard(bb);
  const applied: BlackboardDelta[] = [];
  const rejected: RejectedBlackboardDelta[] = [];
  const allowedCharacters = options.characterIds === undefined ? undefined : new Set(options.characterIds);

  for (const delta of deltas) {
    if (!isBlackboardDelta(delta)) {
      rejected.push({ delta, reason: "UNKNOWN_DELTA_TYPE" });
      continue;
    }

    switch (delta.type) {
      case "reveal_clue": {
        const clue = blackboard.clues.find((c) => c.id === delta.clueId);
        if (clue === undefined) {
          rejected.push({ delta, reason: "UNKNOWN_CLUE" });
          break;
        }
        clue.visibility = "discovered";
        applied.push(delta);
        break;
      }
      case "reveal_secret": {
        const secret = blackboard.secrets.find((s) => s.id === delta.secretId);
        if (secret === undefined) {
          rejected.push({ delta, reason: "UNKNOWN_SECRET" });
          break;
        }
        secret.revealState = delta.reveal === "full" ? "revealed" : secret.revealState === "revealed" ? "revealed" : "partially_revealed";
        applied.push(delta);
        break;
      }
      case "npc_attitude": {
        const npc = blackboard.npcs.find((n) => n.npcId === delta.npcId);
        if (npc === undefined) {
          rejected.push({ delta, reason: "UNKNOWN_NPC" });
          break;
        }
        if (allowedCharacters !== undefined && !allowedCharacters.has(delta.characterId)) {
          rejected.push({ delta, reason: "UNKNOWN_CHARACTER" });
          break;
        }
        npc.attitudeByCharacter = { ...npc.attitudeByCharacter, [delta.characterId]: delta.attitude };
        applied.push(delta);
        break;
      }
      case "npc_location": {
        const npc = blackboard.npcs.find((n) => n.npcId === delta.npcId);
        if (npc === undefined) {
          rejected.push({ delta, reason: "UNKNOWN_NPC" });
          break;
        }
        npc.location = delta.location;
        applied.push(delta);
        break;
      }
      case "npc_goal_update": {
        const npc = blackboard.npcs.find((n) => n.npcId === delta.npcId);
        if (npc === undefined) {
          rejected.push({ delta, reason: "UNKNOWN_NPC" });
          break;
        }
        npc.goals = [...delta.goals];
        applied.push(delta);
        break;
      }
      case "add_threat":
        blackboard.activeThreats = [
          ...blackboard.activeThreats.filter((threat) => threat.id !== delta.threat.id),
          { ...delta.threat },
        ];
        applied.push(delta);
        break;
      case "advance_front": {
        const front = blackboard.fronts.find((f) => f.id === delta.frontId);
        if (front === undefined) {
          rejected.push({ delta, reason: "UNKNOWN_FRONT" });
          break;
        }
        front.stage = delta.stage;
        applied.push(delta);
        break;
      }
      case "set_world_flag":
        blackboard.worldFlags = [
          ...blackboard.worldFlags.filter((flag) => flag.key !== delta.key),
          { key: delta.key, value: delta.value },
        ];
        applied.push(delta);
        break;
    }
  }

  return { blackboard, applied, rejected };
}

export function toVisibleBlackboard(bb: ScenarioBlackboard): VisibleBlackboard {
  return {
    clues: bb.clues
      .filter((clue) => clue.visibility === "discovered")
      .map((clue) => ({
        id: clue.id,
        conclusion: clue.conclusion,
        ...(clue.redundantPathGroup !== undefined ? { redundantPathGroup: clue.redundantPathGroup } : {}),
      })),
    npcs: bb.npcs.map((npc) => ({
      npcId: npc.npcId,
      name: npc.name,
      role: npc.role,
      attitudeByCharacter: { ...npc.attitudeByCharacter },
      location: npc.location,
    })),
    activeThreats: bb.activeThreats.map((threat) => ({ ...threat })),
    worldFlags: bb.worldFlags.map((flag) => ({ ...flag })),
  };
}

export function toGmBlackboardProjection(bb: ScenarioBlackboard): GmBlackboardProjection {
  const visible = toVisibleBlackboard(bb);
  return { ...visible, discoveredClues: visible.clues };
}

export function cloneBlackboard(bb: ScenarioBlackboard): ScenarioBlackboard {
  return {
    roomId: bb.roomId,
    scenarioId: bb.scenarioId,
    sceneNodes: bb.sceneNodes.map((node) => ({ ...node })),
    activeThreats: bb.activeThreats.map((threat) => ({ ...threat })),
    fronts: bb.fronts.map((front) => ({ ...front })),
    clues: bb.clues.map((clue) => ({ ...clue, discoveryCondition: { ...clue.discoveryCondition } })),
    secrets: bb.secrets.map((secret) => ({ ...secret, relatedClueIds: [...secret.relatedClueIds] })),
    npcs: bb.npcs.map((npc) => ({
      ...npc,
      attitudeByCharacter: { ...npc.attitudeByCharacter },
      goals: [...npc.goals],
      knownSecretIds: [...npc.knownSecretIds],
    })),
    worldFlags: bb.worldFlags.map((flag) => ({ ...flag })),
    memoryRefs: [...bb.memoryRefs],
  };
}

function isBlackboardDelta(value: unknown): value is BlackboardDelta {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  if (typeof e.type !== "string" || typeof e.reason !== "string") return false;
  switch (e.type) {
    case "reveal_clue":
      return typeof e.clueId === "string";
    case "reveal_secret":
      return typeof e.secretId === "string" && (e.reveal === "partial" || e.reveal === "full");
    case "npc_attitude":
      return typeof e.npcId === "string" && typeof e.characterId === "string" && typeof e.attitude === "string";
    case "npc_location":
      return typeof e.npcId === "string" && typeof e.location === "string";
    case "npc_goal_update":
      return typeof e.npcId === "string" && Array.isArray(e.goals) && e.goals.every((goal) => typeof goal === "string");
    case "add_threat":
      return typeof e.threat === "object" && e.threat !== null && typeof (e.threat as { id?: unknown }).id === "string";
    case "advance_front":
      return typeof e.frontId === "string" && typeof e.stage === "string";
    case "set_world_flag":
      return typeof e.key === "string" && (typeof e.value === "boolean" || typeof e.value === "string" || typeof e.value === "number");
    default:
      return false;
  }
}
