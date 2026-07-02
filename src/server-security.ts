/**
 * Server hardening helpers for the playtest entrypoint ({@link import("./server.js")}).
 *
 * The playtest server seeds a room AND kicks off a Codex GM opening generation
 * on every `POST /play/new`, so an unauthenticated, publicly-reachable instance
 * can be driven to burn CPU, local `codex` processes, and ChatGPT-account tokens
 * by request volume alone. These pure, side-effect-free helpers give the
 * entrypoint the levers it needs to defend that surface while staying trivially
 * unit-testable (no sockets, no real clock):
 *
 *  - {@link resolveBinding} — bind to loopback (`127.0.0.1`) by default so the
 *    server is NOT exposed on the network unless explicitly opted in via `HOST`.
 *  - {@link checkStartupSafety} — refuse to start when bound to a non-loopback
 *    host without a `PLAYTEST_TOKEN`, so a public bind always requires auth.
 *  - {@link tokenMatches} — constant-time shared-secret check for `/play/new`
 *    and the WebSocket upgrade.
 *  - {@link FixedWindowRateLimiter} — per-IP request cap to bound burst abuse.
 *  - {@link SessionSlotLimiter} — global cap on recent session starts to bound
 *    concurrent AI generation cost regardless of source IP.
 */
import { URL } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

/** Environment surface these helpers read; mirrors `process.env`'s shape. */
export type EnvLike = Record<string, string | undefined>;

/** Default listen port when `PORT` is unset or invalid. */
export const DEFAULT_PORT = 8787;
/** Default listen host: loopback only, so the server is not network-exposed. */
export const DEFAULT_HOST = "127.0.0.1";

/** Hosts that keep the server reachable only from the local machine. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/** The resolved listen address plus whether it is loopback-only. */
export interface ServerBinding {
  readonly host: string;
  readonly port: number;
  /** True when the host is reachable only from the local machine. */
  readonly isLoopback: boolean;
}

/** Whether a host string binds to loopback only (vs. a network-reachable address). */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

/**
 * Resolve the listen address from the environment. `PORT`/`HOST` override the
 * defaults; an invalid `PORT` falls back to {@link DEFAULT_PORT} and a blank
 * `HOST` falls back to loopback so the server is never accidentally public.
 */
export function resolveBinding(env: EnvLike): ServerBinding {
  const rawPort = env.PORT?.trim();
  const parsedPort = rawPort !== undefined && rawPort !== "" ? Number(rawPort) : NaN;
  const port =
    Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535
      ? parsedPort
      : DEFAULT_PORT;

  const host = env.HOST?.trim() ? env.HOST.trim() : DEFAULT_HOST;

  return { host, port, isLoopback: isLoopbackHost(host) };
}

/** The configured shared secret, or `undefined` when auth is disabled. */
export function playtestToken(env: EnvLike): string | undefined {
  const token = env.PLAYTEST_TOKEN?.trim();
  return token !== undefined && token !== "" ? token : undefined;
}

