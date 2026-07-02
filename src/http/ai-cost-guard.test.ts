import { describe, expect, it } from "vitest";
import {
  FixedWindowBudgetLimiter,
  FixedWindowRateLimiter,
  SessionSlotLimiter,
} from "../server-security.js";
import { AiCostGuard } from "./ai-cost-guard.js";

describe("AiCostGuard", () => {
  it("acquires global session capacity and returns a keyed release", () => {
    const slots = new SessionSlotLimiter(1, 1000);
    const guard = new AiCostGuard({ sessionSlots: slots });

    const first = guard.acquire({ sessionId: "solo-1" }, 0);
    expect(first.ok).toBe(true);
    expect(slots.count(0)).toBe(1);
    expect(guard.acquire({ sessionId: "solo-2" }, 0)).toEqual({
      ok: false,
      status: 503,
      reason: "SESSION_CAPACITY",
      error: "Server is at capacity; try again shortly.",
    });

    if (first.ok) first.release();
    expect(guard.acquire({ sessionId: "solo-2" }, 0).ok).toBe(true);
  });

  it("checks global room and player AI budgets transactionally", () => {
    const globalBudget = new FixedWindowBudgetLimiter(1, 1000);
    const roomBudget = new FixedWindowBudgetLimiter(1, 1000);
    const playerBudget = new FixedWindowBudgetLimiter(1, 1000);
    const guard = new AiCostGuard({ globalBudget, roomBudget, playerBudget });

    expect(guard.acquire({ roomId: "room-1", playerId: "player-1" }, 0).ok).toBe(true);
    expect(guard.acquire({ roomId: "room-2", playerId: "player-2" }, 0)).toMatchObject({
      ok: false,
      status: 503,
      reason: "GLOBAL_AI_BUDGET",
    });

    // The failed second acquire did not consume room/player budget.
    expect(roomBudget.tryConsume("room-2", 1, 0)).toBe(true);
    expect(playerBudget.tryConsume("room-2:player-2", 1, 0)).toBe(true);
  });

  it("applies optional endpoint rate limits before expensive capacity", () => {
    const endpointLimiter = new FixedWindowRateLimiter(1, 1000);
    const slots = new SessionSlotLimiter(1, 1000);
    const guard = new AiCostGuard({
      endpointLimiter,
      sessionSlots: slots,
      endpointRateReason: "SOLO_ACTION_RATE",
    });

    expect(guard.acquire({ sessionId: "solo-1", endpointKey: "ip" }, 0).ok).toBe(true);
    expect(guard.acquire({ sessionId: "solo-2", endpointKey: "ip" }, 0)).toMatchObject({
      ok: false,
      status: 429,
      reason: "SOLO_ACTION_RATE",
    });
    expect(slots.count(0)).toBe(1);
  });
});
