/**
 * Memory Clerk records — summarized long-term memory for the AI GM
 * (ai-architecture.md "Memory Clerk").
 *
 * Long-term memory is never the raw round transcript: it is a small set of
 * summarized {@link MemoryRecord}s derived deterministically from applied diffs
 * (plus validated AI-proposed writes). The next round's AI context receives
 * only the highest-salience records under an explicit budget, so raw prompts,
 * raw corpora, and secret data never ride along.
 *
 * Pure module: derivation, validation, and budget selection never mutate their
 * inputs and carry no I/O.
 */
import type { BlackboardDelta } from "./scenario-blackboard.js";

/** The kinds of memory the Clerk keeps (ai_architecture_gap_prompt §4). */
export const MEMORY_KINDS = [
  "player_choice",
  "npc_change",
  "unresolved_hook",
  "discovered_clue",
  "safety_preference",
  "tone_note",
] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];

/** Who may see a record: GM-only context vs. player-visible surfaces. */
export const MEMORY_VISIBILITIES = ["gm_only", "player_visible"] as const;

export type MemoryVisibility = (typeof MEMORY_VISIBILITIES)[number];

/** One summarized long-term memory for a room. */
export interface MemoryRecord {
  id: string;
  roomId: string;
  kind: MemoryKind;
  summary: string;
  /** Relative importance in [0, 1]; drives context selection. */
  salience: number;
  visibility: MemoryVisibility;
  /** Event/round provenance (e.g. `round-3`), for auditability. */
  sourceEventIds: string[];
  /** Optional ISO expiry after which the record drops out of context. */
  expiresAt?: string;
}

/** An AI-proposed memory write BEFORE server validation assigns identity. */
export interface MemoryWrite {
  kind: MemoryKind;
  summary: string;
  salience: number;
  visibility: MemoryVisibility;
  expiresAt?: string;
}

export type MemoryWriteRejectReason =
  | "INVALID_WRITE"
  | "UNKNOWN_KIND"
  | "INVALID_SUMMARY"
  | "INVALID_SALIENCE"
  | "INVALID_VISIBILITY";

export interface RejectedMemoryWrite {
  write: unknown;
  reason: MemoryWriteRejectReason;
}

/** Longest accepted summary — memories are summaries, not transcripts. */
export const MAX_MEMORY_SUMMARY_LENGTH = 300;

/**
 * Validate one proposed memory write (fail-closed). Salience must be a finite
 * number in [0, 1] and the summary must be a non-empty summary-sized string.
 */
export function validateMemoryWrite(
  value: unknown,
): { ok: true; value: MemoryWrite } | { ok: false; reason: MemoryWriteRejectReason } {
  if (typeof value !== "object" || value === null) return { ok: false, reason: "INVALID_WRITE" };
  const e = value as Record<string, unknown>;
  if (typeof e.kind !== "string" || !(MEMORY_KINDS as readonly string[]).includes(e.kind)) {
    return { ok: false, reason: "UNKNOWN_KIND" };
  }
  if (
    typeof e.summary !== "string" ||
    e.summary.trim().length === 0 ||
    e.summary.length > MAX_MEMORY_SUMMARY_LENGTH
  ) {
    return { ok: false, reason: "INVALID_SUMMARY" };
  }
  if (typeof e.salience !== "number" || !Number.isFinite(e.salience) || e.salience < 0 || e.salience > 1) {
    return { ok: false, reason: "INVALID_SALIENCE" };
  }
  if (
    typeof e.visibility !== "string" ||
    !(MEMORY_VISIBILITIES as readonly string[]).includes(e.visibility)
  ) {
    return { ok: false, reason: "INVALID_VISIBILITY" };
  }
  const write: MemoryWrite = {
    kind: e.kind as MemoryKind,
    summary: e.summary.trim(),
    salience: e.salience,
    visibility: e.visibility as MemoryVisibility,
  };
  if (typeof e.expiresAt === "string" && e.expiresAt.trim().length > 0) {
    write.expiresAt = e.expiresAt;
  }
  return { ok: true, value: write };
}

/** Inputs for the deterministic per-round Memory Clerk derivation. */
export interface DeriveRoundMemoriesInput {
  roomId: string;
  roundNumber: number;
  /** Engine-applied blackboard deltas for this round. */
  appliedBlackboardDeltas?: readonly BlackboardDelta[];
  /** Confirmed player actions this round (character name + action text). */
  confirmedActions?: readonly { characterName: string; actionText: string }[];
  /** Safety flags the decision raised this round. */
  safetyFlags?: readonly string[];
}

