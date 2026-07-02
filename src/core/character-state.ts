/**
 * Character State — mutable in-session facts about a character.
 *
 * Character creation data remains on the durable Character/Sheet side. This
 * module models the state that can change during play and applies AI-proposed
 * CharacterDelta commands through server-side validation.
 */

export interface CharacterCondition {
  name: string;
  severity?: number;
  reason?: string;
}

export interface InventoryItem {
  name: string;
  tags: string[];
  reason?: string;
}

export interface RelationshipState {
  targetId: string;
  attitude: string;
  reason?: string;
}

export interface PersonalClock {
  id: string;
  name: string;
  value: number;
  max: number;
}

export interface CharacterMemory {
  text: string;
  salience: number;
  reason?: string;
}

export interface CharacterState {
  characterId: string;
  conditions: CharacterCondition[];
  inventory: InventoryItem[];
  resources: Record<string, number>;
  relationships: Record<string, RelationshipState>;
  personalClocks: PersonalClock[];
  memories: CharacterMemory[];
  flags: Record<string, boolean | string | number>;
}

export interface CharacterStateInit {
  characterId: string;
  conditions?: readonly CharacterCondition[];
  inventory?: readonly InventoryItem[];
  resources?: Record<string, number>;
  relationships?: Record<string, RelationshipState>;
  personalClocks?: readonly PersonalClock[];
  memories?: readonly CharacterMemory[];
  flags?: Record<string, boolean | string | number>;
}

export type CharacterDelta =
  | { type: "add_condition"; characterId: string; condition: string; severity?: number; reason: string }
  | { type: "remove_condition"; characterId: string; condition: string; reason: string }
  | { type: "add_inventory"; characterId: string; item: string; tags: string[]; reason: string }
  | { type: "spend_resource"; characterId: string; resource: string; amount: number; reason: string }
  | { type: "update_relationship"; characterId: string; targetId: string; attitude: string; reason: string }
  | { type: "advance_personal_clock"; characterId: string; clockId: string; ticks: number; reason: string }
  | { type: "add_memory"; characterId: string; text: string; salience: number; reason: string };

export type CharacterDeltaRejectReason =
  | "UNKNOWN_CHARACTER"
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_RESOURCE"
  | "UNKNOWN_CLOCK";

export interface RejectedCharacterDelta {
  delta: CharacterDelta;
  reason: CharacterDeltaRejectReason;
}

export interface CharacterDeltaApplication {
  states: CharacterState[];
  applied: CharacterDelta[];
  rejected: RejectedCharacterDelta[];
}

/**
 * The player-visible projection of a {@link CharacterState}, safe to fan out to
 * every client. Includes conditions, inventory, resources, and personal clocks;
 * EXCLUDES GM-only material — memories, flags, relationships, and every
 * `reason` field (delta rationale is GM bookkeeping, not table-facing info).
 */
export interface VisibleCharacterState {
  characterId: string;
  /** Display name resolved at fan-out time (empty when unresolvable). */
  name: string;
  conditions: { name: string; severity?: number }[];
  inventory: { name: string; tags: string[] }[];
  resources: Record<string, number>;
  personalClocks: PersonalClock[];
}

/**
 * Project a {@link CharacterState} to its player-visible subset. Pure; the
 * result shares no references with the input.
 */
export function toVisibleCharacterState(
  state: CharacterState,
  name: string,
): VisibleCharacterState {
  return {
    characterId: state.characterId,
    name,
    conditions: state.conditions.map((condition) => ({
      name: condition.name,
      ...(condition.severity !== undefined ? { severity: condition.severity } : {}),
    })),
    inventory: state.inventory.map((item) => ({ name: item.name, tags: [...item.tags] })),
    resources: { ...state.resources },
    personalClocks: state.personalClocks.map(cloneClock),
  };
}

function cloneCondition(condition: CharacterCondition): CharacterCondition {
  return {
    name: condition.name,
    ...(condition.severity !== undefined ? { severity: condition.severity } : {}),
    ...(condition.reason !== undefined ? { reason: condition.reason } : {}),
  };
}

function cloneInventoryItem(item: InventoryItem): InventoryItem {
  return {
    name: item.name,
    tags: [...item.tags],
    ...(item.reason !== undefined ? { reason: item.reason } : {}),
  };
}

