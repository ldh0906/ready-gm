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

export class PgRoomRepository implements RoomRepository {
  constructor(private readonly db: Queryable) {}

  async saveRoom(room: Room): Promise<void> {
    await this.db.query(
      `INSERT INTO rooms (id, invite_token, host_player_id, scenario_id, state, max_players, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         invite_token = EXCLUDED.invite_token,
         host_player_id = EXCLUDED.host_player_id,
         scenario_id = EXCLUDED.scenario_id,
         state = EXCLUDED.state,
         max_players = EXCLUDED.max_players,
         created_at = EXCLUDED.created_at`,
      roomToRow(room),
    );
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
    await this.db.query(
      `INSERT INTO players (id, room_id, display_name, is_host, character_id, connection_status)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         room_id = EXCLUDED.room_id,
         display_name = EXCLUDED.display_name,
         is_host = EXCLUDED.is_host,
         character_id = EXCLUDED.character_id,
         connection_status = EXCLUDED.connection_status`,
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
    await this.db.query(
      `INSERT INTO characters (id, player_id, room_id, name, concept, attributes, confirmed)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (id) DO UPDATE SET
         player_id = EXCLUDED.player_id,
         room_id = EXCLUDED.room_id,
         name = EXCLUDED.name,
         concept = EXCLUDED.concept,
         attributes = EXCLUDED.attributes,
         confirmed = EXCLUDED.confirmed`,
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
}
