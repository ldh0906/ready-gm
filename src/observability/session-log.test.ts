import { describe, expect, it } from "vitest";
import { sanitizeSessionLogEntry, sessionLogEnabled } from "./session-log.js";

describe("sessionLogEnabled", () => {
  it("is disabled by default unless explicitly enabled", () => {
    expect(sessionLogEnabled({})).toBe(false);
    expect(sessionLogEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(sessionLogEnabled({ SESSION_LOG: "1" })).toBe(true);
    expect(sessionLogEnabled({ SESSION_LOG: "true" })).toBe(true);
  });

  it("honors explicit off values", () => {
    expect(sessionLogEnabled({ SESSION_LOG: "0" })).toBe(false);
    expect(sessionLogEnabled({ SESSION_LOG: "off" })).toBe(false);
  });
});

describe("sanitizeSessionLogEntry", () => {
  it("redacts credential-looking fields and truncates long free text", () => {
    const long = "a".repeat(260);

    expect(
      sanitizeSessionLogEntry({
        token: "secret",
        ticket: "player-ticket",
        connectionToken: "connection-ticket",
        action: long,
        nested: { playtestToken: "global", text: long },
      }),
    ).toEqual({
      token: "[REDACTED]",
      ticket: "[REDACTED]",
      connectionToken: "[REDACTED]",
      action: `${"a".repeat(200)}...[truncated]`,
      nested: { playtestToken: "[REDACTED]", text: `${"a".repeat(200)}...[truncated]` },
    });
  });
});
