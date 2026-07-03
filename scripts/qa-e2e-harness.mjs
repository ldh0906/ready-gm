// QA E2E harness: drives REAL multiplayer sessions over HTTP + /ws against a
// running server (default http://127.0.0.1:8787) and records every event per
// player to a JSONL file for QA analysis. No assertions abort the run; every
// anomaly is logged as an `anomaly` record and the run continues.
//
// Usage:
//   node scripts/qa-e2e-harness.mjs <label> <scenarioId> <planSpec> [--autoroll-round=N]
//
//   planSpec: semicolon-separated rounds, each "p1Action|p2Action" where an
//   action is "confirm:<text>", "pass", or "chat:<text>+confirm:<text>".
//   Example: "confirm:문을 민다|pass;confirm:귀를 기울인다|confirm:벽을 살핀다"
//
// Output: out/playtest-logs/qa-e2e-<label>.jsonl (one JSON record per line)
import WebSocket from "ws";
import { mkdirSync, appendFileSync } from "node:fs";

const BASE = process.env.QA_BASE ?? "http://127.0.0.1:8787";
const WS_BASE = BASE.replace(/^http/, "ws");
const [, , LABEL = "run", SCENARIO = "", PLAN_SPEC = "", ...FLAGS] = process.argv;
const AUTOROLL_ROUND = Number((FLAGS.find((f) => f.startsWith("--autoroll-round=")) ?? "").split("=")[1] ?? NaN);
const OUT = `out/playtest-logs/qa-e2e-${LABEL}.jsonl`;
mkdirSync("out/playtest-logs", { recursive: true });

const t0 = Date.now();
function log(record) {
  const line = JSON.stringify({ t: Date.now() - t0, ...record });
  appendFileSync(OUT, line + "\n", "utf8");
  const brief = record.kind === "ws" ? `${record.who} <- ${record.event?.type}` : record.kind;
  process.stdout.write(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${brief}${record.note ? " :: " + record.note : ""}\n`);
}
function anomaly(note, extra = {}) {
  log({ kind: "anomaly", note, ...extra });
}

async function api(method, path, body, ticket) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(ticket ? { "x-connection-ticket": ticket } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  log({ kind: "http", method, path, status: res.status, response: json });
  return { status: res.status, json };
}

// ---- Player: WS wrapper that records everything and tracks latest state ----
class QaPlayer {
  constructor(who, roomId, playerId, ticket) {
    this.who = who;
    this.roomId = roomId;
    this.playerId = playerId;
    this.ticket = ticket;
    this.state = null; // latest turn_state.state
    this.narrations = [];
    this.pendingChecks = [];
    this.waiters = [];
    this.allEvents = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${WS_BASE}/ws?ticket=${encodeURIComponent(this.ticket)}`);
      this.ws.on("open", () => { log({ kind: "ws_open", who: this.who }); resolve(); });
      this.ws.on("error", (err) => { anomaly(`ws error ${this.who}: ${err.message}`); reject(err); });
      this.ws.on("close", (code) => log({ kind: "ws_close", who: this.who, code }));
      this.ws.on("message", (raw) => {
        let event;
        try { event = JSON.parse(String(raw)); } catch { anomaly(`non-JSON ws frame to ${this.who}`); return; }
        this.allEvents.push(event);
        log({ kind: "ws", who: this.who, event });
        if (event.type === "turn_state" && event.state) {
          this.state = event.state;
          // Leak scans on every state delivery.
          const s = JSON.stringify(event.state);
          if (s.includes('"fronts"')) anomaly(`LEAK: fronts in turn_state for ${this.who}`);
          if (s.includes('"truth"')) anomaly(`LEAK: secret truth in turn_state for ${this.who}`);
        }
        if (event.type === "checks_pending" && Array.isArray(event.checks)) {
          this.pendingChecks = event.checks;
        }
        if (event.type === "narration") this.narrations.push(event.narration);
        for (const w of [...this.waiters]) {
          if (w.pred(event, this)) {
            this.waiters.splice(this.waiters.indexOf(w), 1);
            clearTimeout(w.timer);
            w.resolve(event);
          }
        }
      });
    });
  }
  send(msg) {
    log({ kind: "send", who: this.who, msg });
    this.ws.send(JSON.stringify(msg));
  }
  waitFor(desc, pred, timeoutMs) {
    return new Promise((resolve) => {
      // Check the latest state first for phase predicates.
      if (pred({ type: "turn_state", state: this.state }, this) && this.state !== null) {
        resolve({ type: "turn_state", state: this.state });
        return;
      }
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        anomaly(`TIMEOUT waiting for ${desc} (${this.who}, ${timeoutMs}ms)`, { phase: this.state?.phase, round: this.state?.roundNumber });
        resolve(null);
      }, timeoutMs);
      this.waiters.push({ pred, resolve, timer });
    });
  }
  waitPhase(phase, round, timeoutMs = 240000) {
    return this.waitFor(
      `phase=${phase} round>=${round}`,
      (e) => e.type === "turn_state" && e.state && e.state.phase === phase && (e.state.roundNumber ?? 0) >= round,
      timeoutMs,
    );
  }
}

