/**
 * Postgres-backed {@link SceneRepository}: durable storage for the per-room
 * Scene State.
 *
 * The scene is stored as one `jsonb` document per room (upsert by `room_id`),
 * mirroring the Turn_State table. Scene State is plain JSON data so it
 * round-trips without a special serializer.
 */
import type { SceneState } from "../core/scene-state.js";
import { parseJsonColumn, toJsonParam } from "./mappers.js";
import type { Queryable } from "./pg-client.js";
import type { SceneRecord, SceneRepository } from "./types.js";

export class PgSceneRepository implements SceneRepository {
  constructor(private readonly db: Queryable) {}

  async get(roomId: string): Promise<SceneState | undefined> {
    const { rows } = await this.db.query(`SELECT scene FROM room_scenes WHERE room_id = $1`, [
      roomId,
    ]);
    return rows[0] ? parseJsonColumn<SceneState>(rows[0].scene) : undefined;
  }

  async save(roomId: string, scene: SceneState): Promise<void> {
    await this.db.query(
      `INSERT INTO room_scenes (room_id, scene, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (room_id) DO UPDATE SET
         scene = EXCLUDED.scene,
         updated_at = now()`,
      [roomId, toJsonParam(scene)],
    );
  }

  async listAll(): Promise<SceneRecord[]> {
    const { rows } = await this.db.query(`SELECT room_id, scene FROM room_scenes`);
    return rows.map((row) => ({
      roomId: row.room_id as string,
      scene: parseJsonColumn<SceneState>(row.scene),
    }));
  }
}
