import { describe, it, expect } from "vitest";
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  FixedWindowRateLimiter,
  FixedWindowBudgetLimiter,
  InFlightKeyLock,
  SessionSlotLimiter,
  buildPublicInviteLink,
  checkStartupSafety,
  isLoopbackHost,
  isStateChangingRequestCsrfSafe,
  playtestToken,
  readBoundedText,
  resolveBinding,
  resolveTrustProxy,
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

describe("buildPublicInviteLink", () => {
  it("keeps bearer credentials out of copied invite URLs", () => {
    const link = buildPublicInviteLink("https", "ready.example", "invite-1", "super-secret");

    expect(link).toBe("https://ready.example/join/invite-1");
    expect(link).not.toContain("token=");
    expect(link).not.toContain("super-secret");
  });

  it("encodes only the invite code path segment", () => {
    expect(buildPublicInviteLink("https", "ready.example", "a/b c")).toBe(
      "https://ready.example/join/a%2Fb%20c",
    );
  });
});

describe("resolveTrustProxy", () => {
  it("does not trust proxy headers unless explicitly configured", () => {
    expect(resolveTrustProxy({})).toBe(false);
    expect(resolveTrustProxy({ HOST: "0.0.0.0", PLAYTEST_TOKEN: "secret" })).toBe(false);
  });

  it("allows explicit trusted hop configuration for tunnel/proxy deployments", () => {
    expect(resolveTrustProxy({ TRUST_PROXY: "1" })).toBe(1);
    expect(resolveTrustProxy({ TRUST_PROXY: "true" })).toBe(1);
    expect(resolveTrustProxy({ TRUST_PROXY: "2" })).toBe(2);
    expect(resolveTrustProxy({ TRUST_PROXY: "loopback" })).toBe("loopback");
  });
});

describe("isStateChangingRequestCsrfSafe", () => {
  const target = "http://127.0.0.1:8787";

  it("rejects browser cross-origin state-changing requests", () => {
    expect(
      isStateChangingRequestCsrfSafe(
        { origin: "https://attacker.example", secFetchSite: "cross-site" },
        target,
      ),
    ).toBe(false);
  });

  it("allows same-origin and non-browser/no-origin state-changing requests", () => {
    expect(
      isStateChangingRequestCsrfSafe(
        { origin: "http://127.0.0.1:8787", secFetchSite: "same-origin" },
        target,
      ),
    ).toBe(true);
    expect(isStateChangingRequestCsrfSafe({}, target)).toBe(true);
    expect(isStateChangingRequestCsrfSafe({ secFetchSite: "none" }, target)).toBe(true);
  });
});

describe("readBoundedText", () => {
  it("trims required text and rejects blank input", () => {
    expect(readBoundedText("  hello  ", { field: "Action", maxLength: 10, required: true })).toEqual({
      ok: true,
      value: "hello",
    });
    expect(readBoundedText("   ", { field: "Action", maxLength: 10, required: true })).toEqual({
      ok: false,
      status: 400,
      error: "Action is required.",
    });
  });

  it("rejects overlong text before it can reach prompts or logs", () => {
    expect(readBoundedText("abcdef", { field: "Action", maxLength: 5, required: true })).toEqual({
      ok: false,
      status: 413,
      error: "Action is too long; max 5 characters.",
    });
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

describe("FixedWindowBudgetLimiter", () => {
  it("tracks weighted cost per key and rejects budget overflow inside the window", () => {
    const limiter = new FixedWindowBudgetLimiter(3, 1000);
    expect(limiter.tryConsume("room-1", 2, 0)).toBe(true);
    expect(limiter.tryConsume("room-1", 2, 100)).toBe(false);
    expect(limiter.tryConsume("room-1", 1, 200)).toBe(true);
  });

  it("resets budget once the window elapses and tracks keys independently", () => {
    const limiter = new FixedWindowBudgetLimiter(1, 1000);
    expect(limiter.tryConsume("room-1", 1, 0)).toBe(true);
    expect(limiter.tryConsume("room-1", 1, 999)).toBe(false);
    expect(limiter.tryConsume("room-2", 1, 999)).toBe(true);
    expect(limiter.tryConsume("room-1", 1, 1000)).toBe(true);
  });

  it("rejects invalid construction arguments and invalid costs", () => {
    expect(() => new FixedWindowBudgetLimiter(0, 1000)).toThrow(RangeError);
    expect(() => new FixedWindowBudgetLimiter(2, 0)).toThrow(RangeError);
    const limiter = new FixedWindowBudgetLimiter(2, 1000);
    expect(() => limiter.tryConsume("room-1", 0)).toThrow(RangeError);
    expect(() => limiter.tryConsume("room-1", 3)).toThrow(RangeError);
  });
});

describe("InFlightKeyLock", () => {
  it("allows only one in-flight operation per key until released", () => {
    const lock = new InFlightKeyLock();
    expect(lock.tryAcquire("solo-session")).toBe(true);
    expect(lock.tryAcquire("solo-session")).toBe(false);
    expect(lock.tryAcquire("other-session")).toBe(true);

    expect(lock.release("solo-session")).toBe(true);
    expect(lock.tryAcquire("solo-session")).toBe(true);
  });

  it("treats releasing an absent key as a no-op", () => {
    const lock = new InFlightKeyLock();
    expect(lock.release("missing")).toBe(false);
  });
});

describe("SessionSlotLimiter", () => {
  it("allows up to max concurrent slots within the TTL window", () => {
    const limiter = new SessionSlotLimiter(2, 1000);
    expect(limiter.tryAcquire("a", 0)).toBe(true);
    expect(limiter.tryAcquire("b", 100)).toBe(true);
    expect(limiter.tryAcquire("c", 200)).toBe(false);
    expect(limiter.count(200)).toBe(2);
  });

  it("frees slots automatically once their TTL elapses", () => {
    const limiter = new SessionSlotLimiter(1, 1000);
    expect(limiter.tryAcquire("a", 0)).toBe(true);
    expect(limiter.tryAcquire("b", 500)).toBe(false);
    expect(limiter.tryAcquire("b", 1001)).toBe(true); // first slot expired
    expect(limiter.count(1001)).toBe(1);
  });

  it("releases the requested slot id only", () => {
    const limiter = new SessionSlotLimiter(2, 1000);
    expect(limiter.tryAcquire("a", 0)).toBe(true);
    expect(limiter.tryAcquire("b", 0)).toBe(true);
    expect(limiter.release("b", 100)).toBe(true);
    expect(limiter.release("missing", 100)).toBe(false);
    expect(limiter.tryAcquire("c", 100)).toBe(true);
    expect(limiter.tryAcquire("d", 100)).toBe(false);
  });

  it("treats duplicate acquire for an already-held id as idempotent", () => {
    const limiter = new SessionSlotLimiter(1, 1000);
    expect(limiter.tryAcquire("a", 0)).toBe(true);
    expect(limiter.tryAcquire("a", 100)).toBe(true);
    expect(limiter.count(100)).toBe(1);
  });

  it("rejects invalid construction arguments", () => {
    expect(() => new SessionSlotLimiter(0, 1000)).toThrow(RangeError);
    expect(() => new SessionSlotLimiter(2, 0)).toThrow(RangeError);
  });
});
