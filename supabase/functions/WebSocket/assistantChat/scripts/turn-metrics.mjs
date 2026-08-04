#!/usr/bin/env node
/**
 * The per-turn success metric, computed from the gateway's own logs.
 *
 * WHY THIS EXISTS. Eight QA rounds were judged by impression: someone used the app, formed a view, and
 * a round was "PASS" or "FAIL". So a fix that helped and a fix that did nothing looked identical, and
 * the same defects kept coming back. D5 put a definition in code — one structured line per turn —
 * and this turns those lines into the number. It is the thing that decides whether reliability is
 * actually improving, and the gate the slot-gating work (E3-E5) is waiting on.
 *
 * THE DEFINITION (chat.mjs, kept in sync deliberately):
 *   ok = no turn error && no recovery fired && no failed write && no unidentified pause && no tool leak
 *
 * `recovered` is NOT success. A turn that needed a retry produced the right answer on the second try,
 * which is precisely the reported flakiness — counting it as a pass is how eight green rounds ended
 * with the bugs still live.
 *
 * USAGE
 *   gcloud logging read \
 *     'resource.labels.service_name="dk-assistant-chat" AND jsonPayload.event="turn"' \
 *     --project <PROJECT> --limit 2000 --format json > turns.json
 *   node scripts/turn-metrics.mjs turns.json
 *
 * Or pipe anything containing the lines — a console export, a copy-paste, a raw log tail:
 *   node scripts/turn-metrics.mjs < whatever.log
 *
 * Tolerant by design: it hunts for the turn objects wherever they are (bare JSON per line, Cloud
 * Run's jsonPayload/textPayload envelopes, or one big JSON array), because the shape you get depends
 * on how you exported and nobody should have to reformat logs to read a number.
 */
import { readFileSync } from "node:fs";

const read = () => {
  const file = process.argv[2];
  if (file) return readFileSync(file, "utf8");
  try { return readFileSync(0, "utf8"); } catch { return ""; }
};

/** Every `{event:"turn"}` object anywhere in the input. */
function collectTurns(text) {
  const turns = [];
  const push = (o) => { if (o && typeof o === "object" && o.event === "turn") turns.push(o); };
  const visit = (node) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== "object") return;
    push(node);
    // Cloud Run wraps our line in jsonPayload; textPayload holds it as a string.
    if (node.jsonPayload) visit(node.jsonPayload);
    if (typeof node.textPayload === "string") {
      try { visit(JSON.parse(node.textPayload)); } catch { /* not one of ours */ }
    }
  };

  const trimmed = text.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try { visit(JSON.parse(trimmed)); } catch { /* fall through to line mode */ }
  }
  if (turns.length) return turns;

  for (const line of text.split(/\r?\n/)) {
    const start = line.indexOf("{");
    if (start === -1) continue;
    try { visit(JSON.parse(line.slice(start))); } catch { /* noise */ }
  }
  return turns;
}

const turns = collectTurns(read());
if (!turns.length) {
  console.error("No turn lines found. Expected objects like {\"at\":\"chat\",\"event\":\"turn\",\"ok\":true,…}.");
  console.error("See the USAGE block at the top of this file for the gcloud query.");
  process.exit(1);
}

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");
const count = (fn) => turns.filter(fn).length;
const n = turns.length;

const ok = count((t) => t.ok === true);
// Each clause of the definition, so a bad rate says WHICH part is failing rather than just "worse".
const clauses = [
  ["turn error", (t) => !!t.error],
  ["recovery fired (retry/nudge)", (t) => (t.extra_attempts ?? 0) > 0],
  ["failed write", (t) => t.failed_write === true],
  ["unidentified pause", (t) => t.unidentified_pause === true],
  ["tool-call-as-text leak", (t) => t.tool_leak === true],
];

console.log(`\n══ ${n} turns ══\n`);
console.log(`  OK                    ${String(ok).padStart(5)}   ${pct(ok, n)}`);
console.log(`  not OK                ${String(n - ok).padStart(5)}   ${pct(n - ok, n)}\n`);

console.log("  why not OK (turns can fail more than one clause)");
for (const [label, fn] of clauses) {
  const c = count(fn);
  console.log(`    ${label.padEnd(30)} ${String(c).padStart(5)}   ${pct(c, n)}`);
}

// end_task uptake decides whether ANY recovery heuristic can be retired — the whole point of shipping
// D8 without deleting anything.
const declared = count((t) => t.end_task);
console.log("\n  end_task (D8): declared on");
console.log(`    ${String(declared).padStart(5)} / ${n}   ${pct(declared, n)}`);
const byStatus = {};
for (const t of turns) if (t.end_task) byStatus[t.end_task] = (byStatus[t.end_task] ?? 0) + 1;
for (const [s, c] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
  console.log(`      ${s.padEnd(20)} ${String(c).padStart(5)}   ${pct(c, declared)} of declared`);
}
if (declared / n < 0.9) {
  console.log("    → below ~90%: the recovery heuristics still have to guess, so none can be retired yet.");
}

// What turns actually produced, and how much work the writes were.
const outcomes = {};
for (const t of turns) outcomes[t.outcome ?? "unknown"] = (outcomes[t.outcome ?? "unknown"] ?? 0) + 1;
console.log("\n  outcome");
for (const [o, c] of Object.entries(outcomes).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${o.padEnd(30)} ${String(c).padStart(5)}   ${pct(c, n)}`);
}

const wrote = count((t) => (t.writes ?? []).length > 0);
const plan = count((t) => t.plan === true);
const auto = count((t) => t.mode === "auto");
console.log("\n  shape");
console.log(`    turns that wrote data          ${String(wrote).padStart(5)}   ${pct(wrote, n)}`);
console.log(`    auto-approve mode              ${String(auto).padStart(5)}   ${pct(auto, n)}`);
console.log(`    plan mode (E0)                 ${String(plan).padStart(5)}   ${pct(plan, n)}`);

const ms = turns.map((t) => t.ms).filter((v) => typeof v === "number").sort((a, b) => a - b);
if (ms.length) {
  const at = (q) => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))];
  console.log(`    duration p50/p90/p99 (ms)      ${at(0.5)} / ${at(0.9)} / ${at(0.99)}`);
}

// The turns worth opening a trace on: each carries its turn_id, which threads to LangSmith.
const failing = turns.filter((t) => t.ok === false);
if (failing.length) {
  console.log("\n  first failing turns (turn_id threads to the LangSmith trace — scripts/trace.mjs)");
  for (const t of failing.slice(0, 10)) {
    const why = clauses.filter(([, fn]) => fn(t)).map(([l]) => l).join(", ") || "NO CLAUSE MATCHED";
    console.log(`    ${t.turn_id}  ${why}`);
  }
}

// A turn the gateway called not-ok that matches none of the clauses above means THIS SCRIPT has drifted
// from chat.mjs's definition — a clause was added there and not here. Worth shouting about: silent
// drift would understate exactly the failures the metric exists to count.
const unexplained = failing.filter((t) => !clauses.some(([, fn]) => fn(t)));
if (unexplained.length) {
  console.log(`\n  ⚠ ${unexplained.length} turn(s) marked not-ok match none of the clauses this script knows.`);
  console.log("    The success definition in chat.mjs has gained a clause that is missing here — add it,");
  console.log("    or this report will keep understating what is failing.");
}
console.log();
