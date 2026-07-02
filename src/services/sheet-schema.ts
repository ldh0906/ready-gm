/**
 * Scenario-adaptive character sheet schema.
 *
 * The character-setup web screen fetches `GET /rooms/:id/sheet-schema` and
 * renders a sheet from the returned JSON. The schema adapts to the room's
 * scenario: scenarios without special rules use a universal EZFudge sheet,
 * while scenarios with special rules ship a custom sheet.
 *
 * This module owns the shared `SheetSchema` JSON contract consumed by the
 * screen, the pre-authored sheets, and the mapping from a {@link Scenario} to
 * its sheet (plus the derived trait spec the server uses to validate recorded
 * attributes against the right rule system).
 *
 * Sources: terrible-geese (D6 dice-pool comedy) and until-it-sinks (GM-less,
 * narrative-only mystery) rulebooks; EZFudge core (DEFAULT_ATTRIBUTE_LADDER).
 */
import {
  DEFAULT_ATTRIBUTE_LADDER,
  isValidAttributeLevel,
  type AttributeLadder,
} from "../core/ezfudge.js";
import type { Scenario } from "./scenario-service.js";

/** A logical grouping of fields/traits on the rendered sheet. */
export interface SheetSection {
  /** Stable section identifier referenced by fields and traits. */
  id: string;
  /** Human-readable section heading shown on the sheet. */
  label: string;
}

/** A free-text narrative input rendered as a labelled, guided text area. */
export interface NarrativeField {
  /** Stable field identifier (e.g. "name", "concept"). */
  id: string;
  /** Label shown next to the input. */
  label: string;
  /** Helper text explaining what to write and how it is used. */
  guidance: string;
  /** The {@link SheetSection.id} this field belongs to. */
  sectionId: string;
  /** Maximum character count accepted by the input. */
  maxLength: number;
}

/** A numerically-rated trait rendered as a ladder control. */
export interface RatedTraitSpec {
  /** Stable, rule-system trait key (e.g. "Might", "Sneaky"). */
  key: string;
  /** Label shown on the ladder control. */
  label: string;
  /** The {@link SheetSection.id} this trait belongs to. */
  sectionId: string;
  /** Inclusive integer ladder bounds for the trait's value. */
  ladder: { min: number; max: number };
  /** Optional per-rung labels keyed by the integer value (as a string). */
  rungLabels?: Record<string, string>;
}

/**
 * The kind of stat-allocation rule carried by a {@link SheetSchema}. Exactly
 * one mode is active per resolved schema; unknown/invalid modes normalize to
 * `LADDER_SELECT` (the legacy, ladder-per-trait behaviour).
 */
export type AllocationMode = "LADDER_SELECT" | "POINT_BUY" | "FIXED_VALUE" | "DICE_ROLL";

/**
 * Ladder-select allocation: each rated trait is chosen independently within
 * its own ladder, with no cross-trait constraint. This preserves the existing
 * EZFudge/거위 sheet behaviour and is the default/fallback rule.
 */
export interface LadderSelectRule {
  mode: "LADDER_SELECT";
}

/**
 * Point-buy allocation: every trait starts at `baseLevel` and players spend a
 * shared `pointPool` raising traits. The total raised must equal `pointPool`.
 */
export interface PointBuyRule {
  mode: "POINT_BUY";
  /** Integer starting level within every trait's ladder. */
  baseLevel: number;
  /** Non-negative integer budget: 0 ≤ pointPool ≤ Σ(ladder.max − baseLevel). */
  pointPool: number;
}

/**
 * Fixed-value (standard array) allocation: a multiset of integers assigned
 * one-to-one to rated traits. `valuePool` length equals the rated-trait count.
 */
export interface FixedValueRule {
  mode: "FIXED_VALUE";
  /** Integer multiset; length === number of rated traits (≥ 1). */
  valuePool: number[];
}

/**
 * Dice-roll allocation: each trait's level is produced by rolling
 * `diceFormula` server-side. `forcedRandom` locks the rolled result from edits.
 */
export interface DiceRollRule {
  mode: "DICE_ROLL";
  /** Dice expression rolled per trait (e.g. "3d6", "2d6+1"). */
  diceFormula: string;
  /** When true, rolled levels are read-only; defaults to false when omitted. */
  forcedRandom: boolean;
}

/**
 * The single pluggable allocation rule carried by an {@link SheetSchema}.
 * Exactly one of the four modes is present on any resolved schema.
 */
export type AllocationRule =
  | LadderSelectRule
  | PointBuyRule
  | FixedValueRule
  | DiceRollRule;

/**
 * The canonical default/fallback allocation rule. Unspecified or invalid
 * scenario rules resolve to `LADDER_SELECT`, preserving legacy behaviour.
 */
export function defaultAllocationRule(): LadderSelectRule {
  return { mode: "LADDER_SELECT" };
}

