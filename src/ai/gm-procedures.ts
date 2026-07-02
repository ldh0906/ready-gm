/**
 * GM Procedure Layer — deterministic, server-side guidance for the hot-path GM.
 *
 * This module does not replace the LLM GM. It gives the GM a small set of
 * table-procedure hints before the structured decision step, then critiques the
 * final narration for obvious procedure violations. Handlers never mutate game
 * state; they only produce auditable hints or warnings.
 */
import type { CheckRecord } from "../core/turn-state.js";
import type { ProgressClock } from "../core/progress-clock.js";
import type { SceneState } from "../core/scene-state.js";
import type { ScenarioBlackboard } from "../core/scenario-blackboard.js";
import type { SafetyProfile } from "../core/safety-profile.js";
import { findSafetyViolations } from "../core/safety-profile.js";
import type { TurnStateContext } from "../services/turn-state-context.js";

export const GM_PROCEDURE_IDS = [
  "character_spotlight",
  "clue_reveal",
  "three_clue_rule",
  "pressure_clock",
  "narration_critic",
] as const;

export type GmProcedureId = (typeof GM_PROCEDURE_IDS)[number];
export type GmProcedurePriority = "high" | "medium" | "low";

export interface GmProcedureHint {
  id: GmProcedureId;
  priority: GmProcedurePriority;
  instruction: string;
  data?: Record<string, unknown>;
}

export interface GmProcedurePlan {
  hints: GmProcedureHint[];
  criticChecks: string[];
}

export interface GmProcedureInput {
  context: TurnStateContext;
  clocks?: readonly ProgressClock[];
  scene?: SceneState;
  blackboard?: ScenarioBlackboard;
}

export interface GmProcedureHandler {
  id: GmProcedureId;
  buildHint(input: GmProcedureInput): GmProcedureHint | undefined;
}

export interface NarrationCritiqueWarning {
  code: "unrevealed_clue_id_leaked" | "hidden_gm_roll_exposed" | "banned_topic_in_narration";
  message: string;
  detail?: string;
}

export interface NarrationCritique {
  passed: boolean;
  warnings: NarrationCritiqueWarning[];
}

export interface NarrationCritiqueInput {
  narration: string;
  resolvedChecks: readonly CheckRecord[];
  scene?: SceneState;
  safetyProfile?: SafetyProfile;
}

const INVESTIGATION_RE =
  /조사|살펴|찾|확인|수색|관찰|둘러|단서|inspect|investigate|search|look|examine/i;
const HIDDEN_ROLL_RE = /비공개\s*주사위|숨겨진\s*주사위|주사위|판정|굴림|dice|roll/i;

