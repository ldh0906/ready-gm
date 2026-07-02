/**
 * Postgres-backed {@link RoomRepository}: durable storage for Room, Player, and
 * Character records.
 *
 * All statements are parameterized (`$1, $2, ...`) — never string-interpolated —
 * to avoid SQL injection. Saves upsert on the primary key so repeated writes
 * are idempotent (Requirements 1.1, 1.2, 2.x, 4.x).
 */
import type { Character, Player, Room } from "../services/types.js";
import type { Queryable } from "./pg-client.js";
import {
  characterToRow,
  playerToRow,
  roomToRow,
  rowToCharacter,
  rowToPlayer,
  rowToRoom,
} from "./mappers.js";
import type { RoomRepository } from "./types.js";

type TransactionClient = Queryable & { release?: () => void };

interface Connectable {
  connect(): Promise<TransactionClient>;
}

function isConnectable(db: Queryable): db is Queryable & Connectable {
  return typeof (db as unknown as Connectable).connect === "function";
}

export class PgRoomRepository implements RoomRepository {
  constructor(private readonly db: Queryable) {}

  private async withTransaction<T>(fn: (db: Queryable) => Promise<T>): Promise<T> {
    const client: TransactionClient = isConnectable(this.db) ? await this.db.connect() : this.db;
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release?.();
    }
  }

  async saveRoom(room: Room): Promise<void> {
    await this.saveRoomOn(this.db, room);
  }

  async createRoomWithHost(input: {
    room: Room;
    host: Player;
    initialCharacter?: Character;
    scenarioId?: string;
  }): Promise<void> {
    await this.withTransaction(async (db) => {
      await this.saveRoomOn(db, input.room);
      await this.savePlayerOn(db, input.host);
      if (input.initialCharacter !== undefined) {
        await this.saveCharacterOn(db, input.initialCharacter);
      }
      if (input.scenarioId !== undefined) {
        await db.query(
          `INSERT INTO scenario_selections (room_id, scenario_id)
           VALUES ($1, $2)
           ON CONFLICT (room_id) DO UPDATE SET scenario_id = EXCLUDED.scenario_id`,
          [input.room.id, input.scenarioId],
        );
      }
    });
  }

  async getRoom(roomId: string): Promise<Room | undefined> {
    const { rows } = await this.db.query(`SELECT * FROM rooms WHERE id = $1`, [roomId]);
    return rows[0] ? rowToRoom(rows[0]) : undefined;
  }

  async getRoomByToken(token: string): Promise<Room | undefined> {
    const { rows } = await this.db.query(`SELECT * FROM rooms WHERE invite_token = $1`, [token]);
    return rows[0] ? rowToRoom(rows[0]) : undefined;
  }

  async listRooms(): Promise<Room[]> {
    const { rows } = await this.db.query(`SELECT * FROM rooms`);
    return rows.map(rowToRoom);
  }

  async savePlayer(player: Player): Promise<void> {
    await this.savePlayerOn(this.db, player);
  }

  async joinPlayerIfRoomHasCapacity(
    player: Player,
  ): Promise<"inserted" | "full" | "unavailable"> {
    let outcome: "inserted" | "full" | "unavailable" = "unavailable";
    await this.withTransaction(async (db) => {
      const roomResult = await db.query(
        `SELECT id, state, max_players
         FROM rooms
         WHERE id = $1
         FOR UPDATE`,
        [player.roomId],
      );
      const room = roomResult.rows[0];
      if (room === undefined || room.state !== "lobby") {
        outcome = "unavailable";
        throw new RollbackOnly();
      }
      const countResult = await db.query(`SELECT COUNT(*) AS count FROM players WHERE room_id = $1`, [
        player.roomId,
      ]);
      const count = Number(countResult.rows[0]?.count ?? 0);
      const maxPlayers = Number(room.max_players);
      if (count >= maxPlayers) {
        outcome = "full";
        throw new RollbackOnly();
      }
      await this.savePlayerOn(db, player);
      outcome = "inserted";
    }).catch((error: unknown) => {
      if (!(error instanceof RollbackOnly)) throw error;
    });
    return outcome;
  }

  private async savePlayerOn(db: Queryable, player: Player): Promise<void> {
    await db.query(
      `INSERT INTO players (id, room_id, display_name, is_host, character_id, connection_status)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         room_id = EXCLUDED.room_id,
         display_name = EXCLUDED.display_name,
         is_host = EXCLUDED.is_host,
         character_id = EXCLUDED.character_id,
         connection_status = EXCLUDED.connection_status,
         updated_at = now()`,
      playerToRow(player),
    );
  }

  async getPlayer(playerId: string): Promise<Player | undefined> {
    const { rows } = await this.db.query(`SELECT * FROM players WHERE id = $1`, [playerId]);
    return rows[0] ? rowToPlayer(rows[0]) : undefined;
  }

  async listPlayers(roomId: string): Promise<Player[]> {
    const { rows } = await this.db.query(`SELECT * FROM players WHERE room_id = $1`, [roomId]);
    return rows.map(rowToPlayer);
  }

  async listAllPlayers(): Promise<Player[]> {
    const { rows } = await this.db.query(`SELECT * FROM players`);
    return rows.map(rowToPlayer);
  }

  async saveCharacter(character: Character): Promise<void> {
    await this.saveCharacterOn(this.db, character);
  }

  async saveCharacterForPlayer(character: Character, player: Player): Promise<void> {
    await this.withTransaction(async (db) => {
      await this.saveCharacterOn(db, character);
      await this.savePlayerOn(db, player);
    });
  }

  private async saveRoomOn(db: Queryable, room: Room): Promise<void> {
    await db.query(
      `INSERT INTO rooms (id, invite_token, host_player_id, scenario_id, state, max_players, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         invite_token = EXCLUDED.invite_token,
         host_player_id = EXCLUDED.host_player_id,
         scenario_id = EXCLUDED.scenario_id,
         state = EXCLUDED.state,
         max_players = EXCLUDED.max_players,
         updated_at = now()`,
      roomToRow(room),
    );
  }

  private async saveCharacterOn(db: Queryable, character: Character): Promise<void> {
    await db.query(
      `INSERT INTO characters (id, player_id, room_id, name, concept, attributes, confirmed, selected_card_id, sheet_data)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         player_id = EXCLUDED.player_id,
         room_id = EXCLUDED.room_id,
         name = EXCLUDED.name,
         concept = EXCLUDED.concept,
         attributes = EXCLUDED.attributes,
         confirmed = EXCLUDED.confirmed,
         selected_card_id = EXCLUDED.selected_card_id,
         sheet_data = EXCLUDED.sheet_data,
         updated_at = now()`,
      characterToRow(character),
    );
  }

  async getCharacter(characterId: string): Promise<Character | undefined> {
    const { rows } = await this.db.query(`SELECT * FROM characters WHERE id = $1`, [characterId]);
    return rows[0] ? rowToCharacter(rows[0]) : undefined;
  }

  async listCharactersByRoom(roomId: string): Promise<Character[]> {
    const { rows } = await this.db.query(`SELECT * FROM characters WHERE room_id = $1`, [roomId]);
    return rows.map(rowToCharacter);
  }

  async listAllCharacters(): Promise<Character[]> {
    const { rows } = await this.db.query(`SELECT * FROM characters`);
    return rows.map(rowToCharacter);
  }

  async markRoomInSessionIfLobby(roomId: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE rooms
       SET state = 'in_session', updated_at = now()
       WHERE id = $1 AND state = 'lobby'
       RETURNING id`,
      [roomId],
    );
    return (rowCount ?? 0) > 0;
  }

  async markRoomEndedIfInSession(roomId: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE rooms
       SET state = 'ended', updated_at = now()
       WHERE id = $1 AND state = 'in_session'
       RETURNING id`,
      [roomId],
    );
    return (rowCount ?? 0) > 0;
  }
}

class RollbackOnly extends Error {}