/** True when `value` is a finite integer. */
function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * Normalize an arbitrary (possibly invalid/partial) allocation payload into a
 * well-formed {@link AllocationRule} for a schema whose rated traits are
 * `traits`. Any payload whose mode is not one of the four known modes, or whose
 * mode-specific parameters are missing or invalid, is corrected to
 * `LADDER_SELECT` (the legacy ladder-per-trait behaviour). This is the single
 * point that guarantees a resolved schema always carries exactly one valid rule
 * (Requirements 1.1, 1.2, 1.3, 3.1, 4.1, 5.1).
 *
 * Per-mode guarantees:
 * - `POINT_BUY`: integer `baseLevel` inside every trait ladder and an integer
 *   `pointPool` with `0 ≤ pointPool ≤ Σ(ladder.max − baseLevel)` (requires ≥ 1
 *   rated trait).
 * - `FIXED_VALUE`: an all-integer `valuePool` whose length equals the rated
 *   trait count (≥ 1).
 * - `DICE_ROLL`: a non-blank `diceFormula` string and a boolean `forcedRandom`
 *   (defaulting to `false` when omitted).
 */
export function normalizeAllocationRule(
  raw: unknown,
  traits: RatedTraitSpec[],
): AllocationRule {
  if (typeof raw !== "object" || raw === null) {
    return defaultAllocationRule();
  }
  const candidate = raw as Record<string, unknown>;

  switch (candidate.mode) {
    case "LADDER_SELECT":
      return { mode: "LADDER_SELECT" };

    case "POINT_BUY": {
      if (traits.length === 0) return defaultAllocationRule();
      const { baseLevel, pointPool } = candidate;
      if (!isInteger(baseLevel) || !isInteger(pointPool)) {
        return defaultAllocationRule();
      }
      const withinAllLadders = traits.every(
        (trait) => baseLevel >= trait.ladder.min && baseLevel <= trait.ladder.max,
      );
      if (!withinAllLadders) return defaultAllocationRule();
      const headroom = traits.reduce(
        (sum, trait) => sum + (trait.ladder.max - baseLevel),
        0,
      );
      if (pointPool < 0 || pointPool > headroom) return defaultAllocationRule();
      return { mode: "POINT_BUY", baseLevel, pointPool };
    }

    case "FIXED_VALUE": {
      if (traits.length === 0) return defaultAllocationRule();
      const { valuePool } = candidate;
      if (
        !Array.isArray(valuePool) ||
        valuePool.length !== traits.length ||
        !valuePool.every((value) => isInteger(value))
      ) {
        return defaultAllocationRule();
      }
      return { mode: "FIXED_VALUE", valuePool: [...(valuePool as number[])] };
    }

    case "DICE_ROLL": {
      const { diceFormula, forcedRandom } = candidate;
      if (typeof diceFormula !== "string" || diceFormula.trim().length === 0) {
        return defaultAllocationRule();
      }
      return {
        mode: "DICE_ROLL",
        diceFormula,
        forcedRandom: forcedRandom === true,
      };
    }

    default:
      return defaultAllocationRule();
  }
}

/**
 * A parsed dice formula for `DICE_ROLL` allocation: `NdM(+/-K)` or `NdF(+/-K)`
 * (Fudge dice, each die -1/0/+1). Server-authored schemas carry the formula;
 * the server rolls it — the client never produces a random value.
 */
export interface DiceFormulaSpec {
  count: number;
  sides: number | "F";
  modifier: number;
}

/**
 * Parse a dice formula string (`"2d6"`, `"4dF"`, `"1d8+1"`, `"3d6-2"`,
 * case-insensitive, surrounding whitespace ignored). Returns `null` for
 * anything else (fail-closed: an unparseable formula never rolls).
 */
export function parseDiceFormula(formula: string): DiceFormulaSpec | null {
  const match = /^\s*(\d{1,2})[dD](F|f|\d{1,3})\s*(?:([+-])\s*(\d{1,3}))?\s*$/.exec(formula);
  if (match === null) return null;
  const count = Number.parseInt(match[1]!, 10);
  const sides = match[2] === "F" || match[2] === "f" ? "F" : Number.parseInt(match[2]!, 10);
  if (count < 1 || count > 20) return null;
  if (sides !== "F" && (sides < 2 || sides > 100)) return null;
  const modifier =
    match[3] === undefined ? 0 : (match[3] === "-" ? -1 : 1) * Number.parseInt(match[4]!, 10);
  return { count, sides, modifier };
}

/** Roll a parsed formula once with the injected uniform RNG (`[0, 1)`). */
export function rollDiceFormula(spec: DiceFormulaSpec, random: () => number): number {
  let total = spec.modifier;
  for (let i = 0; i < spec.count; i++) {
    total +=
      spec.sides === "F"
        ? Math.floor(random() * 3) - 1
        : Math.floor(random() * spec.sides) + 1;
  }
  return total;
}

