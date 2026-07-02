/**
 * Character State Store — reads/writes per-room mutable in-session character
 * facts.
 *
 * Durable character creation data stays on Character records. This store holds
 * play-state that can change during a session: conditions, inventory,
 * resources, relationships, personal clocks, memories, and flags.
 */
import { makeCharacterState, type CharacterState } from "../core/character-state.js";
import type { Character } from "./types.js";

/** Storage surface for a room's mutable Character States. */
export interface CharacterStateStore {
  /** Fetch the room's character states. Returns independent copies. */
  get(roomId: string): CharacterState[];
  /** Replace the room's character states with independent copies. */
  save(roomId: string, states: readonly CharacterState[]): void;
}

/** Create empty mutable state records for the room's confirmed characters. */
export function seedCharacterStatesForCharacters(characters: readonly Character[]): CharacterState[] {
  return characters
    .filter((character) => character.confirmed)
    .map((character) => makeCharacterState({ characterId: character.id }));
}

/** In-process {@link CharacterStateStore} backed by room id -> state array. */
export class InMemoryCharacterStateStore implements CharacterStateStore {
  private readonly states = new Map<string, CharacterState[]>();

  get(roomId: string): CharacterState[] {
    return (this.states.get(roomId) ?? []).map((state) => makeCharacterState(state));
  }

  save(roomId: string, states: readonly CharacterState[]): void {
    this.states.set(roomId, states.map((state) => makeCharacterState(state)));
  }
}
