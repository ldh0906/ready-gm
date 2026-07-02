/**
 * Postgres-backed {@link CharacterStateRepository}: durable storage for the
 * per-room mutable Character States (the Living Character Sheet loop's applied
 * state).
 *
 * The whole state array is stored as one `jsonb` document per room (upsert by
 * `room_id`), mirroring the room_clocks table. Character States are plain JSON
 * data so they round-trip without a special serializer; reads are re-normalized
 * through {@link makeCharacterState} at the store layer.
 */
import type { CharacterState } from "../core/character-state.js";
import { parseJsonColumn, toJsonParam } from "./mappers.js";
import type { Queryable } from "./pg-client.js";
import type { CharacterStateRecord, CharacterStateRepository } from "./types.js";

export class PgCharacterStateRepository implements CharacterStateRepository {
  constructor(private readonly db: Queryable) {}

  async get(roomId: string): Promise<CharacterState[]> {
    const { rows } = await this.db.query(
      `SELECT states FROM room_character_states WHERE room_id = $1`,
      [roomId],
    );
    return rows[0] ? parseJsonColumn<CharacterState[]>(rows[0].states) : [];
  }

  async save(roomId: string, states: readonly CharacterState[]): Promise<void> {
    await this.db.query(
      `INSERT INTO room_character_states (room_id, states, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (room_id) DO UPDATE SET
         states = EXCLUDED.states,
         updated_at = now()`,
      [roomId, toJsonParam(states)],
    );
  }

  async listAll(): Promise<CharacterStateRecord[]> {
    const { rows } = await this.db.query(`SELECT room_id, states FROM room_character_states`);
    return rows.map((row) => ({
      roomId: row.room_id as string,
      states: parseJsonColumn<CharacterState[]>(row.states),
    }));
  }
}
