import { describe, it, expect } from "vitest";
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  FixedWindowRateLimiter,
  SessionSlotLimiter,
  checkStartupSafety,
  isLoopbackHost,
  playtestToken,
  resolveBinding,
  tokenMatches,
} from "./server-security.js";

describe("resolveBinding", () => {
  it("defaults to loopback host and the default port when env is empty", () => {
    const binding = resolveBinding({});
    expect(binding).toEqual({ host: DEFAULT_HOST, port: DEFAULT_PORT, isLoopback: true });
  });

  it("honours PORT/HOST overrides", () => {
    const binding = resolveBinding({ PORT: "9000", HOST: "0.0.0.0" });
    expect(binding.port).toBe(9000);
    expect(binding.host).toBe("0.0.0.0");
    expect(binding.isLoopback).toBe(false);
  });

  it("falls back to defaults for invalid PORT and blank HOST", () => {
    expect(resolveBinding({ PORT: "not-a-number" }).port).toBe(DEFAULT_PORT);
    expect(resolveBinding({ PORT: "0" }).port).toBe(DEFAULT_PORT);
    expect(resolveBinding({ PORT: "70000" }).port).toBe(DEFAULT_PORT);
    expect(resolveBinding({ HOST: "   " }).host).toBe(DEFAULT_HOST);
  });

  it("treats 127.0.0.1, ::1, and localhost as loopback", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("LOCALHOST")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("10.0.0.5")).toBe(false);
  });
});

describe("playtestToken", () => {
  it("returns the trimmed token or undefined when unset/blank", () => {
    expect(playtestToken({})).toBeUndefined();
    expect(playtestToken({ PLAYTEST_TOKEN: "   " })).toBeUndefined();
    expect(playtestToken({ PLAYTEST_TOKEN: "  secret  " })).toBe("secret");
  });
});

describe("checkStartupSafety", () => {
  it("allows a loopback bind with no token (local-only default)", () => {
    const result = checkStartupSafety({});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toHaveLength(0);
  });

  it("refuses a non-loopback bind without a token", () => {
    const result = checkStartupSafety({ HOST: "0.0.0.0" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("PLAYTEST_TOKEN");
  });

  it("allows a non-loopback bind once a token is set, with a warning", () => {
    const result = checkStartupSafety({ HOST: "0.0.0.0", PLAYTEST_TOKEN: "secret" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
      expect(result.warnings[0]).toContain("network");
    }
  });
});

describe("tokenMatches", () => {
  it("permits any request when no token is configured (auth disabled)", () => {
    expect(tokenMatches(undefined, undefined)).toBe(true);
    expect(tokenMatches(undefined, "anything")).toBe(true);
  });

  it("requires an exact match when a token is configured", () => {
    expect(tokenMatches("secret", "secret")).toBe(true);
    expect(tokenMatches("secret", "wrong")).toBe(false);
    expect(tokenMatches("secret", "secre")).toBe(false); // length mismatch
    expect(tokenMatches("secret", "")).toBe(false);
    expect(tokenMatches("secret", undefined)).toBe(false);
  });
});

describe("FixedWindowRateLimiter", () => {
  it("allows up to the limit per window, then rejects", () => {
    const limiter = new FixedWindowRateLimiter(3, 1000);
    expect(limiter.tryAcquire("ip", 0)).toBe(true);
    expect(limiter.tryAcquire("ip", 100)).toBe(true);
    expect(limiter.tryAcquire("ip", 200)).toBe(true);
    expect(limiter.tryAcquire("ip", 300)).toBe(false);
  });

  it("resets the window once it elapses", () => {
    const limiter = new FixedWindowRateLimiter(1, 1000);
    expect(limiter.tryAcquire("ip", 0)).toBe(true);
    expect(limiter.tryAcquire("ip", 500)).toBe(false);
    expect(limiter.tryAcquire("ip", 1000)).toBe(true);
  });

  it("tracks distinct keys independently", () => {
    const limiter = new FixedWindowRateLimiter(1, 1000);
    expect(limiter.tryAcquire("a", 0)).toBe(true);
    expect(limiter.tryAcquire("b", 0)).toBe(true);
    expect(limiter.tryAcquire("a", 0)).toBe(false);
  });

  it("rejects invalid construction arguments", () => {
    expect(() => new FixedWindowRateLimiter(0, 1000)).toThrow(RangeError);
    expect(() => new FixedWindowRateLimiter(5, 0)).toThrow(RangeError);
  });
});

describe("SessionSlotLimiter", () => {
  it("allows up to max concurrent slots within the TTL window", () => {
    const limiter = new SessionSlotLimiter(2, 1000);
    expect(limiter.tryAcquire(0)).toBe(true);
    expect(limiter.tryAcquire(100)).toBe(true);
    expect(limiter.tryAcquire(200)).toBe(false);
    expect(limiter.count(200)).toBe(2);
  });

  it("frees slots automatically once their TTL elapses", () => {
    const limiter = new SessionSlotLimiter(1, 1000);
    expect(limiter.tryAcquire(0)).toBe(true);
    expect(limiter.tryAcquire(500)).toBe(false);
    expect(limiter.tryAcquire(1001)).toBe(true); // first slot expired
    expect(limiter.count(1001)).toBe(1);
  });

  it("rejects invalid construction arguments", () => {
    expect(() => new SessionSlotLimiter(0, 1000)).toThrow(RangeError);
    expect(() => new SessionSlotLimiter(2, 0)).toThrow(RangeError);
  });
});