/** Result of the startup safety check. */
export type StartupSafety =
  | { readonly ok: true; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Decide whether it is safe to start with the given environment. A non-loopback
 * bind (network-reachable) MUST set `PLAYTEST_TOKEN`; otherwise startup is
 * refused so the AI-cost surface is never exposed anonymously. A loopback bind
 * is always allowed and a public bind with a token is allowed with a warning.
 */
export function checkStartupSafety(env: EnvLike): StartupSafety {
  const { host, isLoopback } = resolveBinding(env);
  const token = playtestToken(env);

  if (!isLoopback && token === undefined) {
    return {
      ok: false,
      reason:
        `Refusing to bind to non-loopback host "${host}" without PLAYTEST_TOKEN. ` +
        `Set PLAYTEST_TOKEN to require a shared secret before exposing the ` +
        `playtest server, or bind to ${DEFAULT_HOST} (the default) for local-only use.`,
    };
  }

  const warnings: string[] = [];
  if (!isLoopback) {
    warnings.push(
      `Server is bound to non-loopback host "${host}" and is reachable from the ` +
        `network. Access requires the PLAYTEST_TOKEN shared secret; per-IP rate ` +
        `limits and a global session cap are enforced.`,
    );
  }
  return { ok: true, warnings };
}

/**
 * Constant-time shared-secret comparison. Returns `true` when no token is
 * configured (auth disabled), and otherwise only when `provided` exactly equals
 * `expected`. Uses {@link timingSafeEqual} to avoid leaking length/content via
 * comparison timing.
 */
export function tokenMatches(expected: string | undefined, provided: string | undefined): boolean {
  if (expected === undefined) return true; // auth disabled
  if (typeof provided !== "string" || provided.length === 0) return false;

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false; // timingSafeEqual requires equal lengths
  return timingSafeEqual(a, b);
}

/**
 * Build a copied invite URL from the room invite code only. The global
 * PLAYTEST_TOKEN is deliberately not embedded in the URL; invite-code exchange
 * and server-issued connection tickets carry participant authorization after
 * the invite is opened.
 */
export function buildPublicInviteLink(
  protocol: string,
  host: string,
  inviteToken: string,
  _playtestToken?: string,
): string {
  const safeProtocol = protocol.endsWith(":") ? protocol.slice(0, -1) : protocol;
  return `${safeProtocol}://${host}/join/${encodeURIComponent(inviteToken)}`;
}

/** Express `trust proxy` setting derived from explicit operator intent. */
export type TrustProxySetting = false | number | string;

/**
 * Resolve Express' `trust proxy` setting. The safe default is `false`: direct
 * public binds must not accept spoofable `X-Forwarded-For` as the client IP.
 * Tunnel/proxy deployments can opt in with `TRUST_PROXY=1`, another positive
 * hop count, or an Express trust-proxy subnet label such as `loopback`.
 */
export function resolveTrustProxy(env: EnvLike): TrustProxySetting {
  const raw = env.TRUST_PROXY?.trim();
  if (raw === undefined || raw === "") return false;
  const lower = raw.toLowerCase();
  if (lower === "0" || lower === "false" || lower === "off" || lower === "no") return false;
  if (lower === "1" || lower === "true" || lower === "on" || lower === "yes") return 1;
  const hops = Number(lower);
  if (Number.isInteger(hops) && hops > 0) return hops;
  return raw;
}

export interface CsrfRequestHeaders {
  readonly origin?: string | undefined;
  readonly secFetchSite?: string | undefined;
}

/** True when a browser state-changing request is same-origin or non-browser. */
export function isStateChangingRequestCsrfSafe(
  headers: CsrfRequestHeaders,
  targetOrigin: string,
): boolean {
  const secFetchSite = headers.secFetchSite?.trim().toLowerCase();
  if (secFetchSite === "cross-site" || secFetchSite === "same-site") return false;

  const origin = headers.origin?.trim();
  if (origin !== undefined && origin.length > 0) {
    try {
      return new URL(origin).origin === new URL(targetOrigin).origin;
    } catch {
      return false;
    }
  }

  return (
    secFetchSite === undefined ||
    secFetchSite === "" ||
    secFetchSite === "none" ||
    secFetchSite === "same-origin"
  );
}

export type BoundedTextResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly status: 400 | 413; readonly error: string };

export interface BoundedTextOptions {
  readonly field: string;
  readonly maxLength: number;
  readonly required?: boolean;
  readonly trim?: boolean;
}

/** Normalize and cap untrusted text before it reaches prompts, logs, or state. */
export function readBoundedText(value: unknown, options: BoundedTextOptions): BoundedTextResult {
  if (!Number.isInteger(options.maxLength) || options.maxLength < 1) {
    throw new RangeError(`maxLength must be a positive integer, got ${options.maxLength}`);
  }
  const raw = typeof value === "string" ? value : "";
  const text = options.trim === false ? raw : raw.trim();
  if (options.required === true && text.length === 0) {
    return { ok: false, status: 400, error: `${options.field} is required.` };
  }
  if (text.length > options.maxLength) {
    return {
      ok: false,
      status: 413,
      error: `${options.field} is too long; max ${options.maxLength} characters.`,
    };
  }
  return { ok: true, value: text };
}

/**
 * A fixed-window per-key request limiter. Each key (e.g. a client IP) may make
 * at most `limit` calls per `windowMs`; the window resets once it elapses.
 * Expired keys are pruned lazily on access so memory stays bounded under churn.
 */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new RangeError(`limit must be a positive integer, got ${limit}`);
    }
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new RangeError(`windowMs must be a positive number, got ${windowMs}`);
    }
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /**
   * Try to consume one request slot for `key`. Returns `true` when allowed and
   * `false` when the key has exhausted its window.
   */
  tryAcquire(key: string, now: number = Date.now()): boolean {
    this.prune(now);
    const existing = this.windows.get(key);
    if (existing === undefined || now >= existing.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (existing.count >= this.limit) {
      return false;
    }
    existing.count += 1;
    return true;
  }

  /** Drop windows that have fully elapsed so the map does not grow unbounded. */
  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (now >= window.resetAt) {
        this.windows.delete(key);
      }
    }
  }
}

/**
 * Fixed-window weighted budget for AI-cost surfaces. Unlike a request-count
 * limiter, one caller may consume more than one unit (for example, a route that
 * fans out to multiple model calls) while still sharing a simple per-key cap.
 */