function mentionCount(name: string, ctx: TurnStateContext): number {
  return ctx.recentNarrative.reduce((count, entry) => {
    const matches = entry.text.match(new RegExp(escapeRegExp(name), "g"));
    return count + (matches?.length ?? 0);
  }, 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function activeCharacterNames(ctx: TurnStateContext): Set<string> {
  const active = ctx.thisRound.actions
    .filter((action) => action.actionKind === "confirmed_action")
    .map((action) => action.characterName);
  return new Set(active.length > 0 ? active : ctx.characters.map((character) => character.name));
}

const characterSpotlightHandler: GmProcedureHandler = {
  id: "character_spotlight",
  buildHint({ context }) {
    if (context.characters.length === 0) return undefined;
    const activeNames = activeCharacterNames(context);
    const candidates = context.characters.filter((character) => activeNames.has(character.name));
    if (candidates.length === 0) return undefined;

    const ranked = candidates
      .map((character) => ({
        character,
        recentMentionCount: mentionCount(character.name, context),
      }))
      .sort((a, b) => a.recentMentionCount - b.recentMentionCount);
    const selected = ranked[0];
    if (selected === undefined) return undefined;

    return {
      id: "character_spotlight",
      priority: "medium",
      instruction:
        "spotlight: 이번 라운드에서 최근 덜 조명된 캐릭터의 행동 결과나 감정 반응을 한 번은 의미 있게 반영하세요.",
      data: {
        targetCharacterName: selected.character.name,
        recentMentionCount: selected.recentMentionCount,
        concept: selected.character.concept,
      },
    };
  },
};

const clueRevealHandler: GmProcedureHandler = {
  id: "clue_reveal",
  buildHint({ context, scene }) {
    if (scene === undefined || scene.availableClues.length === 0) return undefined;
    const investigativeActions = context.thisRound.actions.filter(
      (action) => action.actionText !== null && INVESTIGATION_RE.test(action.actionText),
    );
    if (investigativeActions.length === 0) return undefined;

    return {
      id: "clue_reveal",
      priority: "high",
      instruction:
        "조사 행동이 있으므로 SCENE.availableClues 중 하나를 hint/partial/full 수준으로 드러낼지 판단하세요. 이미 revealedClues에 있는 단서는 반복 공개하지 마세요.",
      data: {
        availableClues: [...scene.availableClues],
        alreadyRevealed: [...scene.revealedClues],
        investigativeCharacters: investigativeActions.map((action) => action.characterName),
      },
    };
  },
};

const pressureClockHandler: GmProcedureHandler = {
  id: "pressure_clock",
  buildHint({ context, clocks, scene }) {
    const activeClocks = (clocks ?? []).filter((clock) => clock.value < clock.max);
    if (activeClocks.length === 0) return undefined;

    const hasPass = context.thisRound.actions.some(
      (action) => action.actionKind === "pass" || action.actionKind === "auto_pass",
    );
    const hasSceneTension = scene?.currentTension.trim() ? true : false;
    if (!hasPass && !hasSceneTension) return undefined;

    return {
      id: "pressure_clock",
      priority: hasPass ? "high" : "medium",
      instruction:
        "압박이 살아 있습니다. 지체, 실패, 부분 성공이 있으면 관련 clockDelta를 제안하고, 성공이면 위험이 어떻게 잠시 억제되는지 서술하세요.",
      data: {
        clockIds: activeClocks.map((clock) => clock.id),
        passOrAutoPassPresent: hasPass,
        currentTension: scene?.currentTension ?? "",
      },
    };
  },
};

/**
 * The Alexandrian Three Clue Rule: every conclusion that matters should stay
 * reachable through at least three clue paths. Advises when an undiscovered
 * secret's remaining clue paths are running thin so the GM widens access
 * instead of gating the mystery on a single roll.
 */
const threeClueRuleHandler: GmProcedureHandler = {
  id: "three_clue_rule",
  buildHint({ blackboard }) {
    if (blackboard === undefined || blackboard.secrets.length === 0) return undefined;
    const thin = blackboard.secrets
      .filter((secret) => secret.revealState !== "revealed")
      .map((secret) => ({
        secretId: secret.id,
        undiscoveredPaths: secret.relatedClueIds.filter((clueId) =>
          blackboard.clues.some(
            (clue) => clue.id === clueId && clue.visibility === "undiscovered",
          ),
        ).length,
        totalPaths: secret.relatedClueIds.length,
      }))
      .filter((entry) => entry.totalPaths < 3 || entry.undiscoveredPaths <= 1);
    if (thin.length === 0) return undefined;

    return {
      id: "three_clue_rule",
      priority: "medium",
      instruction:
        "three-clue-rule: 아래 secret들은 남은 단서 경로가 얇습니다. 새 단서 경로를 열거나(대화, 장면 묘사, " +
        "check 결과) 기존 단서를 다른 방식으로도 접근 가능하게 만들어, 중요한 결론이 단일 경로에 갇히지 않게 하세요.",
      data: { secrets: thin },
    };
  },
};

export const GM_PROCEDURE_HANDLERS: readonly GmProcedureHandler[] = [
  characterSpotlightHandler,
  clueRevealHandler,
  threeClueRuleHandler,
  pressureClockHandler,
];

/**
 * Select the procedure handlers a {@link import("../core/game-profile.js").GameProfile}
 * enables. The narration critic is not a hint handler; it stays active through
 * {@link critiqueNarration} regardless of profile.
 */
export function handlersForEnabledProcedures(
  enabledProcedures: readonly GmProcedureId[],
): readonly GmProcedureHandler[] {
  const enabled = new Set(enabledProcedures);
  return GM_PROCEDURE_HANDLERS.filter((handler) => enabled.has(handler.id));
}

export function buildGmProcedurePlan(
  input: GmProcedureInput,
  handlers: readonly GmProcedureHandler[] = GM_PROCEDURE_HANDLERS,
): GmProcedurePlan {
  return {
    hints: handlers.flatMap((handler) => {
      const hint = handler.buildHint(input);
      return hint === undefined ? [] : [hint];
    }),
    criticChecks: [
      "narration must not expose hidden GM rolls as rolls or dice",
      "narration must not reveal clue ids that remain in SCENE.availableClues",
      "narration must not assert state changes that were only proposed",
      "narration should move the scene forward and reflect every submitted action",
    ],
  };
}

export function formatGmProcedurePlan(plan: GmProcedurePlan): string {
  return (
    "GM_PROCEDURE_HINTS (서버가 계산한 GM 운영 절차 힌트입니다. 상태 변경 명령이 아니라 판단 보조입니다): " +
    JSON.stringify(plan.hints) +
    "\n" +
    "NARRATION_CRITIC_CHECKS (내레이션 작성 전 스스로 점검할 항목입니다): " +
    JSON.stringify(plan.criticChecks) +
    "\n"
  );
}

export function critiqueNarration(input: NarrationCritiqueInput): NarrationCritique {
  const warnings: NarrationCritiqueWarning[] = [];
  const { narration, resolvedChecks, scene, safetyProfile } = input;

  if (safetyProfile !== undefined) {
    const violations = findSafetyViolations(narration, safetyProfile);
    if (violations.length > 0) {
      warnings.push({
        code: "banned_topic_in_narration",
        message: "Narration touches a banned topic from the session safety profile.",
        detail: violations.join(", "),
      });
    }
  }

  if (scene !== undefined) {
    const leaked = scene.availableClues.find((clueId) => narration.includes(clueId));
    if (leaked !== undefined) {
      warnings.push({
        code: "unrevealed_clue_id_leaked",
        message: "Narration mentions a clue id that is still unrevealed in Scene State.",
        detail: leaked,
      });
    }
  }

  const hasHiddenCheck = resolvedChecks.some((check) => check.visibility === "gm");
  if (hasHiddenCheck && HIDDEN_ROLL_RE.test(narration)) {
    warnings.push({
      code: "hidden_gm_roll_exposed",
      message: "Narration exposes a hidden GM roll as a roll/check instead of folding it into fiction.",
    });
  }

  return { passed: warnings.length === 0, warnings };
}
