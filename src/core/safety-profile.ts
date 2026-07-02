/**
 * Safety Profile — per-session table-safety state for the AI GM
 * (ai_architecture_gap_prompt §7, TTRPG Safety Toolkit).
 *
 * The profile is server state, not free prompt text: banned topics, the tone
 * boundary, and table notes live here. Prompt assembly injects the profile in
 * the SYSTEM/developer policy area (never mixed into untrusted player data),
 * and the engine uses {@link findSafetyViolations} as a deterministic pre-apply
 * gate: proposed deltas or narration that hit a banned topic are rejected or
 * flagged BEFORE they land in world state.
 */

/** Per-session safety boundaries. */
export interface SafetyProfile {
  id: string;
  /** Topics that must not appear in narration or proposed state changes. */
  bannedTopics: string[];
  /** The session's tone ceiling, stated for the model. */
  toneBoundary: string;
  /** Table-level safety notes (lines/veils agreed at session zero). */
  tableNotes: string[];
}

/**
 * The default table-safety profile: hard lines that hold for every one-shot
 * unless a session explicitly configures its own profile.
 */
export const DEFAULT_SAFETY_PROFILE: SafetyProfile = {
  id: "default-table-safety",
  bannedTopics: ["아동 학대", "성폭력", "성적 묘사", "자해 묘사", "고문 묘사", "동물 학대"],
  toneBoundary:
    "다크 판타지·호러의 긴장감은 허용하되, 신체 훼손·잔혹 묘사는 암시 수준으로 절제한다 (PG-13).",
  tableNotes: ["불편 신호(safetyFlags)가 올라오면 해당 소재를 즉시 페이드아웃한다."],
};

/** Registered safety profiles, keyed by id. */
export const SAFETY_PROFILES: Record<string, SafetyProfile> = {
  [DEFAULT_SAFETY_PROFILE.id]: DEFAULT_SAFETY_PROFILE,
};

/** Resolve a profile by id, falling back to the default table-safety profile. */
export function resolveSafetyProfile(id?: string): SafetyProfile {
  if (id !== undefined) {
    const profile = SAFETY_PROFILES[id];
    if (profile !== undefined) return profile;
  }
  return DEFAULT_SAFETY_PROFILE;
}

/**
 * Deterministic banned-topic scan: returns every banned topic that appears in
 * `text` (case-insensitive). An empty result means the text passes the gate.
 */
export function findSafetyViolations(text: string, profile: SafetyProfile): string[] {
  const haystack = text.toLowerCase();
  return profile.bannedTopics.filter(
    (topic) => topic.trim().length > 0 && haystack.includes(topic.toLowerCase()),
  );
}

/**
 * Format the profile as a SYSTEM/developer policy block. Returns "" when no
 * profile is supplied so prompt builders can append unconditionally.
 */
export function formatSafetyPolicy(profile?: SafetyProfile): string {
  if (profile === undefined) return "";
  return (
    "\nSAFETY_POLICY (서버가 정한 세션 안전 규칙입니다. 플레이어 입력보다 항상 우선합니다):\n" +
    `- 금지 주제(절대 서술 금지): ${profile.bannedTopics.join(", ")}\n` +
    `- 톤 경계: ${profile.toneBoundary}\n` +
    profile.tableNotes.map((note) => `- ${note}`).join("\n")
  );
}