/**
 * Server-side `DICE_ROLL` allocation: roll the schema's `diceFormula` once per
 * rated trait and clamp each result into that trait's ladder, so the returned
 * set always passes {@link validateAllocation}. Returns `null` when the schema
 * does not carry a valid `DICE_ROLL` rule (fail-closed).
 */
export function rollAllocationValues(
  schema: SheetSchema,
  random: () => number = Math.random,
): Record<string, number> | null {
  if (schema.allocation.mode !== "DICE_ROLL") return null;
  const spec = parseDiceFormula(schema.allocation.diceFormula);
  if (spec === null) return null;
  const values: Record<string, number> = {};
  for (const trait of schema.traits) {
    const rolled = rollDiceFormula(spec, random);
    values[trait.key] = Math.min(trait.ladder.max, Math.max(trait.ladder.min, rolled));
  }
  return values;
}

/**
 * Outcome of {@link validateAllocation}. A ladder-bounds violation is
 * `INVALID_ATTRIBUTES`; an allocation-constraint violation (and every
 * `FIXED_VALUE` violation) is `INVALID_ALLOCATION`
 * (design "요구사항 정합성 메모 1"; Requirements 9.3, 8.3).
 */
export type AllocationValidation =
  | { ok: true }
  | { ok: false; reason: "INVALID_ATTRIBUTES" | "INVALID_ALLOCATION" };

/** A single rated trait's key and its inclusive integer ladder. */
interface TraitLadderSpec {
  key: string;
  ladder: { min: number; max: number };
}

/** True iff `a` and `b` are equal as multisets (same elements, same counts). */
function multisetEqual(a: number[], b: number[]): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sortedA = a.slice().sort((x, y) => x - y);
  const sortedB = b.slice().sort((x, y) => x - y);
  for (let i = 0; i < sortedA.length; i += 1) {
    if (sortedA[i] !== sortedB[i]) return false;
  }
  return true;
}

/**
 * The single shared allocation-validation algorithm — the canonical TypeScript
 * implementation that mirrors the frontend `validateAllocation` in
 * `public/character/logic.js` exactly (validation parity, Requirement 6). The
 * backend {@link CharacterService.recordCharacter} and the frontend both
 * realize the same algorithm so identical inputs yield identical verdicts and
 * the same rejection classification.
 *
 * Algorithm (design "배분 검증 알고리즘"):
 * 1. Key-set precheck: every defined trait key is present exactly once and no
 *    undefined key is supplied (else `INVALID_ATTRIBUTES`). A 0-trait schema
 *    (narrative-only) is always valid — validation never applies (R8.6).
 * 2. Per-mode dispatch:
 *    - `LADDER_SELECT`/`DICE_ROLL`: each level an integer inside its own ladder
 *      (else `INVALID_ATTRIBUTES`); no cross-trait constraint (R2, R5.4).
 *    - `POINT_BUY`: stage 1 ladder bounds (`level ≥ baseLevel` and inside the
 *      ladder, else `INVALID_ATTRIBUTES`), then stage 2 `Σ(level − baseLevel)
 *      === pointPool` (else `INVALID_ALLOCATION`) (R3.2–3.4, 8.2, 8.3).
 *    - `FIXED_VALUE`: specific-over-general — any violation (ladder-bounds or
 *      multiset mismatch) is `INVALID_ALLOCATION` (R4.2–4.4).
 *
 * @param rule The allocation rule governing the set.
 * @param traits The rated traits (key + ladder) the set is validated against.
 * @param ratedTraitSet The `Record<key, level>` to judge.
 */
