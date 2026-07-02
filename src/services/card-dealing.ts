/**
 * Deterministic per-player card-hand dealing for Card_Based_Sheets.
 *
 * Card-based scenarios (currently "가라앉을 때까지" / until-it-sinks) ship a
 * Character_Card_List. To reduce collisions between players while keeping the
 * experience reproducible, each player is dealt a small random hand of distinct
 * cards derived deterministically from a seed (typically `roomId + ":" + playerId`).
 *
 * The dealing is a pure function with NO external dependencies: the seed string
 * is hashed to a 32-bit integer (FNV-1a), that integer seeds a `mulberry32`
 * PRNG, and the PRNG drives a Fisher–Yates shuffle of the card indices. Cards
 * whose id is already taken (confirmed by another player) are skipped so the
 * next available card slides into the hand automatically.
 *
 * The function never mutates its inputs and never throws.
 */
import { seededShuffle } from "./seeded-random.js";
import type { CharacterCard } from "./sheet-schema.js";

/**
 * Deal a deterministic random hand of up to `handSize` distinct cards for a
 * player, skipping any card whose id is in `takenIds`.
 *
 * Contract:
 * - Deterministic: identical `(allCards, seed, takenIds)` → identical hand
 *   (including order).
 * - Returns cards whose `id` is NOT in `takenIds`, walked in the seeded shuffle
 *   order, until `handSize` are collected or the deck is exhausted. Length is
 *   `min(handSize, |available cards|)`.
 * - Defensive: a non-array `allCards` → `[]`; a non-array `takenIds` is treated
 *   as `[]`; cards with a blank/non-string id or a duplicate id are ignored
 *   (deduped by id, first occurrence wins).
 * - Pure: no input is mutated; the function never throws.
 *
 * @param allCards The full Character_Card_List to deal from.
 * @param seed The seed string (typically `roomId + ":" + playerId`).
 * @param takenIds Card ids already confirmed by other players (excluded).
 * @param handSize Maximum number of cards to deal (default 3).
 */
export function dealCardHand(
  allCards: CharacterCard[],
  seed: string,
  takenIds: string[],
  handSize = 3,
): CharacterCard[] {
  if (!Array.isArray(allCards)) return [];

  // Dedupe by trimmed id (first wins); ignore cards with a blank/non-string id.
  const seenIds = new Set<string>();
  const cards: CharacterCard[] = [];
  for (const card of allCards) {
    const id = typeof card?.id === "string" ? card.id.trim() : "";
    if (id.length === 0) continue;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    cards.push(card);
  }
  if (cards.length === 0) return [];

  // Build the set of taken (trimmed) ids; non-array → none taken.
  const taken = new Set<string>();
  if (Array.isArray(takenIds)) {
    for (const raw of takenIds) {
      if (typeof raw === "string" && raw.trim().length > 0) {
        taken.add(raw.trim());
      }
    }
  }

  const seedString = typeof seed === "string" ? seed : String(seed ?? "");
  const order = seededShuffle(cards.map((_, index) => index), seedString);

  const size = Number.isInteger(handSize) && handSize > 0 ? handSize : 0;
  const hand: CharacterCard[] = [];
  for (const index of order) {
    if (hand.length >= size) break;
    const card = cards[index];
    if (taken.has(card.id.trim())) continue;
    hand.push(card);
  }
  return hand;
}