/**
 * The deterministic Memory Clerk: derive summarized records from what the
 * server actually applied this round (no extra AI call). Rule-based salience:
 * safety > discovered clues > NPC changes > player choices.
 */
export function deriveRoundMemories(input: DeriveRoundMemoriesInput): MemoryRecord[] {
  const { roomId, roundNumber } = input;
  const source = [`round-${roundNumber}`];
  const records: MemoryRecord[] = [];
  let seq = 0;
  const nextId = (kind: MemoryKind): string => `mem-r${roundNumber}-${kind}-${++seq}`;

  for (const delta of input.appliedBlackboardDeltas ?? []) {
    if (delta.type === "reveal_clue") {
      records.push({
        id: nextId("discovered_clue"),
        roomId,
        kind: "discovered_clue",
        summary: `단서 발견: ${delta.clueId} (${delta.reason})`,
        salience: 0.8,
        visibility: "player_visible",
        sourceEventIds: [...source],
      });
    } else if (
      delta.type === "npc_attitude" ||
      delta.type === "npc_location" ||
      delta.type === "npc_goal_update"
    ) {
      records.push({
        id: nextId("npc_change"),
        roomId,
        kind: "npc_change",
        summary: `NPC 변화(${delta.npcId}): ${delta.reason}`,
        salience: 0.6,
        visibility: "gm_only",
        sourceEventIds: [...source],
      });
    }
  }

  for (const action of input.confirmedActions ?? []) {
    const text = action.actionText.trim();
    if (text.length === 0) continue;
    records.push({
      id: nextId("player_choice"),
      roomId,
      kind: "player_choice",
      summary: `${action.characterName}: ${text.slice(0, MAX_MEMORY_SUMMARY_LENGTH - 40)}`,
      salience: 0.4,
      visibility: "player_visible",
      sourceEventIds: [...source],
    });
  }

  for (const flag of input.safetyFlags ?? []) {
    if (flag.trim().length === 0) continue;
    records.push({
      id: nextId("safety_preference"),
      roomId,
      kind: "safety_preference",
      summary: `안전 신호: ${flag.trim()}`,
      salience: 0.9,
      visibility: "gm_only",
      sourceEventIds: [...source],
    });
  }

  return records;
}

/** Budget for {@link selectMemoryContext}. */
export interface MemoryContextBudget {
  /** Maximum record count in the AI context. */
  maxRecords: number;
  /** Maximum total summary characters in the AI context. */
  maxChars: number;
}

/** Default context budget: a handful of short summaries, never a transcript. */
export const DEFAULT_MEMORY_CONTEXT_BUDGET: MemoryContextBudget = {
  maxRecords: 8,
  maxChars: 1200,
};

/**
 * Select the records worth putting in the next round's AI context: highest
 * salience first (recency breaks ties), expired and duplicate summaries
 * dropped, truncated to the record/char budget.
 */
export function selectMemoryContext(
  records: readonly MemoryRecord[],
  budget: MemoryContextBudget = DEFAULT_MEMORY_CONTEXT_BUDGET,
  now: Date = new Date(),
): MemoryRecord[] {
  const nowMs = now.getTime();
  const alive = records.filter((record) => {
    if (record.expiresAt === undefined) return true;
    const expiry = Date.parse(record.expiresAt);
    return Number.isNaN(expiry) ? true : expiry > nowMs;
  });
  const indexed = alive.map((record, index) => ({ record, index }));
  indexed.sort((a, b) =>
    b.record.salience !== a.record.salience
      ? b.record.salience - a.record.salience
      : b.index - a.index,
  );

  const seen = new Set<string>();
  const selected: MemoryRecord[] = [];
  let chars = 0;
  for (const { record } of indexed) {
    if (selected.length >= budget.maxRecords) break;
    if (seen.has(record.summary)) continue;
    if (chars + record.summary.length > budget.maxChars) continue;
    seen.add(record.summary);
    chars += record.summary.length;
    selected.push(record);
  }
  return selected;
}

/** Deep-copy a record list (store isolation, mirroring cloneBlackboard). */
export function cloneMemoryRecords(records: readonly MemoryRecord[]): MemoryRecord[] {
  return records.map((record) => ({
    ...record,
    sourceEventIds: [...record.sourceEventIds],
  }));
}
