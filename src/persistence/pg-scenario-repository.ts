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

/**
 * Ordered column list for the `scenarios` table — the single source of truth
 * for the Column_Ordering_Convention (Requirements 5.1, 5.2). The first 9
 * entries preserve the original column order; new columns are appended at the
 * tail. `scenarioToRow` (mappers.ts) MUST emit values position-aligned with
 * this list, and `saveScenario`'s INSERT MUST list columns in this order. The
 * Column_Param_Arity_Guard test asserts
 * `scenarioToRow(s).length === SCENARIO_INSERT_COLUMNS.length`.
 */
export const SCENARIO_INSERT_COLUMNS = [
  "id",
  "title",
  "summary",
  "opening_seed",
  "ending_condition",
  "genre",
  "category",
  "has_special_rules",
  "system",
  "allocation",
  "attribute_proposal_disabled",
  "form",
] as const;

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

  /**
   * Upsert a scenario into the catalog (used by seeding/admin flows).
   *
   * Column_Ordering_Convention: the INSERT column order below MUST stay aligned
   * across three places — the migration DDL (`migrations/0004_scenario_allocation.sql`),
   * `scenarioToRow` (mappers.ts), and this INSERT. The single source of truth is
   * {@link SCENARIO_INSERT_COLUMNS}; existing columns keep their order and new
   * columns are appended at the tail. The Column_Param_Arity_Guard test keeps
   * `scenarioToRow` output length aligned with `SCENARIO_INSERT_COLUMNS`.
   */
  async saveScenario(scenario: Scenario): Promise<void> {
    await this.db.query(
      `INSERT INTO scenarios (id, title, summary, opening_seed, ending_condition, genre, category, has_special_rules, system, allocation, attribute_proposal_disabled, form)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         summary = EXCLUDED.summary,
         opening_seed = EXCLUDED.opening_seed,
         ending_condition = EXCLUDED.ending_condition,
         genre = EXCLUDED.genre,
         category = EXCLUDED.category,
         has_special_rules = EXCLUDED.has_special_rules,
         system = EXCLUDED.system,
         allocation = EXCLUDED.allocation,
         attribute_proposal_disabled = EXCLUDED.attribute_proposal_disabled,
         form = EXCLUDED.form,
         updated_at = now()`,
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
       ON CONFLICT (room_id) DO UPDATE SET
         scenario_id = EXCLUDED.scenario_id,
         updated_at = now()`,
      [roomId, scenarioId],
    );
  }
}
