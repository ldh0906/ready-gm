/**
 * Postgres-backed {@link ScenarioRepository}: durable scenario catalog listing
 * (Requirement 3.1) and per-room scenario selection (Requirement 3.2).
 *
 * The catalog lives in the `scenarios` table (seeded with the single MVP
 * scenario by the initial migration). Selections live in `scenario_selections`,
 * keyed 1:1 by room.
 */
import type { Scenario } from "../services/scenario-service.js";
import type { Queryable } from "./pg-client.js";
import { rowToScenario, scenarioToRow } from "./mappers.js";
import type { ScenarioRepository } from "./types.js";

export class PgScenarioRepository implements ScenarioRepository {
  constructor(private readonly db: Queryable) {}

  async listScenarios(): Promise<Scenario[]> {
    const { rows } = await this.db.query(`SELECT * FROM scenarios ORDER BY id ASC`);
    return rows.map(rowToScenario);
  }

  async getScenario(id: string): Promise<Scenario | undefined> {
    const { rows } = await this.db.query(`SELECT * FROM scenarios WHERE id = $1`, [id]);
    return rows[0] ? rowToScenario(rows[0]) : undefined;
  }

  /** Upsert a scenario into the catalog (used by seeding/admin flows). */
  async saveScenario(scenario: Scenario): Promise<void> {
    await this.db.query(
      `INSERT INTO scenarios (id, title, summary, opening_seed, ending_condition)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         summary = EXCLUDED.summary,
         opening_seed = EXCLUDED.opening_seed,
         ending_condition = EXCLUDED.ending_condition`,
      scenarioToRow(scenario),
    );
  }

  async getSelection(roomId: string): Promise<string | null> {
    const { rows } = await this.db.query(
      `SELECT scenario_id FROM scenario_selections WHERE room_id = $1`,
      [roomId],
    );
    return rows[0] ? (rows[0].scenario_id as string) : null;
  }

  async setSelection(roomId: string, scenarioId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO scenario_selections (room_id, scenario_id)
       VALUES ($1, $2)
       ON CONFLICT (room_id) DO UPDATE SET scenario_id = EXCLUDED.scenario_id`,
      [roomId, scenarioId],
    );
  }
}
