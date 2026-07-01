// Multi-round GM playtest: drive N round resolutions through the REAL engine
// with persistent Progress Clocks + accumulating narrative context.
//
// The GM brain is chosen by AI_GM_CLI (codex default / low effort, or claude).
// Backend-only: no HTTP server, no port, no frontend. Prints each round +
// writes out/gm-rounds.md.
//
// Usage:
//   node scripts/play-rounds.mjs            (10 rounds, codex)
//   node scripts/play-rounds.mjs 5          (5 rounds)
//   set AI_GM_CLI=claude && node scripts/play-rounds.mjs 3
import { createCliAiGmClient, AiGmRouter, AiGmCoordinator } from "../dist/ai/index.js";
import { makeEngineConfig } from "../dist/core/config.js";
import { createDiceService } from "../dist/core/dice.js";
import { MVP_SCENARIO } from "../dist/services/scenario-service.js";
import { seedClocksForScenario } from "../dist/services/scenario-clocks.js";
import { toContext } from "../dist/services/turn-state-context.js";
import { mkdirSync, writeFileSync } from "node:fs";

const ROOM = "demo-room";
const ROUNDS = Math.max(1, Number.parseInt(process.argv[2] ?? "10", 10) || 10);

process.stdout.setEncoding?.("utf8");
const transcript = [];
function log(t = "") {
  const s = String(t);
  transcript.push(s);
  process.stdout.write(s + "\n");
}
function line(t) { log("\n" + "=".repeat(70) + "\n" + t + "\n" + "=".repeat(70)); }

const config = makeEngineConfig({ aiMaxRetries: 1 });
const client = createCliAiGmClient(process.env);
const provider = (process.env.AI_GM_CLI ?? "codex").toLowerCase();
const router = new AiGmRouter({ client, config });
const dice = createDiceService(config.diceRange);
const coordinator = new AiGmCoordinator({ router, dice, config });

const characters = [
  { id: "c1", playerId: "p1", roomId: ROOM, name: "보린", concept: "험상궂은 드워프 전사", attributes: { Might: 2, Agility: 0, Wits: 1, Spirit: 1 }, confirmed: true },
  { id: "c2", playerId: "p2", roomId: ROOM, name: "아리아", concept: "재빠른 인간 도적", attributes: { Might: 0, Agility: 2, Wits: 1, Spirit: 0 }, confirmed: true },
];

// A rotating pool of plausible actions so each round differs a little.
const ACTIONS = [
  ["봉인된 문을 힘으로 민다", "함정이 있는지 자물쇠를 살핀다"],
  ["복도 끝의 종소리 쪽으로 다가간다", "벽의 룬 문양을 해석하려 한다"],
  ["무너진 천장 잔해를 치운다", "바닥의 작은 발자국을 추적한다"],
  ["다가오는 적을 도끼로 막아선다", "그림자 속으로 숨어 측면을 노린다"],
  ["갈라진 봉인 틈을 들여다본다", "아이들의 흔적을 찾아 방을 뒤진다"],
  ["물 찬 통로를 건넌다", "천장에서 들리는 소리에 귀를 기울인다"],
  ["제단의 의식 도구를 부순다", "끌려간 아이의 신발을 단서로 살핀다"],
  ["창백한 시종에게 위협적으로 다가간다", "시종의 주의를 돌릴 틈을 노린다"],
  ["봉인을 강제로 부수려 도끼를 휘두른다", "탈출로를 확보하려 통로를 정찰한다"],
  ["깨어나는 존재를 정면으로 막아선다", "아이들을 이끌고 출구로 달린다"],
];

async function main() {
  log(`[GM brain] ${provider}`);
  log(`[rounds] ${ROUNDS}`);

  // --- Opening --------------------------------------------------------------
  const openingCtx = toContext(
    { roomId: ROOM, roundNumber: 1, phase: "free_chat", readiness: [], chatLog: [], checks: [], narrativeContext: [], readyCheckDeadline: null, readyCheckTimeoutMs: config.readyCheckTimeoutMs, resolutionRequested: false },
    MVP_SCENARIO,
    characters,
  );
  line("OPENING");
  const opening = await coordinator.generateOpening(openingCtx);
  log(opening.ok ? opening.value : `FAILED: ${opening.error.reason} — ${opening.error.message}`);

  // --- Rounds ---------------------------------------------------------------
  let clocks = seedClocksForScenario(MVP_SCENARIO.id);
  const narrativeContext = []; // accumulates resolution narration (newest last)
  let endingReached = false;
  let lastRound = 0;

  for (let r = 1; r <= ROUNDS && !endingReached; r++) {
    lastRound = r;
    const [a1, a2] = ACTIONS[(r - 1) % ACTIONS.length];
    const state = {
      roomId: ROOM,
      roundNumber: r,
      phase: "resolving",
      readiness: [
        { playerId: "p1", status: "ready", actionKind: "confirmed_action", actionText: a1 },
        { playerId: "p2", status: "ready", actionKind: "confirmed_action", actionText: a2 },
      ],
      chatLog: [],
      checks: [],
      narrativeContext: narrativeContext.slice(-10),
      readyCheckDeadline: null,
      readyCheckTimeoutMs: config.readyCheckTimeoutMs,
      resolutionRequested: true,
    };

    line(`ROUND ${r}`);
    log(`보린: ${a1}\n아리아: ${a2}`);
    log("[clocks before] " + clocks.map((c) => `${c.name} ${c.value}/${c.max}`).join(" | "));

    const result = await coordinator.resolveRound({ state, scenario: MVP_SCENARIO, characters, clocks });
    if (!result.ok) {
      log(`FAILED: ${result.error.reason} — ${result.error.message}`);
      continue; // keep clocks/state; try the next round
    }

    for (const c of result.checks) {
      log(`  - ${c.characterId} / ${c.attribute} vs ${c.difficulty}: roll=${c.roll} => ${c.outcome}`);
    }
    clocks = result.clocks ?? clocks;
    log("[clocks after]  " + clocks.map((c) => `${c.name} ${c.value}/${c.max}`).join(" | "));
    if ((result.firedClocks ?? []).length > 0) log(`[FIRED] ${result.firedClocks.join(", ")}`);
    log("\n" + result.narration);

    narrativeContext.push({ round: r, text: result.narration });
    endingReached = result.endingReached;
    if (endingReached) log("\n>>> endingReached = true");
  }

  // --- Ending ---------------------------------------------------------------
  line("ENDING");
  const endCtx = toContext(
    { roomId: ROOM, roundNumber: lastRound, phase: "ended", readiness: [], chatLog: [], checks: [], narrativeContext: narrativeContext.slice(-10), readyCheckDeadline: null, readyCheckTimeoutMs: config.readyCheckTimeoutMs, resolutionRequested: false },
    MVP_SCENARIO,
    characters,
  );
  const ending = await coordinator.generateEnding(endCtx);
  if (ending.ok) {
    log("[closing]\n" + ending.value.closing + "\n\n[summary]\n" + ending.value.summary.text);
  } else {
    log(`FAILED: ${ending.error.reason} — ${ending.error.message}`);
  }

  line("DONE");
  log("[final clocks] " + clocks.map((c) => `${c.name} ${c.value}/${c.max}`).join(" | "));

  mkdirSync("out", { recursive: true });
  writeFileSync("out/gm-rounds.md", transcript.join("\n"), "utf8");
  process.stdout.write("\n[saved] out/gm-rounds.md (UTF-8)\n");
}

main().catch((err) => { console.error(err); process.exit(1); });