export function validateAllocation(
  rule: AllocationRule,
  traits: TraitLadderSpec[],
  ratedTraitSet: Record<string, number>,
): AllocationValidation {
  const set =
    ratedTraitSet && typeof ratedTraitSet === "object" ? ratedTraitSet : {};

  // Common precheck: a 0-trait (narrative-only) schema is always valid (R8.6).
  if (traits.length === 0) return { ok: true };

  // Every defined trait key present exactly once; no undefined keys (R2.4).
  const schemaKeys = traits.map((t) => t.key);
  for (const key of schemaKeys) {
    if (!Object.prototype.hasOwnProperty.call(set, key)) {
      return { ok: false, reason: "INVALID_ATTRIBUTES" };
    }
  }
  const schemaKeySet = new Set(schemaKeys);
  for (const key of Object.keys(set)) {
    if (!schemaKeySet.has(key)) {
      return { ok: false, reason: "INVALID_ATTRIBUTES" };
    }
  }

  switch (rule.mode) {
    case "POINT_BUY": {
      // Stage 1 ladder bounds: level ≥ baseLevel and inside its ladder, else
      // INVALID_ATTRIBUTES regardless of the sum (R3.4, 8.2, 9.3).
      const { baseLevel } = rule;
      for (const trait of traits) {
        const level = set[trait.key];
        if (!isValidAttributeLevel(level, trait.ladder) || level < baseLevel) {
          return { ok: false, reason: "INVALID_ATTRIBUTES" };
        }
      }
      // Stage 2 allocation: Σ(level − baseLevel) === pointPool, else
      // INVALID_ALLOCATION (R3.3, 8.3).
      let spent = 0;
      for (const key of Object.keys(set)) {
        spent += set[key] - baseLevel;
      }
      if (spent !== rule.pointPool) {
        return { ok: false, reason: "INVALID_ALLOCATION" };
      }
      return { ok: true };
    }

    case "FIXED_VALUE": {
      // Specific-over-general: any violation (ladder-bounds or multiset
      // mismatch) is INVALID_ALLOCATION (R4.2–4.4; design note 1).
      for (const trait of traits) {
        if (!isValidAttributeLevel(set[trait.key], trait.ladder)) {
          return { ok: false, reason: "INVALID_ALLOCATION" };
        }
      }
      const levels = traits.map((t) => set[t.key]);
      if (!multisetEqual(levels, rule.valuePool)) {
        return { ok: false, reason: "INVALID_ALLOCATION" };
      }
      return { ok: true };
    }

    // LADDER_SELECT/DICE_ROLL: each level an integer inside its own ladder,
    // no cross-trait constraint; violation → INVALID_ATTRIBUTES (R2, 5.4, 9.3).
    case "LADDER_SELECT":
    case "DICE_ROLL":
    default: {
      for (const trait of traits) {
        if (!isValidAttributeLevel(set[trait.key], trait.ladder)) {
          return { ok: false, reason: "INVALID_ATTRIBUTES" };
        }
      }
      return { ok: true };
    }
  }
}

/**
 * A pre-authored role card a card-based sheet ships. The player picks exactly
 * one card (a fixed role/identity) and writes their own backstory on top of it.
 * A schema whose `characterCards` is non-empty is a Card_Based_Sheet
 * (Requirements 3.1, 3.2).
 */
export interface CharacterCard {
  /** Card_Id: trims to ≥ 1 char and is unique within a list (Requirements 3.1, 3.2). */
  id: string;
  /** Card_Role_Label: the role/identity display name; trims to ≥ 1 char (Requirement 3.1). */
  roleLabel: string;
  /** Card_Premise: the role's premise/description text (Requirement 3.1). */
  premise: string;
  /** Card_Backstory_Guidance: optional guidance for writing the backstory. */
  backstoryGuidance?: string;
}

/**
 * The full sheet contract the character-setup screen consumes. `traits` MAY be
 * an empty array for narrative-only sheets; `narrativeFields` MUST always
 * include `name` (maxLength 100) and `concept` (maxLength 2000).
 */
export interface SheetSchema {
  /** The scenario this schema was resolved for, when known. */
  scenarioId?: string;
  /** Scenario genre (mirrors scenario metadata). */
  genre: string;
  /** Scenario category (mirrors scenario metadata). */
  category: string;
  /** Whether the scenario uses a custom (non-universal) rule system. */
  hasSpecialRules: boolean;
  /** Named rule system (e.g. "EZFudge", "D6 다이스 풀"). */
  system: string;
  /** Section groupings rendered on the sheet. */
  sections: SheetSection[];
  /** Free-text narrative fields (always includes name + concept). */
  narrativeFields: NarrativeField[];
  /** Rated traits; empty for narrative-only sheets. */
  traits: RatedTraitSpec[];
  /** The single allocation rule that governs how rated traits are assigned. */
  allocation: AllocationRule;
  /**
   * Whether this sheet supports the AI attribute-proposal action. Exactly one
   * boolean is present on every resolved schema (Requirement 1.1). Derived from
   * the rated-trait count / scenario proposal flag (Requirements 1.2–1.4); full
   * resolver derivation lives in {@link sheetSchemaForScenario} (task 2.1).
   */
  attributeProposalSupported: boolean;
  /**
   * The selectable Character_Card_List. When present with ≥ 1 element the sheet
   * is a Card_Based_Sheet; absent or empty means it is not (Requirement 3.4).
   */
  characterCards?: CharacterCard[];
}

/**
 * Universal EZFudge sheet for scenarios without special rules. Four-attribute
 * ladder on the default EZFudge band; the screen supplies default [-2, 4] rung
 * labels, so no `rungLabels` are emitted here.
 */
