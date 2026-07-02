/**
 * Shared deterministic random helpers.
 *
 * The primitives here are intentionally dependency-free and stable across
 * platforms. Existing card dealing depends on the exact FNV-1a + mulberry32
 * sequence, so do not change these algorithms without updating compatibility
 * tests and migration expectations.
 */

/**
 * FNV-1a hash of a string to an unsigned 32-bit integer.
 */
export function fnv1a32(seed: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * mulberry32 PRNG. Given a 32-bit seed it returns floats in [0, 1).
 */
export function mulberry32(seedInt: number): () => number {
  let a = seedInt >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Return a Fisher-Yates shuffled copy of `items`, leaving the input untouched. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const seedString = typeof seed === "string" ? seed : String(seed ?? "");
  const random = mulberry32(fnv1a32(seedString));
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }
  return shuffled;
}

/** Return up to `count` items from the deterministic shuffled order. */
export function seededPick<T>(items: readonly T[], count: number, seed: string): T[] {
  const size = Number.isInteger(count) && count > 0 ? count : 0;
  return seededShuffle(items, seed).slice(0, size);
}
