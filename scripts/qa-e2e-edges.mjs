// QA E2E edge-case probe: revise-after-confirm, chat-during-rolling, duplicate
// roll_check, rolling someone else's check, and mid-rolling reconnect — against
// a running server. Records to out/playtest-logs/qa-e2e-<label>.jsonl like qa-e2e-harness.mjs.
//
// Usage: node scripts/qa-e2e-edges.mjs <label> [scenarioId]
import WebSocket from "ws";
import { mkdirSync, appendFileSync } from "node:fs";

const BASE = process.env.QA_BASE ?? "http://127.0.0.1:8787";
const WS_BASE = BASE.replace(/^http/, "ws");
const [, , LABEL = "edges", SCENARIO = ""] = process.argv;
const OUT = `out/playtest-logs/qa-e2e-${LABEL}.jsonl`;
mkdirSync("out/playtest-logs", { recursive: true });

const t0 = Date.now();
function log(record) {
  appendFileSync(OUT, JSON.stringify({ t: Date.now() - t0, ...record }) + "\n", "utf8");
  const brief = record.kind === "ws" ? `${record.who} <- ${record.event?.type}` : record.kind;
  process.stdout.write(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${brief}${record.note ? " :: " + record.note : ""}\n`);
}
const anomaly = (note, extra = {}) => log({ kind: "anomaly", note, ...extra });

async function api(method, path, body, ticket) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(ticket ? { "x-connection-ticket": ticket } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  log({ kind: "http", method, path, status: res.status, response: json });
  return { status: res.status, json };
}

class P {
  constructor(who, ticket, playerId) { this.who = who; this.ticket = ticket; this.playerId = playerId; this.state = null; this.events = []; this.waiters = []; }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${WS_BASE}/ws?ticket=${encodeURIComponent(this.ticket)}`);
      this.ws.on("open", () => { log({ kind: "ws_open", who: this.who }); resolve(); });
      this.ws.on("error", (e) => { anomaly(`ws error ${this.who}: ${e.message}`); reject(e); });
      this.ws.on("message", (raw) => {
        let ev; try { ev = JSON.parse(String(raw)); } catch { return; }
        this.events.push(ev);
        log({ kind: "ws", who: this.who, event: ev });
        if (ev.type === "turn_state" && ev.state) this.state = ev.state;
        for (const w of [...this.waiters]) if (w.pred(ev, this)) { this.waiters.splice(this.waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(ev); }
      });
    });
  }
  send(msg) { log({ kind: "send", who: this.who, msg }); this.ws.send(JSON.stringify(msg)); }
  waitFor(desc, pred, ms = 240000) {
    return new Promise((resolve) => {
      if (this.state !== null && pred({ type: "turn_state", state: this.state }, this)) { resolve({ type: "turn_state", state: this.state }); return; }
      const timer = setTimeout(() => { this.waiters = this.waiters.filter((w) => w.timer !== timer); anomaly(`TIMEOUT: ${desc} (${this.who})`, { phase: this.state?.phase }); resolve(null); }, ms);
      this.waiters.push({ pred, resolve, timer });
    });
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  log({ kind: "run_start", label: LABEL, scenario: SCENARIO });
  const host = await api("POST", "/rooms", { displayName: "라면", ...(SCENARIO ? { scenarioId: SCENARIO } : {}) });
  const { roomId, inviteToken, hostPlayerId, connectionToken: t1 } = host.json;
  const guest = await api("POST", `/rooms/${inviteToken}/join`, { displayName: "친구" });
  const { playerId: p2id, connectionToken: t2 } = guest.json;

  const schemaRes = await api("GET", `/rooms/${roomId}/sheet-schema`);
  const attrs = {};
  for (const t of schemaRes.json?.traits ?? []) attrs[t.key] = 1;
  for (const [i, [pid, tk]] of [[hostPlayerId, t1], [p2id, t2]].entries()) {
    await api("POST", `/rooms/${roomId}/players/${pid}/character`, { name: i === 0 ? "보린" : "아리아", narrative: { concept: "모험가" }, ...(Object.keys(attrs).length ? { attributes: attrs } : {}) }, tk);
    await api("POST", `/rooms/${roomId}/players/${pid}/character/confirm`, {}, tk);
  }

  // EDGE A (pre-start): sheet-views privacy — guest must not see host's private fields.
  const sv = await api("GET", `/rooms/${roomId}/sheet-views`, undefined, t2);
  if (sv.status !== 200) anomaly(`sheet-views status ${sv.status}`);

  await api("POST", `/rooms/${roomId}/players/${hostPlayerId}/start`, {}, t1);
  const p1 = new P("p1(host)", t1, hostPlayerId);
  const p2 = new P("p2", t2, p2id);
  await p1.connect(); await p2.connect();
  await p1.waitFor("round1 free_chat", (e) => e.type === "turn_state" && e.state?.phase === "free_chat" && e.state?.roundNumber >= 1);

  // EDGE B: confirm -> revise -> confirm (final action should win).
  p1.send({ type: "confirm", action: "문을 그냥 연다" });
  await sleep(400);
  p1.send({ type: "revise" });
  await sleep(400);
  p1.send({ type: "confirm", action: "문 앞에서 함정 철사를 먼저 끊는다" });
  await sleep(400);
  p2.send({ type: "confirm", action: "복도 안쪽의 소리에 귀를 기울인다" });

  // EDGE C: while rolling — chat (locked), duplicate roll, foreign roll.
  const pending = await p1.waitFor("checks_pending", (e) => e.type === "checks_pending" && Array.isArray(e.checks) && e.checks.length > 0, 300000);
  if (pending !== null) {
    const mine = pending.checks.filter((c) => c.playerId === hostPlayerId && c.status === "pending");
    const theirs = pending.checks.filter((c) => c.playerId !== hostPlayerId && c.status === "pending");
    p1.send({ type: "chat", text: "롤링 중 채팅 시도" }); // should be rejected by phase rules
    await sleep(300);
    if (theirs.length > 0) p1.send({ type: "roll_check", checkId: theirs[0].checkId }); // must be ignored
    await sleep(300);
    for (const c of mine) { p1.send({ type: "roll_check", checkId: c.checkId }); p1.send({ type: "roll_check", checkId: c.checkId }); } // duplicate
    // EDGE D: p2 disconnects mid-rolling and reconnects; must rehydrate rollingChecks + deadline and still roll.
    if (theirs.length > 0) {
      p2.ws.close();
      await sleep(1200);
      await p2.connect();
      const hyd = await p2.waitFor("rehydrated rolling state", (e) => e.type === "turn_state" && e.state?.phase === "rolling", 20000);
      if (hyd === null) anomaly("reconnect: no rolling turn_state rehydrated for p2");
      else {
        const rc = hyd.state.rollingChecks ?? [];
        if (!rc.some((c) => c.playerId === p2id && c.status === "pending")) anomaly("reconnect: p2 pending check missing after rehydrate", { rollingChecks: rc });
        if (typeof hyd.state.rollCheckDeadline !== "string") anomaly("reconnect: rollCheckDeadline missing after rehydrate");
        for (const c of rc.filter((c) => c.playerId === p2id && c.status === "pending")) p2.send({ type: "roll_check", checkId: c.checkId });
      }
    }
  }

  const done = await p1.waitFor("round1 resolved", (e) => e.type === "turn_state" && e.state && (e.state.roundNumber > 1 || e.state.phase === "ended"), 300000);
  if (done === null) anomaly("round 1 never resolved");
  await sleep(1500); // let trailing narration frames land

  // Verify: revised action (not the first confirm) is in actionHistory; the rolling-phase chat did NOT enter chat.
  const hist = p1.state?.actionHistory ?? [];
  const mineHist = hist.filter((h) => h.playerId === hostPlayerId && h.round === 1);
  if (!mineHist.some((h) => (h.text ?? "").includes("철사"))) anomaly("revise lost: final confirmed action not in history", { mineHist });
  if (mineHist.length !== 1) anomaly(`history has ${mineHist.length} entries for p1 round1 (expected 1)`, { mineHist });
  const narrCount = p1.events.filter((e) => e.type === "narration" && e.narration?.kind === "resolution").length;
  if (narrCount < 1) anomaly("no resolution narration received by p1");
  const chatEchoed = p1.events.some((e) => e.type === "chat" && (e.text ?? e.entry?.text ?? "").includes("롤링 중 채팅"));
  if (chatEchoed) anomaly("chat during rolling was accepted (should be locked)");

  log({ kind: "run_end", finalPhase: p1.state?.phase, finalRound: p1.state?.roundNumber });
  p1.ws.close(); p2.ws.close();
  process.exit(0);
}

main().catch((err) => { anomaly(`harness crash: ${err.stack ?? err}`); process.exit(1); });