export const UNIVERSAL_SHEET: SheetSchema = {
  genre: "범용",
  category: "범용",
  hasSpecialRules: false,
  system: "EZFudge",
  sections: [
    { id: "narrative", label: "서사" },
    { id: "attributes", label: "능력치" },
  ],
  narrativeFields: [
    {
      id: "name",
      label: "이름",
      guidance: "캐릭터의 이름을 적으세요.",
      sectionId: "narrative",
      maxLength: 100,
    },
    {
      id: "concept",
      label: "컨셉",
      guidance:
        "캐릭터의 한 줄 컨셉과 배경을 적으세요. 이 내용은 AI가 능력치 제안을 만들 때 근거로 사용됩니다.",
      sectionId: "narrative",
      maxLength: 2000,
    },
  ],
  traits: [
    {
      key: "Might",
      label: "힘",
      sectionId: "attributes",
      ladder: { ...DEFAULT_ATTRIBUTE_LADDER },
    },
    {
      key: "Agility",
      label: "민첩",
      sectionId: "attributes",
      ladder: { ...DEFAULT_ATTRIBUTE_LADDER },
    },
    {
      key: "Wits",
      label: "지력",
      sectionId: "attributes",
      ladder: { ...DEFAULT_ATTRIBUTE_LADDER },
    },
    {
      key: "Spirit",
      label: "의지",
      sectionId: "attributes",
      ladder: { ...DEFAULT_ATTRIBUTE_LADDER },
    },
  ],
  allocation: { mode: "LADDER_SELECT" },
  attributeProposalSupported: true,
};

/**
 * Custom sheet for "끔찍한 거위들" (terrible-geese): a D6 dice-pool comedy.
 *
 * Rulebook fidelity: "All standard stats start at 1. You have 3 points to
 * divide between these stats however you like." So the three stats
 * (은밀함/재빠름/집요함) use a POINT_BUY rule with `baseLevel: 1` and a
 * `pointPool: 3` over a [1, 4] ladder — every trait starts at 1 and the player
 * distributes exactly 3 extra points (total 6, each trait 1–4). The one-off
 * "special" trait (춤·매듭·폭발물 등) is captured as a narrative field and
 * carries NO points ("Your special stat cannot have any points added to it").
 */
export const GEESE_SHEET: SheetSchema = {
  genre: "코미디",
  category: "코미디 소동극",
  hasSpecialRules: true,
  system: "D6 다이스 풀",
  sections: [
    { id: "narrative", label: "서사" },
    { id: "attributes", label: "능력치" },
  ],
  narrativeFields: [
    {
      id: "name",
      label: "이름",
      guidance: "이 끔찍한 거위의 이름을 정하세요.",
      sectionId: "narrative",
      maxLength: 100,
    },
    {
      id: "concept",
      label: "컨셉/사연",
      guidance: "이 거위가 어떤 녀석인지, 마을에 무슨 사연으로 나타났는지 짧게 적으세요.",
      sectionId: "narrative",
      maxLength: 2000,
    },
    {
      id: "special",
      label: "스페셜 특성",
      guidance:
        "춤·매듭·폭발물처럼 이 거위만의 일회성 특기 하나를 정하세요. 점수를 배분할 수는 없지만, 어울리는 상황에서 보너스 주사위를 받습니다.",
      sectionId: "narrative",
      maxLength: 2000,
    },
  ],
  traits: [
    {
      key: "Sneaky",
      label: "은밀함",
      sectionId: "attributes",
      ladder: { min: 1, max: 4 },
      rungLabels: { "1": "1", "2": "2", "3": "3", "4": "4" },
    },
    {
      key: "Fast",
      label: "재빠름",
      sectionId: "attributes",
      ladder: { min: 1, max: 4 },
      rungLabels: { "1": "1", "2": "2", "3": "3", "4": "4" },
    },
    {
      key: "Tenacious",
      label: "집요함",
      sectionId: "attributes",
      ladder: { min: 1, max: 4 },
      rungLabels: { "1": "1", "2": "2", "3": "3", "4": "4" },
    },
  ],
  // Rulebook: 세 스탯 모두 1에서 시작하고 3점을 원하는 곳에 분배(스탯당 1~4, 총합 6).
  allocation: { mode: "POINT_BUY", baseLevel: 1, pointPool: 3 },
  attributeProposalSupported: true,
};

/**
 * The selectable Character_Card_List for "가라앉을 때까지" (until-it-sinks),
 * transcribed faithfully from the rulebook's 11 character cards. Each player
 * picks exactly one card; the rulebook notes that the group must include at
 * least one 원주민(native), and that the card carries no motive/secret —
 * gender, name, and disposition are decided by the player and the rest is
 * completed in play. The `premise` reproduces the card's bullet text verbatim
 * (including the 원주민/이방인 tag); `backstoryGuidance` carries the shared
 * character-creation guidance. Each card has a unique trimmed `id` and
 * `roleLabel` (Requirements 3.1, 3.2, 3.3).
 */
