import { describe, expect, it } from "vitest";
import {
  CliTimeoutError,
  DEFAULT_CLI_TIMEOUT_MS,
  resolveCliTimeoutMs,
  withTimeout,
} from "./cli-timeout.js";

describe("withTimeout — CLI call timeout/cancellation", () => {
  it("passes through the result when the op settles before the deadline", async () => {
    const result = await withTimeout(async () => "ok", 1_000, "test");
    expect(result).toBe("ok");
  });

  it("rejects with CliTimeoutError and aborts the signal when the op hangs", async () => {
    let aborted = false;
    const hung = withTimeout(
      (signal) =>
        new Promise<never>(() => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
        }),
      20,
      "hung cli",
    );
    await expect(hung).rejects.toBeInstanceOf(CliTimeoutError);
    expect(aborted).toBe(true);
  });

  it("passes through op rejections unchanged", async () => {
    const boom = new Error("boom");
    await expect(withTimeout(() => Promise.reject(boom), 1_000, "test")).rejects.toBe(boom);
  });

  it("disables the timeout when timeoutMs is 0 or negative", async () => {
    const result = await withTimeout(
      (signal) => Promise.resolve(signal.aborted ? "aborted" : "ran"),
      0,
      "no deadline",
    );
    expect(result).toBe("ran");
  });
});

describe("resolveCliTimeoutMs — AI_GM_TIMEOUT_MS", () => {
  it("falls back to the default when unset or invalid", () => {
    expect(resolveCliTimeoutMs({})).toBe(DEFAULT_CLI_TIMEOUT_MS);
    expect(resolveCliTimeoutMs({ AI_GM_TIMEOUT_MS: "abc" })).toBe(DEFAULT_CLI_TIMEOUT_MS);
    expect(resolveCliTimeoutMs({ AI_GM_TIMEOUT_MS: "-5" })).toBe(DEFAULT_CLI_TIMEOUT_MS);
  });

  it("honors a positive override and the 0 disable sentinel", () => {
    expect(resolveCliTimeoutMs({ AI_GM_TIMEOUT_MS: "45000" })).toBe(45_000);
    expect(resolveCliTimeoutMs({ AI_GM_TIMEOUT_MS: "0" })).toBe(0);
  });
});
