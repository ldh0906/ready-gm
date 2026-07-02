import { cloneMemoryRecords, type MemoryRecord } from "../core/memory-record.js";

/** Per-room summarized Memory Clerk records (whole-list save, like blackboard). */
export interface MemoryStore {
  list(roomId: string): MemoryRecord[];
  save(roomId: string, records: readonly MemoryRecord[]): void;
}

export class InMemoryMemoryStore implements MemoryStore {
  private readonly memories = new Map<string, MemoryRecord[]>();

  list(roomId: string): MemoryRecord[] {
    const records = this.memories.get(roomId);
    return records === undefined ? [] : cloneMemoryRecords(records);
  }

  save(roomId: string, records: readonly MemoryRecord[]): void {
    this.memories.set(roomId, cloneMemoryRecords(records));
  }
}