const SINKS_BACKSTORY_GUIDANCE =
  "성별과 이름을 정하고, 카드에 없는 내용을 덧붙여 인물의 기본적인 분위기를 정하세요. " +
  "동기·비밀·과거는 미리 정하지 않아도 되며 대화를 통해 게임 중에 완성됩니다.";

export const SINKS_CARDS: CharacterCard[] = [
  {
    id: "manager",
    roleLabel: "지배인",
    premise:
      "• 당신은 조용하고 냉담한 사람입니다 — 적어도 겉으로는 그렇습니다.\n" +
      "• 당신은 호텔의 운영을 관리합니다.\n" +
      "• 당신은 매력적입니다.\n" +
      "• 당신은 원주민입니다.",
    backstoryGuidance: SINKS_BACKSTORY_GUIDANCE,
  },
  {
    id: "handyman",
    roleLabel: "인부",
    premise:
      "• 당신은 체구가 크고, 더러우며, 약간 어리석습니다.\n" +
      "• 당신은 호텔의 여러 잡무를 합니다.\n" +
      "• 당신은 감정에 쉽게 이끌립니다.\n" +
      "• 당신은 원주민입니다.",
    backstoryGuidance: SINKS_BACKSTORY_GUIDANCE,
  },
  {
    id: "hotel-owner",
    roleLabel: "호텔 소유주",
    premise:
      "• 당신은 늙었고, 호텔은 당신의 인생과 같습니다.\n" +
      "• 당신은 바다가 섬을 서서히 삼키는 것과 사람들이 하나둘 떠나는 것을 보아왔습니다.\n" +
      "• 당신은 원주민입니다.",
    backstoryGuidance: SINKS_BACKSTORY_GUIDANCE,
  },
  {
    id: "retiree",
    roleLabel: "수다스러운 은퇴자",
    premise:
      "• 당신은 사람들을 만나기 위해 여기 왔지만, 사람이 많지 않아 실망했습니다.\n" +
      "• 당신은 호기심이 많고 가십을 캐는 것을 좋아합니다.\n" +
      "• 당신은 박식합니다. (혹은 자신만 그렇게 생각합니다)\n" +
      "• 당신은 이방인입니다.",
    backstoryGuidance: SINKS_BACKSTORY_GUIDANCE,
  },
  {
    id: "writer",
    roleLabel: "알콜중독 작가",
    premise:
      "• 당신은 글을 쓰기 위해 먼 곳으로 여행을 왔습니다 — 하지만 글을 쓰고 있지는 않습니다.\n" +
      "• 당신은 쉽게 남을 경멸합니다.\n" +
      "• 당신은 호색한이고 술을 자주 마십니다.\n" +
      "• 당신은 이방인입니다.",
    backstoryGuidance: SINKS_BACKSTORY_GUIDANCE,
  },
  {
    id: "sun-worshipper",
    roleLabel: "태양의 열광자",
    premise:
      "• 당신은 바다낚시와 선탠과 운동을 좋아합니다.\n" +
      "• 당신은 다소 불량하고 자신만만해 보입니다.\n" +
      "• 당신은 매력적입니다 — 스스로도 그것을 압니다.\n" +
      "• 당신은 이방인입니다.",
    backstoryGuidance: SINKS_BACKSTORY_GUIDANCE,
  },
  {
    id: "geologist",
    roleLabel: "지질학자",
    premise:
      "• 당신은 가라앉는 섬을 연구하기 위해 여기에 왔습니다.\n" +
      "• 당신은 모범생 기질이 있고 다소 공격적입니다.\n" +
      "• 당신은 작고 말랐으며 건강을 지나치게 걱정합니다.\n" +
      "• 당신은 이방인입니다.",
    backstoryGuidance: SINKS_BACKSTORY_GUIDANCE,
  },
  {
    id: "celebrity",
    roleLabel: "유명인",
    premise:
      "• 몇 가지 이유에서 당신은 가십 잡지 독자에게 잘 알려진 사람입니다.\n" +
      "• 당신은 인기의 정점에 선 사람일 수도 있고, 한물 간 스타일 수도 있습니다.\n" +
      "• 관심의 중심에 서는 것이 당신에게 중요한 일입니다.\n" +
      "• 당신은 이방인입니다.",
    backstoryGuidance: SINKS_BACKSTORY_GUIDANCE,
  },
  {
    id: "backpacker",
    roleLabel: "배낭여행자",
    premise:
      "• 당신은 지구를 한 바퀴 돌아 이 섬에 도착했습니다.\n" +
      "• 당신은 자유사상가이자 독립심이 강한 사람이고, 볼품없게 생겼습니다.\n" +
      "• 당신은 다른 이의 틀에 박힌 삶을 지적하길 좋아합니다.\n" +
      "• 당신은 이방인입니다.",
    backstoryGuidance: SINKS_BACKSTORY_GUIDANCE,
  },
  {
    id: "pilot",
    roleLabel: "조종사",
    premise:
      "• 당신은 기체에 엔진 고장이 생겨서 이 섬에 고립되었습니다.\n" +
      "• 당신은 필요한 부품을 주문했고, 그것은 다음 보트로 도착할 예정입니다.\n" +
      "• 당신은 거친 모험자입니다.\n" +
      "• 당신은 이방인입니다.",
    backstoryGuidance: SINKS_BACKSTORY_GUIDANCE,
  },
  {
    id: "child",
    roleLabel: "아들 혹은 딸",
    premise:
      "• 당신은 다른 인물의 자녀입니다.\n" +
      "• 당신은 청소년일 수도 있고 어린이일 수도 있습니다.\n" +
      "• 당신은 고집이 세고 무례합니다.\n" +
      "• 당신은 이방인일 수도 있고 원주민일 수도 있습니다.",
    backstoryGuidance: SINKS_BACKSTORY_GUIDANCE,
  },
];

