/**
 * Shared name-normalization used for room-unique comparisons.
 *
 * Both player display names (Requirement 2.6) and character names
 * (Requirement 4.6) must be unique within a room. Historically the two used
 * different comparison policies (case-sensitive exact vs. trim+lowercase),
 * which let "Alice"/"alice" coexist as display names but not as character
 * names. They now share this single normalization so uniqueness behaves
 * consistently across the room (S6).
 */

/**
 * Normalize a name for room-unique comparison: trim surrounding whitespace and
 * lowercase. The normalized form is used ONLY for collision detection — callers
 * preserve the original casing in what they store/return.
 */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}
