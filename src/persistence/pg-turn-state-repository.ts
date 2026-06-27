/**
 * Postgres-backed {@link TurnStateRepository}: durable, lossless storage for the
 * per-room Turn_State (Requirement 12.3).
 *
 * The Turn_State is stored as its canonical serialized JSON in a `jsonb` column
 * (reusing the core serializer) so the durable copy round-trips losslessly with
 * the live copy. Upserts by `room_id`.
 */
import type { TurnState } from "../core/turn-state.js";
import type { Queryable } from "./pg-client.js";
import { rowToTurnState, turnStateToRow } from "./mappers.js";
import type { TurnStateRepository } from "./types.js";

export class PgTurnStateRepository implements TurnStateRepository {
  constructor(private readonly db: Queryable) {}

  async get(roomId: string): Promise<TurnState | undefined> {
    const { rows } = await this.db.query(`SELECT state FROM turn_states WHERE room_id = $1`, [
      roomId,
    ]);
    return rows[0] ? rowToTurnState(rows[0]) : undefined;
  }

  async save(turnState: TurnState): Promise<void> {
    await this.db.query(
      `INSERT INTO turn_states (room_id, state, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (room_id) DO UPDATE SET
         state = EXCLUDED.state,
         updated_at = now()`,
      turnStateToRow(turnState),
    );
  }

  async listAll(): Promise<TurnState[]> {
    const { rows } = await this.db.query(`SELECT state FROM turn_states`);
    return rows.map(rowToTurnState);
  }
}