/**
 * Narrative-only sheet for "가라앉을 때까지" (until-it-sinks): a GM-less,
 * card-based cooperative mystery. There are no rated traits — characters are
 * built entirely through narrative fields.
 */
export const SINKS_SHEET: SheetSchema = {
  genre: "미스터리/호러",
  category: "호러·미스터리(GM리스)",
  hasSpecialRules: true,
  system: "카드 기반(GM리스)",
  sections: [{ id: "narrative", label: "인물" }],
  narrativeFields: [
    {
      id: "name",
      label: "이름",
      guidance: "인물의 이름을 정하세요.",
      sectionId: "narrative",
      maxLength: 100,
    },
    {
      id: "concept",
      label: "역할/컨셉",
      guidance:
        "위 역할 카드 중 하나를 고르고, 그 인물의 기본적인 분위기를 짧게 적으세요. 카드에 없는 성별·이름·세부는 자유롭게 덧붙일 수 있습니다.",
      sectionId: "narrative",
      maxLength: 2000,
    },
    {
      id: "disposition",
      label: "다른 인물에 대한 태도",
      guidance: "다른 인물들을 어떻게 바라보는지, 관계의 출발점을 적으세요.",
      sectionId: "narrative",
      maxLength: 2000,
    },
    {
      id: "goal",
      label: "목표·비밀",
      guidance: "이 인물이 품은 목표나 숨기고 있는 비밀을 적으세요. 플레이 중에 드러나도 좋습니다.",
      sectionId: "narrative",
      maxLength: 2000,
    },
  ],
  traits: [],
  allocation: { mode: "LADDER_SELECT" },
  attributeProposalSupported: false,
  characterCards: SINKS_CARDS,
};

/** Per-scenario-id custom sheet overrides; absent ids fall back to universal. */
const CUSTOM_SHEETS_BY_SCENARIO_ID: Readonly<Record<string, SheetSchema>> = {
  "terrible-geese": GEESE_SHEET,
  "until-it-sinks": SINKS_SHEET,
};

/**
 * Per-scenario-id Character_Card_List mapping. A scenario id present here is
 * resolved as a Card_Based_Sheet; absent ids are not card-based (Requirements
 * 3.3, 3.4, 3.5). Mirrors the sheet-selection approach (id → list).
 */
const CARDS_BY_SCENARIO_ID: Readonly<Record<string, CharacterCard[]>> = {
  "until-it-sinks": SINKS_CARDS,
};

/**
 * Derive the single `attributeProposalSupported` flag for a resolved sheet from
 * its rated traits and the scenario's optional Attribute_Proposal_Disabled
 * input. Returns `false` when there are no rated traits (Requirement 1.2) or
 * when the scenario explicitly disables proposals (Requirement 1.3); otherwise
 * (≥ 1 rated trait and not disabled) returns `true` (Requirement 1.4).
 */
export function deriveAttributeProposalSupported(
  traits: RatedTraitSpec[],
  scenario: Scenario,
): boolean {
  if (traits.length === 0) return false; // R1.2
  if (scenario.attributeProposalDisabled === true) return false; // R1.3
  return true; // R1.4
}

/**
 * The Character_Card_List a scenario ships, or `undefined` when the scenario is
 * not card-based. Mapped by scenario id: "until-it-sinks" → {@link SINKS_CARDS};
 * every other scenario is non-card (Requirements 3.3, 3.4, 3.5).
 */
export function cardsForScenario(scenario: Scenario): CharacterCard[] | undefined {
  return CARDS_BY_SCENARIO_ID[scenario.id];
}

