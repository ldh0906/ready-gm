import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { DEFAULT_ENGINE_CONFIG, makeEngineConfig } from "./config.js";
import type { EngineConfig, RequestType } from "./types.js";

const REQUEST_TYPES: RequestType[] = ["opening", "attributes", "resolution", "ending"];

describe("DEFAULT_ENGINE_CONFIG", () => {
  it("uses the spec-mandated defaults", () => {
    expect(DEFAULT_ENGINE_CONFIG.readyCheckTimeoutMs).toBe(90000); // R8.4
    expect(DEFAULT_ENGINE_CONFIG.rollCheckTimeoutMs).toBe(20000);
    expect(DEFAULT_ENGINE_CONFIG.maxPlayers).toBe(6); // R1.4
    expect(DEFAULT_ENGINE_CONFIG.aiMaxRetries).toBe(2); // R17.1 (=> 3 total)
  });

  it("defines a model tier and token budget for every request type", () => {
    for (const rt of REQUEST_TYPES) {
      expect(DEFAULT_ENGINE_CONFIG.modelTiers[rt]).toBeDefined(); // R16.2
      expect(DEFAULT_ENGINE_CONFIG.tokenBudgets[rt]).toBeGreaterThan(0); // R16.3
    }
  });

  it("defines a valid dice range (min < max)", () => {
    expect(DEFAULT_ENGINE_CONFIG.diceRange.min).toBeLessThan(
      DEFAULT_ENGINE_CONFIG.diceRange.max,
    ); // R11.6
  });
});

describe("makeEngineConfig", () => {
  it("returns the defaults when given no overrides", () => {
    expect(makeEngineConfig()).toEqual(DEFAULT_ENGINE_CONFIG);
  });

  it("does not mutate the shared defaults", () => {
    const cfg = makeEngineConfig({ maxPlayers: 4 });
    cfg.diceRange.min = 999;
    expect(DEFAULT_ENGINE_CONFIG.maxPlayers).toBe(6);
    expect(DEFAULT_ENGINE_CONFIG.diceRange.min).toBe(-4);
  });

  it("merges nested diceRange overrides without dropping the other bound", () => {
    const cfg = makeEngineConfig({ diceRange: { min: -2 } as { min: number; max: number } });
    expect(cfg.diceRange.min).toBe(-2);
    expect(cfg.diceRange.max).toBe(DEFAULT_ENGINE_CONFIG.diceRange.max);
  });

  it("defaults the attribute ladder to [-2, +4] and merges overrides (R4.2)", () => {
    expect(DEFAULT_ENGINE_CONFIG.attributeLadder).toEqual({ min: -2, max: 4 });
    const cfg = makeEngineConfig({ attributeLadder: { min: 0 } as { min: number; max: number } });
    expect(cfg.attributeLadder.min).toBe(0);
    expect(cfg.attributeLadder.max).toBe(DEFAULT_ENGINE_CONFIG.attributeLadder.max);
  });

  it("does not mutate the shared attribute-ladder default", () => {
    const cfg = makeEngineConfig();
    cfg.attributeLadder.min = 99;
    expect(DEFAULT_ENGINE_CONFIG.attributeLadder.min).toBe(-2);
  });

  it("overrides apply and defaults fill the rest (property)", () => {
    fc.assert(
      fc.property(
        fc.record(
          {
            readyCheckTimeoutMs: fc.integer({ min: 1, max: 600000 }),
            maxPlayers: fc.integer({ min: 1, max: 6 }),
            aiMaxRetries: fc.integer({ min: 0, max: 10 }),
          },
          { requiredKeys: [] },
        ),
        (overrides: Partial<EngineConfig>) => {
          const cfg = makeEngineConfig(overrides);
          // Each overridden field takes the override value; others keep defaults.
          expect(cfg.readyCheckTimeoutMs).toBe(
            overrides.readyCheckTimeoutMs ?? DEFAULT_ENGINE_CONFIG.readyCheckTimeoutMs,
          );
          expect(cfg.maxPlayers).toBe(overrides.maxPlayers ?? DEFAULT_ENGINE_CONFIG.maxPlayers);
          expect(cfg.aiMaxRetries).toBe(
            overrides.aiMaxRetries ?? DEFAULT_ENGINE_CONFIG.aiMaxRetries,
          );
          // Records remain complete for all request types.
          for (const rt of REQUEST_TYPES) {
            expect(cfg.modelTiers[rt]).toBeDefined();
            expect(cfg.tokenBudgets[rt]).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
