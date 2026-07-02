import type { ScenarioBlackboard } from "../core/scenario-blackboard.js";
import { parseJsonColumn, toJsonParam } from "./mappers.js";
import type { BlackboardRecord, BlackboardRepository } from "./types.js";
import type { Queryable } from "./pg-client.js";

export class PgBlackboardRepository implements BlackboardRepository {
  constructor(private readonly db: Queryable) {}

  async get(roomId: string): Promise<ScenarioBlackboard | undefined> {
    const { rows } = await this.db.query(`SELECT blackboard FROM room_blackboards WHERE room_id = $1`, [
      roomId,
    ]);
    return rows[0] ? parseJsonColumn<ScenarioBlackboard>(rows[0].blackboard) : undefined;
  }

  async save(roomId: string, blackboard: ScenarioBlackboard): Promise<void> {
    await this.db.query(
      `INSERT INTO room_blackboards (room_id, blackboard, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (room_id) DO UPDATE SET
         blackboard = EXCLUDED.blackboard,
         updated_at = now()`,
      [roomId, toJsonParam(blackboard)],
    );
  }

  async listAll(): Promise<BlackboardRecord[]> {
    const { rows } = await this.db.query(`SELECT room_id, blackboard FROM room_blackboards`);
    return rows.map((row) => ({
      roomId: row.room_id as string,
      blackboard: parseJsonColumn<ScenarioBlackboard>(row.blackboard),
    }));
  }
}
