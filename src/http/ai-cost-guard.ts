import type {
  FixedWindowBudgetLimiter,
  FixedWindowRateLimiter,
  SessionSlotLimiter,
} from "../server-security.js";

export type AiCostGuardReason =
  | "ENDPOINT_RATE_LIMIT"
  | "SESSION_CAPACITY"
  | "GLOBAL_AI_BUDGET"
  | "ROOM_AI_BUDGET"
  | "PLAYER_AI_BUDGET"
  | string;

export type AiCostGuardAcquireResult =
  | { ok: true; release(): void }
  | { ok: false; status: 429 | 503; reason: AiCostGuardReason; error: string };

export interface AiCostGuardKey {
  roomId?: string;
  sessionId?: string;
  playerId?: string;
  endpointKey?: string;
}

export interface AiCostGuardOptions {
  endpointLimiter?: FixedWindowRateLimiter;
  endpointRateReason?: AiCostGuardReason;
  sessionSlots?: SessionSlotLimiter;
  globalBudget?: FixedWindowBudgetLimiter;
  roomBudget?: FixedWindowBudgetLimiter;
  playerBudget?: FixedWindowBudgetLimiter;
}

export class AiCostGuard {
  constructor(private readonly options: AiCostGuardOptions) {}

  acquire(key: AiCostGuardKey, now: number = Date.now()): AiCostGuardAcquireResult {
    if (
      this.options.endpointLimiter !== undefined &&
      key.endpointKey !== undefined &&
      !this.options.endpointLimiter.tryAcquire(key.endpointKey, now)
    ) {
      return {
        ok: false,
        status: 429,
        reason: this.options.endpointRateReason ?? "ENDPOINT_RATE_LIMIT",
        error: "Too many requests; slow down.",
      };
    }

    const slotId = key.sessionId ?? key.roomId;
    let slotAcquired = false;
    if (this.options.sessionSlots !== undefined && slotId !== undefined) {
      if (!this.options.sessionSlots.tryAcquire(slotId, now)) {
        return {
          ok: false,
          status: 503,
          reason: "SESSION_CAPACITY",
          error: "Server is at capacity; try again shortly.",
        };
      }
      slotAcquired = true;
    }

    const consumed: Array<{ limiter: FixedWindowBudgetLimiter; key: string }> = [];
    const refundBudgets = (): void => {
      for (let i = consumed.length - 1; i >= 0; i -= 1) {
        const entry = consumed[i];
        if (entry !== undefined) entry.limiter.refund(entry.key, 1, now);
      }
    };
    const releaseSlot = (): void => {
      if (slotAcquired && slotId !== undefined) this.options.sessionSlots?.release(slotId, now);
    };

    const consume = (
      limiter: FixedWindowBudgetLimiter | undefined,
      budgetKey: string | undefined,
      failure: Exclude<AiCostGuardAcquireResult, { ok: true }>,
    ): AiCostGuardAcquireResult | undefined => {
      if (limiter === undefined || budgetKey === undefined) return undefined;
      if (limiter.tryConsume(budgetKey, 1, now)) {
        consumed.push({ limiter, key: budgetKey });
        return undefined;
      }
      refundBudgets();
      releaseSlot();
      return failure;
    };

    const global = consume(this.options.globalBudget, "global", {
      ok: false,
      status: 503,
      reason: "GLOBAL_AI_BUDGET",
      error: "Server AI budget is exhausted; try again shortly.",
    });
    if (global !== undefined) return global;

    const room = consume(this.options.roomBudget, key.roomId ?? key.sessionId, {
      ok: false,
      status: 429,
      reason: "ROOM_AI_BUDGET",
      error: "Room AI budget is exhausted; slow down.",
    });
    if (room !== undefined) return room;

    const playerBudgetKey =
      key.playerId !== undefined ? `${key.roomId ?? key.sessionId ?? "unknown"}:${key.playerId}` : undefined;
    const player = consume(this.options.playerBudget, playerBudgetKey, {
      ok: false,
      status: 429,
      reason: "PLAYER_AI_BUDGET",
      error: "Player AI budget is exhausted; slow down.",
    });
    if (player !== undefined) return player;

    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        releaseSlot();
      },
    };
  }
}