// ---- Flow ------------------------------------------------------------------
function parsePlan(spec) {
  if (!spec) return [];
  return spec.split(";").map((round) => round.split("|").map((a) => a.trim()));
}

async function performAction(player, action) {
  for (const part of action.split("+")) {
    if (part === "pass") player.send({ type: "pass" });
    else if (part.startsWith("confirm:")) player.send({ type: "confirm", action: part.slice(8) });
    else if (part.startsWith("chat:")) player.send({ type: "chat", text: part.slice(5) });
    else if (part === "none") { /* do nothing */ }
    else anomaly(`unknown plan action: ${part}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function main() {
  log({ kind: "run_start", label: LABEL, scenario: SCENARIO, plan: PLAN_SPEC, autorollRound: AUTOROLL_ROUND || null });

  // Room + players
  const host = await api("POST", "/rooms", { displayName: "라면", ...(SCENARIO ? { scenarioId: SCENARIO } : {}) });
  if (host.status !== 201) { anomaly(`room create failed ${host.status}`); return; }
  const { roomId, inviteToken, hostPlayerId, connectionToken: hostTicket } = host.json;
  const guest = await api("POST", `/rooms/${inviteToken}/join`, { displayName: "친구" });
  if (guest.status !== 201) { anomaly(`join failed ${guest.status}`); return; }
  const { playerId: guestId, connectionToken: guestTicket } = guest.json;

  // Characters: use the room's sheet schema to build minimally valid payloads.
  const schemaRes = await api("GET", `/rooms/${roomId}/sheet-schema`);
  const schema = schemaRes.json?.schema ?? schemaRes.json;
  const attrs = {};
  const traitSpecs = schema?.attributes?.traits ?? schema?.traits ?? [];
  const mode = schema?.attributes?.allocation?.mode ?? "";
  for (const t of traitSpecs) {
    attrs[t.key ?? t.id] = 1; // adjusted below for point budgets
  }
  // EZFudge-style default that passes point-buy style validation if present.
  if (Object.keys(attrs).length === 4) Object.assign(attrs, { [Object.keys(attrs)[0]]: 2, [Object.keys(attrs)[1]]: 0 });
  const cards = schema?.characterCards ?? [];
  const mkChar = (i) => ({
    name: i === 0 ? "보린" : "아리아",
    narrative: { concept: i === 0 ? "험상궂은 전사" : "재빠른 도적" },
    ...(Object.keys(attrs).length > 0 ? { attributes: attrs } : {}),
    ...(cards.length > i ? { selectedCardId: cards[i].id } : {}),
  });
  for (const [i, [pid, ticket]] of [[hostPlayerId, hostTicket], [guestId, guestTicket]].entries()) {
    const rec = await api("POST", `/rooms/${roomId}/players/${pid}/character`, mkChar(i), ticket);
    if (rec.json?.ok !== true) anomaly(`character record not ok for player ${i}`, { response: rec.json });
    const conf = await api("POST", `/rooms/${roomId}/players/${pid}/character/confirm`, {}, ticket);
    if (conf.json?.ok !== true) anomaly(`character confirm not ok for player ${i}`, { response: conf.json });
  }

  // Start session (host)
  const start = await api("POST", `/rooms/${roomId}/players/${hostPlayerId}/start`, {}, hostTicket);
  if (start.json?.ok !== true) { anomaly(`session start failed`, { response: start.json }); return; }

  // Connect both players
  const p1 = new QaPlayer("p1(host)", roomId, hostPlayerId, hostTicket);
  const p2 = new QaPlayer("p2", roomId, guestId, guestTicket);
  await p1.connect();
  await p2.connect();

  // Opening narration arrives via ws; wait for round 1 free_chat.
  await p1.waitPhase("free_chat", 1, 240000);

  const plan = parsePlan(PLAN_SPEC);
  for (let r = 1; r <= plan.length; r++) {
    const [a1, a2] = plan[r - 1];
    log({ kind: "round_start", round: r, a1, a2 });
    const ok = await p1.waitPhase("free_chat", r, 300000);
    if (ok === null) break;
    const narrBefore = p1.narrations.length;
    const historyBefore = (p1.state?.actionHistory ?? []).length;

    await performAction(p1, a1);
    await performAction(p2, a2);

    // Rolling phase (may be skipped if the GM needs no rolls).
    const skipRolls = AUTOROLL_ROUND === r;
    const roundDone = (e) =>
      (e.type === "turn_state" && e.state && ((e.state.roundNumber ?? 0) > r || e.state.phase === "ended"));

    // Roll own pending checks as they appear, until the round advances.
    const roller = async (player) => {
      while (true) {
        const evt = await player.waitFor(
          `checks_pending or round>${r}`,
          (e, self) =>
            roundDone(e) ||
            (e.type === "checks_pending" && Array.isArray(e.checks) && e.checks.some((c) => c.playerId === self.playerId && c.status === "pending")),
          300000,
        );
        if (evt === null || roundDone(evt)) return;
        if (skipRolls) { log({ kind: "note", note: `round ${r}: skipping manual rolls (auto-roll test)` }); return; }
        for (const c of evt.checks.filter((c) => c.playerId === player.playerId && c.status === "pending")) {
          await new Promise((rr) => setTimeout(rr, 800));
          player.send({ type: "roll_check", checkId: c.checkId });
        }
        return;
      }
    };
    await Promise.all([roller(p1), roller(p2)]);

    // Wait for the round to fully resolve (next round's free_chat or ended).
    const done = await p1.waitFor(`round ${r} resolution`, roundDone, skipRolls ? 300000 : 240000);
    if (done === null) { anomaly(`round ${r}: never advanced past resolution`, { phase: p1.state?.phase }); break; }

    // Post-round invariants
    if (p1.narrations.length <= narrBefore) anomaly(`round ${r}: NO narration delivered to p1 this round`);
    if (p2.narrations.length !== p1.narrations.length) anomaly(`round ${r}: narration count differs p1=${p1.narrations.length} p2=${p2.narrations.length}`);
    const historyAfter = (p1.state?.actionHistory ?? []).length;
    const actedCount = [a1, a2].filter((a) => a.includes("confirm") || a.includes("pass")).length;
    if (historyAfter < historyBefore + actedCount) {
      anomaly(`round ${r}: actionHistory did not grow as expected (${historyBefore} -> ${historyAfter}, expected +${actedCount})`);
    }
    if (p1.state?.phase === "ended") { log({ kind: "note", note: "session ended" }); break; }
  }

  log({ kind: "run_end", finalPhase: p1.state?.phase, finalRound: p1.state?.roundNumber, narrations: p1.narrations.length });
  p1.ws.close();
  p2.ws.close();
  process.exit(0);
}

main().catch((err) => { anomaly(`harness crash: ${err.stack ?? err}`); process.exit(1); });
