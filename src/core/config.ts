/**
 * Default engine configuration.
 *
 * Requirements: 1.4 (maxPlayers), 8.4 (readyCheckTimeoutMs), 11.6 (dice),
 * 16.2 (modelTiers), 17.1 (aiMaxRetries).
 */
import type { EngineConfig } from "./types.js";
import { DEFAULT_ATTRIBUTE_LADDER } from "./ezfudge.js";

/**
 * Default EZFudge dice. Two dice each uniform over `[-2, +2]` are summed, giving
 * a symmetric bell-shaped distribution over the aggregate `[-4, +4]` band: the
 * centre is far more likely than the extremes, so criticals and fumbles are
 * rarer than under a flat roll while every die stays unbiased (design.md EZFudge
 * Resolver; Requirement 11.6).
 */
export const DEFAULT_DICE_SPEC: { count: number; face: { min: number; max: number } } = {
  count: 2,
  face: { min: -2, max: 2 },
};

/**
 * Default EZFudge aggregate dice range: the output band of {@link
 * DEFAULT_DICE_SPEC}, i.e. `[-4, +4]`. Retained for range-bound helpers and test
 * fixtures.
 */
export const DEFAULT_DICE_RANGE: { min: number; max: number } = {
  min: DEFAULT_DICE_SPEC.count * DEFAULT_DICE_SPEC.face.min,
  max: DEFAULT_DICE_SPEC.count * DEFAULT_DICE_SPEC.face.max,
};

/**
 * The engine's default configuration. Individual fields may be overridden by
 * the deployment via {@link makeEngineConfig}.
 */
export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  readyCheckTimeoutMs: 90000,
  // 90s: players read the GM narration before noticing their roll button; the
  // old 20s expired mid-read and the server force-rolled over them (QA-3).
  rollCheckTimeoutMs: 90000,
  maxPlayers: 6,
  aiMaxRetries: 2,
  modelTiers: {
    opening: "premium",
    attributes: "fast",
    resolution: "premium",
    ending: "premium",
  },
  tokenBudgets: {
    opening: 4000,
    attributes: 1500,
    resolution: 6000,
    ending: 4000,
  },
  diceRange: { ...DEFAULT_DICE_RANGE },
  dice: { count: DEFAULT_DICE_SPEC.count, face: { ...DEFAULT_DICE_SPEC.face } },
  attributeLadder: { ...DEFAULT_ATTRIBUTE_LADDER },
};

/**
 * Build an {@link EngineConfig} from the defaults, applying any overrides.
 * Nested objects are merged shallowly per field so callers can override, e.g.,
 * just `diceRange` without restating the whole config.
 */
export function makeEngineConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    ...DEFAULT_ENGINE_CONFIG,
    ...overrides,
    modelTiers: { ...DEFAULT_ENGINE_CONFIG.modelTiers, ...overrides.modelTiers },
    tokenBudgets: { ...DEFAULT_ENGINE_CONFIG.tokenBudgets, ...overrides.tokenBudgets },
    diceRange: { ...DEFAULT_ENGINE_CONFIG.diceRange, ...overrides.diceRange },
    dice: {
      ...DEFAULT_ENGINE_CONFIG.dice,
      ...overrides.dice,
      face: { ...DEFAULT_ENGINE_CONFIG.dice.face, ...overrides.dice?.face },
    },
    attributeLadder: { ...DEFAULT_ENGINE_CONFIG.attributeLadder, ...overrides.attributeLadder },
  };
}
