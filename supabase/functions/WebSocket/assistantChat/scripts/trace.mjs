#!/usr/bin/env node
/**
 * Print a LangSmith run's tool calls and their arguments, from a public share URL.
 *
 * WHY THIS EXISTS. Four QA reports in two days were diagnosed from the trace, and in every case the
 * trace overturned or sharpened the theory formed from the description alone:
 *   * "Cancelled for safety" after a successful create → the model had called end_task and Flowise
 *     gated it; the turn had worked perfectly.
 *   * a dead "Verify Addresses" link → a generic Button with an openUrl the model had composed, host
 *     and all, rather than the purpose-built component.
 *   * "I added a semi-transparent band" with no visible change → the band was there, correctly layered,
 *     at `opacity: 0.55` where the spec means a percentage.
 * Each of those took minutes with the trace and would have been guesswork without it.
 *
 * The LangSmith UI renders client-side, so it cannot be read by anything but a browser — but the public
 * API serves the same run as JSON. That is the only trick here, and it is worth not rediscovering.
 *
 * USAGE
 *   node scripts/trace.mjs "https://smith.langchain.com/public/<share>/r/<run>?…"
 *   node scripts/trace.mjs <share-id> <run-id>
 *
 * Prints the tool calls in order with their ARGUMENTS, because the arguments are the claim: a tool's
 * ack is a constant, and what the model actually sent is what explains the bug.
 */
const parse = () => {
  const args = process.argv.slice(2).filter(Boolean);
  if (args.length >= 2 && !args[0].includes("://")) return { share: args[0], run: args[1] };
  const url = args[0];
  if (!url) return null;
  const m = url.match(/\/public\/([0-9a-f-]{36})\/r\/([0-9a-f-]{36})/i);
  return m ? { share: m[1], run: m[2] } : null;
};

const ids = parse();
if (!ids) {
  console.error("Usage: node scripts/trace.mjs <langsmith-public-url>");
  console.error("   or: node scripts/trace.mjs <share-id> <run-id>");
  process.exit(1);
}

const base = `https://api.smith.langchain.com/public/${ids.share}`;
const get = async (id) => {
  const res = await fetch(`${base}/run/${id}`);
  if (!res.ok) throw new Error(`run ${id} → HTTP ${res.status} (is the run still shared publicly?)`);
  return res.json();
};

const root = await get(ids.run);
const meta = root.extra?.metadata ?? {};
console.log(`\n══ ${root.name} ══`);
console.log(`  status   ${root.status}`);
console.log(`  turn_id  ${meta.turn_id ?? "—"}   ← greppable in the gateway logs`);
console.log(`  session  ${meta.session_id ?? "—"}`);
console.log(`  mode     ${meta.mode ?? "—"}    page ${meta.page ?? "—"}`);

const question = String(root.inputs_preview ?? JSON.stringify(root.inputs ?? "") ?? "");
// The injected context block is long and rarely the point; the user's own words sit at the end.
console.log(`\n  user said (tail)\n    …${question.slice(-300).replace(/\n/g, "\n    ")}`);
console.log(`\n  replied\n    ${String(root.outputs_preview ?? "").slice(0, 400)}`);

const runs = [];
const walk = async (id, depth = 0) => {
  if (depth > 4) return;
  const r = await get(id);
  runs.push({ r, depth });
  for (const c of r.direct_child_run_ids ?? []) await walk(c, depth + 1);
};
for (const c of root.direct_child_run_ids ?? []) await walk(c);

console.log(`\n  ${runs.length} child run(s)`);
for (const { r, depth } of runs) {
  const pad = "  ".repeat(depth + 2);
  console.log(`${pad}${String(r.run_type).padEnd(6)} ${r.name}  (${r.status})`);
  if (r.run_type !== "tool") continue;
  // The ARGUMENTS are the claim. A tool's ack is a constant; this is what the model actually sent.
  const input = r.inputs?.input ?? r.inputs;
  const text = JSON.stringify(input, null, 1) ?? "";
  console.log(`${pad}  args: ${text.length > 1800 ? `${text.slice(0, 1800)}\n${pad}  …(${text.length} chars)` : text}`);
  const out = JSON.stringify(r.outputs ?? r.outputs_preview ?? "");
  console.log(`${pad}  out : ${out.slice(0, 400)}`);
}

// Flowise renders a gated or unbindable tool call as prose. Its presence explains a pause, a leak, or a
// tool the flow never bound — and it is easy to miss inside a large payload.
const blob = JSON.stringify(root) + JSON.stringify(runs.map((x) => x.r));
if (blob.includes("Attempting to use tool")) {
  console.log("\n  ⚠ contains an \"Attempting to use tool\" block — Flowise rendered a tool call as TEXT.");
  console.log("    Either it gated the call (human input) or the flow never bound that tool. Check the");
  console.log("    customMCP mcpActions lists before assuming the model misbehaved.");
}
console.log();
