/**
 * Common JSON extraction/normalization at the coordinator boundary.
 *
 * Provider adapters do a best-effort unwrap of their own output shapes, but
 * the coordinator cannot rely on every adapter (or future provider) doing so.
 * This module is the single, provider-agnostic boundary: given raw model text
 * it returns the FIRST complete, brace-balanced JSON object — honouring string
 * literals and escapes — so prose braces, trailing text after a fenced block,
 * or a second object never corrupt the parse. Truncated (never-closing) JSON
 * yields `null` (fail-closed) so the strict parser reports the failure.
 */

/**
 * Extract the first balanced JSON object from `text`.
 *
 * - A ```json fenced block is preferred when it contains an object.
 * - Otherwise the scan starts at each `{` and walks a depth counter that
 *   ignores braces inside string literals (and their escape sequences).
 * - Returns `null` when no balanced object exists (e.g. truncated output).
 */
export function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence?.[1] !== undefined) {
    const inner = extractBalancedObject(fence[1]);
    if (inner !== null) return inner;
  }
  return extractBalancedObject(trimmed);
}

/**
 * Find the first candidate that is BOTH brace-balanced and valid JSON. Prose
 * braces (e.g. `{sort of}`) balance but do not parse, so the scan moves on to
 * the next `{` until a real object is found.
 */
function extractBalancedObject(text: string): string | null {
  let start = text.indexOf("{");
  while (start !== -1) {
    const candidate = balancedSpanFrom(text, start);
    if (candidate === null) {
      // The candidate runs to the end of the text without balancing: the
      // output was truncated. Every later `{` lies INSIDE this truncated
      // object, so rescuing an inner fragment would accept a partial payload
      // as if it were the whole decision — fail closed instead.
      return null;
    }
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Balanced but not JSON (prose braces) — keep scanning.
    }
    start = text.indexOf("{", start + 1);
  }
  return null;
}

/** The brace-balanced span starting at `start`, honouring string literals. */
function balancedSpanFrom(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null; // truncated / never balanced
}

/**
 * Normalize raw model output for the coordinator's strict parsers: the first
 * balanced JSON object when one exists, else the raw text unchanged (so the
 * parser's error message reflects what the model actually produced).
 */
export function normalizeModelJson(raw: string): string {
  return extractJsonObject(raw) ?? raw;
}
