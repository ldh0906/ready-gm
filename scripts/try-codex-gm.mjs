// Live GM playtest: drive the AI GM coordinator with a local CLI model.
//
// Runs opening -> one round resolution -> ending through the REAL engine
// (AiGmRouter + AiGmCoordinator + Dice + EZFudge). The GM brain is chosen by
// AI_GM_CLI: `codex` (default, gpt-5.5 / low effort) or `claude` (sonnet).
// Backend-only: no HTTP server, no port, no static serving — it never touches
// the frontend (public/). Prints the Korean narration + writes out/gm-session.md.
//
// Usage:
//   npm run gm:demo                       (codex, default)
//   set AI_GM_CLI=claude && npm run gm:demo   (claude, Windows cmd)
import { createCliAiGmClient, AiGmRouter, AiGmCoordinator } from "../dist/ai/index.js";
import { makeEngineConfig } from "../dist/core/config.js";
import { createDiceService } from "../dist/core/dice.js";
import { MVP_SCENARIO } from "../dist/services/scenario-service.js";
import { seedClocksForScenario } from "../dist/services/scenario-clocks.js";
import { toContext } from "../dist/services/turn-state-context.js";
import { mkdirSync, writeFileSync } from "node:fs";

const ROOM = "demo-room";

// Force UTF-8 on stdout so Korean prints correctly even when the host console
// code page is not UTF-8 (Windows). All output is ALSO written to a UTF-8 file
// so it renders cleanly in an editor regardless of the console encoding.
process.stdout.setEncoding?.("utf8");
const transcript = [];
function log(t = "") {
  const s = String(t);
  transcript.push(s);
  process.stdout.write(s + "\n");
}

// Cap retries to keep the (slow, billed) Codex calls bounded for the demo.
const config = makeEngineConfig({ aiMaxRetries: 1 });

const client = createCliAiGmClient(process.env); // AI_GM_CLI: codex (default) | claude
const provider = (process.env.AI_GM_CLI ?? "codex").toLowerCase();
log(`[GM brain] ${provider}`);
const router = new AiGmRouter({ client, config });
const dice = createDiceService(config.diceRange); // server-side CSPRNG
const coordinator = new AiGmCoordinator({ router, dice, config });

const characters = [
  {
    id: "c1", playerId: "p1", roomId: ROOM, name: "보린",
    concept: "험상궂은 드워프 전사", attributes: { Might: 2, Agility: 0, Wits: 1, Spirit: 1 },
    confirmed: true,
  },
  {
    id: "c2", playerId: "p2", roomId: ROOM, name: "아리아",
    concept: "재빠른 인간 도적", attributes: { Might: 0, Agility: 2, Wits: 1, Spirit: 0 },
    confirmed: true,
  },
];

/** A Turn_State in `resolving` with both players' actions submitted. */
const resolvingState = {
  roomId: ROOM,
  roundNumber: 1,
  phase: "resolving",
  readiness: [
    { playerId: "p1", status: "ready", actionKind: "confirmed_action", actionText: "봉인된 문을 힘으로 민다" },
    { playerId: "p2", status: "ready", actionKind: "confirmed_action", actionText: "함정이 있는지 자물쇠를 살핀다" },
  ],
  chatLog: [],
  checks: [],
  narrativeContext: [],
  readyCheckDeadline: null,
  readyCheckTimeoutMs: config.readyCheckTimeoutMs,
  resolutionRequested: true,
};

function line(t) { log("\n" + "=".repeat(70) + "\n" + t + "\n" + "=".repeat(70)); }

async function main() {
  const openingCtx = toContext(
    { ...resolvingState, phase: "free_chat", roundNumber: 1, readiness: [] },
    MVP_SCENARIO,
    characters,
  );

  line("1) OPENING (generateOpening)");
  const opening = await coordinator.generateOpening(openingCtx);
  log(opening.ok ? opening.value : `FAILED: ${opening.error.reason} — ${opening.error.message}`);

  line("2) ROUND RESOLUTION (resolveRound: AI picks checks -> server dice -> EZFudge -> narration)");
  // Supply the scenario's Progress Clocks. For the demo, pre-fill the scene
  // alarm to 5/6 so a single round's clockDelta can FILL it and the GM narrates
  // the consequence in the same beat.
  const clocks = seedClocksForScenario(MVP_SCENARIO.id).map((c) =>
    c.id === "crypt_alert" ? { ...c, value: 5 } : c,
  );
  log("[clocks before]");
  for (const c of clocks) log(`  - ${c.name}: ${c.value}/${c.max}`);
  const resolved = await coordinator.resolveRound({ state: resolvingState, scenario: MVP_SCENARIO, characters, clocks });
  if (resolved.ok) {
    log("[server-resolved checks]");
    for (const c of resolved.checks) {
      log(`  - ${c.characterId} / ${c.attribute} vs ${c.difficulty}: roll=${c.roll} => ${c.outcome}`);
    }
    log("\n[clocks after]");
    for (const c of resolved.clocks ?? []) log(`  - ${c.name}: ${c.value}/${c.max}`);
    if ((resolved.firedClocks ?? []).length > 0) log(`[fired] ${resolved.firedClocks.join(", ")}`);
    log("\n[GM narration]\n" + resolved.narration);
    log("\nendingReached: " + resolved.endingReached);
  } else {
    log(`FAILED: ${resolved.error.reason} — ${resolved.error.message}`);
  }

  line("3) ENDING (generateEnding: closing narration + session summary)");
  const endCtx = toContext(
    { ...resolvingState, phase: "ended", narrativeContext: resolved.ok ? [{ round: 1, text: resolved.narration }] : [] },
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

  // Persist the full transcript as UTF-8 so it renders cleanly in any editor,
  // independent of the host console code page.
  mkdirSync("out", { recursive: true });
  writeFileSync("out/gm-session.md", transcript.join("\n"), "utf8");
  process.stdout.write("\n[saved] out/gm-session.md (UTF-8)\n");
}

main().catch((err) => { console.error(err); process.exit(1); });