export class FixedWindowBudgetLimiter {
  private readonly windows = new Map<string, { used: number; resetAt: number }>();
  private readonly budget: number;
  private readonly windowMs: number;

  constructor(budget: number, windowMs: number) {
    if (!Number.isInteger(budget) || budget <= 0) {
      throw new RangeError(`budget must be a positive integer, got ${budget}`);
    }
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new RangeError(`windowMs must be a positive number, got ${windowMs}`);
    }
    this.budget = budget;
    this.windowMs = windowMs;
  }

  /**
   * Try to consume `cost` units for `key`. Returns `false` when that cost would
   * exceed the key's current fixed-window budget.
   */
  tryConsume(key: string, cost = 1, now: number = Date.now()): boolean {
    this.assertValidCost(cost);
    this.prune(now);
    const existing = this.windows.get(key);
    if (existing === undefined || now >= existing.resetAt) {
      this.windows.set(key, { used: cost, resetAt: now + this.windowMs });
      return true;
    }
    if (existing.used + cost > this.budget) {
      return false;
    }
    existing.used += cost;
    return true;
  }

  /**
   * Return previously consumed units for `key`. This keeps multi-axis budget
   * checks transactional when a later global/room/player axis rejects a request.
   */
  refund(key: string, cost = 1, now: number = Date.now()): boolean {
    this.assertValidCost(cost);
    this.prune(now);
    const existing = this.windows.get(key);
    if (existing === undefined) return false;
    existing.used = Math.max(0, existing.used - cost);
    if (existing.used === 0) this.windows.delete(key);
    return true;
  }

  /** Drop elapsed windows lazily so churn does not grow memory forever. */
  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (now >= window.resetAt) {
        this.windows.delete(key);
      }
    }
  }

  private assertValidCost(cost: number): void {
    if (!Number.isInteger(cost) || cost <= 0 || cost > this.budget) {
      throw new RangeError(`cost must be an integer in [1, ${this.budget}], got ${cost}`);
    }
  }
}

/** A tiny per-key in-flight guard for non-reentrant expensive operations. */
export class InFlightKeyLock {
  private readonly held = new Set<string>();

  /** Acquire `key` if no operation currently holds it. */
  tryAcquire(key: string): boolean {
    if (this.held.has(key)) return false;
    this.held.add(key);
    return true;
  }

  /** Release `key`; returns whether a held lock existed. */
  release(key: string): boolean {
    return this.held.delete(key);
  }
}

/**
 * A global cap on how many sessions may be started within a sliding TTL window.
 * Each `/play/new` triggers a Codex opening generation, so this bounds the total
 * concurrent AI cost regardless of how requests are distributed across IPs. A
 * slot is held for `ttlMs` (roughly a session's active lifetime) and then frees
 * automatically, so the cap behaves like "at most `max` recently-started
 * sessions" without needing an explicit per-session completion signal.
 */
export class SessionSlotLimiter {
  /** Acquisition timestamps of currently-held slots, keyed by session/room id. */
  private readonly held = new Map<string, number>();
  private readonly max: number;
  private readonly ttlMs: number;

  constructor(max: number, ttlMs: number) {
    if (!Number.isInteger(max) || max <= 0) {
      throw new RangeError(`max must be a positive integer, got ${max}`);
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new RangeError(`ttlMs must be a positive number, got ${ttlMs}`);
    }
    this.max = max;
    this.ttlMs = ttlMs;
  }

  /**
   * Try to acquire a session slot. Returns `true` when below the cap (slot is
   * held for `ttlMs`) and `false` when the cap is currently reached.
   */
  tryAcquire(id: string, now: number = Date.now()): boolean {
    this.pruneExpired(now);
    if (this.held.has(id)) {
      this.held.set(id, now);
      return true;
    }
    if (this.held.size >= this.max) {
      return false;
    }
    this.held.set(id, now);
    return true;
  }

  /** Number of slots currently held (after pruning expired ones). */
  count(now: number = Date.now()): number {
    this.pruneExpired(now);
    return this.held.size;
  }

  /**
   * Release the slot for one session id, e.g. when that session ends before its
   * TTL elapses, so finished sessions free capacity for new ones.
   */
  release(id: string, now: number = Date.now()): boolean {
    this.pruneExpired(now);
    return this.held.delete(id);
  }

  /** Remove slots whose TTL has elapsed. */
  private pruneExpired(now: number): void {
    const cutoff = now - this.ttlMs;
    for (const [id, acquiredAt] of this.held) {
      if (acquiredAt <= cutoff) this.held.delete(id);
    }
  }
}