/** Structured-clone a sheet so callers cannot mutate the shared templates. */
function cloneSheet(sheet: SheetSchema): SheetSchema {
  return {
    ...sheet,
    sections: sheet.sections.map((section) => ({ ...section })),
    narrativeFields: sheet.narrativeFields.map((field) => ({ ...field })),
    traits: sheet.traits.map((trait) => ({
      ...trait,
      ladder: { ...trait.ladder },
      ...(trait.rungLabels ? { rungLabels: { ...trait.rungLabels } } : {}),
    })),
    allocation: cloneAllocationRule(sheet.allocation),
    ...(sheet.characterCards
      ? { characterCards: sheet.characterCards.map((card) => ({ ...card })) }
      : {}),
  };
}

/** Structured-clone an allocation rule so callers cannot mutate shared templates. */
function cloneAllocationRule(rule: AllocationRule): AllocationRule {
  switch (rule.mode) {
    case "FIXED_VALUE":
      return { mode: "FIXED_VALUE", valuePool: [...rule.valuePool] };
    case "POINT_BUY":
      return { mode: "POINT_BUY", baseLevel: rule.baseLevel, pointPool: rule.pointPool };
    case "DICE_ROLL":
      return { mode: "DICE_ROLL", diceFormula: rule.diceFormula, forcedRandom: rule.forcedRandom };
    case "LADDER_SELECT":
    default:
      return { mode: "LADDER_SELECT" };
  }
}

/**
 * Resolve the sheet schema for a scenario. Scenarios with a custom sheet
 * ("terrible-geese", "until-it-sinks") get that sheet; everything else gets the
 * universal EZFudge sheet. The returned schema is a deep copy with `scenarioId`
 * set and `genre`/`category`/`hasSpecialRules`/`system` taken from the scenario
 * metadata so the contract stays consistent with the catalog.
 */
export function sheetSchemaForScenario(scenario: Scenario): SheetSchema {
  const base =
    scenario.hasSpecialRules && scenario.id in CUSTOM_SHEETS_BY_SCENARIO_ID
      ? CUSTOM_SHEETS_BY_SCENARIO_ID[scenario.id]
      : UNIVERSAL_SHEET;

  const schema = cloneSheet(base);
  schema.scenarioId = scenario.id;
  schema.genre = scenario.genre;
  schema.category = scenario.category;
  schema.hasSpecialRules = scenario.hasSpecialRules;
  schema.system = scenario.system;
  // Attach exactly one normalized allocation rule. A scenario hint (if any)
  // takes precedence over the base sheet's own rule; both are normalized
  // against the resolved traits. Narrative-only sheets (0 traits) always use
  // LADDER_SELECT so allocation validation never applies (Requirement 1.6).
  schema.allocation =
    schema.traits.length === 0
      ? defaultAllocationRule()
      : normalizeAllocationRule(scenario.allocation ?? schema.allocation, schema.traits);
  // Attach exactly one `attributeProposalSupported` boolean, derived from the
  // resolved rated traits and the scenario's proposal-disabled input
  // (Requirements 1.1–1.6). UNIVERSAL/GEESE (≥ 1 trait, not disabled) → true;
  // until-it-sinks (0 traits) → false.
  schema.attributeProposalSupported = deriveAttributeProposalSupported(
    schema.traits,
    scenario,
  );
  // Attach the Character_Card_List for card-based scenarios; non-card scenarios
  // carry no `characterCards` so they are not Card_Based_Sheets (Requirements
  // 3.1–3.5). The resolver is the authority on the card list (id → list).
  const cards = cardsForScenario(scenario);
  if (cards && cards.length > 0) {
    schema.characterCards = cards.map((card) => ({ ...card }));
  } else {
    delete schema.characterCards;
  }
  return schema;
}

/**
 * The trait keys and common ladder the server should validate recorded
 * attributes against for a scenario. Keys are the sheet's trait keys; the
 * ladder is the first trait's ladder (all traits on a sheet share one band).
 * Trait-less (narrative-only) scenarios yield `{ keys: [], ladder:
 * DEFAULT_ATTRIBUTE_LADDER }`, which signals "no attribute validation". The
 * resolved single allocation rule is included so the server validates recorded
 * attributes against the same rule the screen renders from.
 */
export function expectedTraitSpecForScenario(scenario: Scenario): {
  keys: string[];
  ladder: AttributeLadder;
  allocation: AllocationRule;
  characterCards?: CharacterCard[];
} {
  const schema = sheetSchemaForScenario(scenario);
  const cards =
    schema.characterCards && schema.characterCards.length > 0
      ? { characterCards: schema.characterCards.map((card) => ({ ...card })) }
      : {};
  if (schema.traits.length === 0) {
    return {
      keys: [],
      ladder: { ...DEFAULT_ATTRIBUTE_LADDER },
      allocation: schema.allocation,
      ...cards,
    };
  }
  return {
    keys: schema.traits.map((trait) => trait.key),
    ladder: { ...schema.traits[0].ladder },
    allocation: schema.allocation,
    ...cards,
  };
}