function cloneRelationship(relationship: RelationshipState): RelationshipState {
  return {
    targetId: relationship.targetId,
    attitude: relationship.attitude,
    ...(relationship.reason !== undefined ? { reason: relationship.reason } : {}),
  };
}

function cloneClock(clock: PersonalClock): PersonalClock {
  return { id: clock.id, name: clock.name, value: clock.value, max: clock.max };
}

function cloneMemory(memory: CharacterMemory): CharacterMemory {
  return {
    text: memory.text,
    salience: memory.salience,
    ...(memory.reason !== undefined ? { reason: memory.reason } : {}),
  };
}

export function makeCharacterState(init: CharacterStateInit): CharacterState {
  return {
    characterId: init.characterId,
    conditions: (init.conditions ?? []).map(cloneCondition),
    inventory: (init.inventory ?? []).map(cloneInventoryItem),
    resources: { ...(init.resources ?? {}) },
    relationships: Object.fromEntries(
      Object.entries(init.relationships ?? {}).map(([key, value]) => [key, cloneRelationship(value)]),
    ),
    personalClocks: (init.personalClocks ?? []).map((clock) => ({
      ...cloneClock(clock),
      max: Math.max(1, Math.trunc(clock.max)),
      value: clamp(Math.trunc(clock.value), 0, Math.max(1, Math.trunc(clock.max))),
    })),
    memories: (init.memories ?? []).map(cloneMemory),
    flags: { ...(init.flags ?? {}) },
  };
}

function cloneState(state: CharacterState): CharacterState {
  return makeCharacterState(state);
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function applyCharacterDeltas(
  states: readonly CharacterState[],
  deltas: readonly CharacterDelta[],
): CharacterDeltaApplication {
  const nextStates = states.map(cloneState);
  const byId = new Map(nextStates.map((state) => [state.characterId, state] as const));
  const applied: CharacterDelta[] = [];
  const rejected: RejectedCharacterDelta[] = [];

  for (const delta of deltas) {
    const state = byId.get(delta.characterId);
    if (state === undefined) {
      rejected.push({ delta, reason: "UNKNOWN_CHARACTER" });
      continue;
    }

    switch (delta.type) {
      case "add_condition":
        state.conditions = [
          ...state.conditions.filter((condition) => condition.name !== delta.condition),
          {
            name: delta.condition,
            ...(delta.severity !== undefined ? { severity: delta.severity } : {}),
            reason: delta.reason,
          },
        ];
        applied.push(delta);
        break;
      case "remove_condition":
        state.conditions = state.conditions.filter((condition) => condition.name !== delta.condition);
        applied.push(delta);
        break;
      case "add_inventory":
        state.inventory = [...state.inventory, { name: delta.item, tags: [...delta.tags], reason: delta.reason }];
        applied.push(delta);
        break;
      case "spend_resource": {
        if (!Number.isFinite(delta.amount) || delta.amount <= 0) {
          rejected.push({ delta, reason: "INVALID_AMOUNT" });
          break;
        }
        const current = state.resources[delta.resource] ?? 0;
        if (current < delta.amount) {
          rejected.push({ delta, reason: "INSUFFICIENT_RESOURCE" });
          break;
        }
        state.resources = { ...state.resources, [delta.resource]: current - delta.amount };
        applied.push(delta);
        break;
      }
      case "update_relationship":
        state.relationships = {
          ...state.relationships,
          [delta.targetId]: { targetId: delta.targetId, attitude: delta.attitude, reason: delta.reason },
        };
        applied.push(delta);
        break;
      case "advance_personal_clock": {
        if (!Number.isFinite(delta.ticks) || delta.ticks <= 0) {
          rejected.push({ delta, reason: "INVALID_AMOUNT" });
          break;
        }
        const index = state.personalClocks.findIndex((clock) => clock.id === delta.clockId);
        if (index < 0) {
          rejected.push({ delta, reason: "UNKNOWN_CLOCK" });
          break;
        }
        state.personalClocks = state.personalClocks.map((clock, clockIndex) =>
          clockIndex === index
            ? { ...clock, value: clamp(clock.value + Math.trunc(delta.ticks), 0, clock.max) }
            : clock,
        );
        applied.push(delta);
        break;
      }
      case "add_memory":
        state.memories = [
          ...state.memories,
          { text: delta.text, salience: delta.salience, reason: delta.reason },
        ];
        applied.push(delta);
        break;
    }
  }

  return { states: nextStates, applied, rejected };
}
