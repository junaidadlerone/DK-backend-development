// The observability substrate and the per-turn success metric (D5, 2026-08-03).
// Run with: node --test scripts/turn-observability.test.mjs
//
// WHY: there was no definition of "a turn worked" anywhere in this system, so there was no way to
// tell whether a fix helped — every judgement came from someone's impression of a browser session,
// and eight rounds of "PASS" ended with the same bugs still live. This file pins the definition:
//
//   ok = no turn error, no recovery fired, no failed write, no unidentified pause, no tool leak
//
// The load-bearing clause is `extra_attempts === 0`. A turn that needed a retry or a nudge DID
// produce the right answer — on the second try. That is exactly the flakiness the owner described,
// so counting it as a pass would hide the thing we are trying to measure.
//
// It also pins the privacy rule, because a log that cannot be enabled in production measures nothing:
// tool NAMES, outcome classes, counts and durations only — never a message, argument or payload.
import test from "node:test";
import assert from "node:assert/strict";
import { runTurn, startGateway, startMockStack } from "./harness/index.mjs";

let mock;
let gateway;
let token;
/** Every structured line the gateway wrote during the current test. */
let logged = [];
const realLog = console.log;

test.before(async () => {
  mock = await startMockStack();
  gateway = await startGateway(mock);
  token = await mock.mintToken();
  console.log = (...args) => {
    const first = args[0];
    if (typeof first === "string" && first.startsWith("{")) {
      try { logged.push(JSON.parse(first)); } catch { /* not one of ours */ }
    }
    realLog(...args);
  };
});
test.after(async () => {
  console.log = realLog;
  await gateway?.close();
  await mock?.close();
});

const SECRET = "Adler One at 4210 Nasa Road, alice@example.com, 713-555-0134";

async function turn(frames, body = {}) {
  logged = [];
  mock.reset();
  mock.setFrames(frames);
  const res = await runTurn(gateway, token, {
    message: SECRET, mode: "manual", context: { page: "/referrals" }, ...body,
  });
  const turns = logged.filter((l) => l.event === "turn");
  return { res, turns, summary: turns[turns.length - 1], lines: logged };
}

const writeReturn = (out) => ({
  ev: "usedTools",
  data: [{ tool: "update_referral", toolInput: { id: "ref-1" }, toolOutput: out }],
});

test("every turn emits exactly one summary line, carrying a turn id", async () => {
  const { turns, summary } = await turn([{ ev: "token", data: "All set." }]);
  assert.equal(turns.length, 1, "one summary per turn — a second would double-count in any metric");
  assert.match(String(summary.turn_id), /^[0-9a-f-]{36}$/);
  assert.equal(typeof summary.ms, "number");
  assert.ok(summary.session_id, "the summary must join to a session");
});

test("a clean turn is ok", async () => {
  const { summary } = await turn([{ ev: "token", data: "All set." }]);
  assert.equal(summary.ok, true);
  assert.equal(summary.outcome, "text");
  assert.equal(summary.extra_attempts, 0);
});

test("a turn that only succeeded on a RETRY is not ok", async () => {
  logged = [];
  mock.reset();
  mock.setFramesByCall([
    [{ ev: "error", data: "upstream blew up" }],
    [{ ev: "token", data: "All set on the second try." }],
  ]);
  await runTurn(gateway, token, { message: "update it", mode: "manual", context: { page: "/referrals" } });
  const summary = logged.filter((l) => l.event === "turn").pop();
  assert.equal(summary.extra_attempts, 1, "the retry must be counted");
  assert.equal(summary.ok, false, "recovered is NOT success — this is the flakiness signal");
  assert.equal(summary.outcome, "text", "…even though the user did get an answer");
});

test("a failed write makes the turn not ok", async () => {
  const { summary } = await turn([
    { ev: "token", data: "Updated that for you." },
    writeReturn('{"id":"ref-1","verified":false,"fields_not_applied":["city"]}'),
  ]);
  assert.equal(summary.failed_write, true);
  assert.equal(summary.ok, false);
});

test("a successful write is recorded as a dirtied resource, by name", async () => {
  const { summary } = await turn([
    { ev: "token", data: "Updated that for you." },
    writeReturn('{"id":"ref-1","updated":true,"verified":true}'),
  ]);
  assert.ok(Array.isArray(summary.writes));
  assert.ok(summary.writes.includes("referrals"), `expected the referrals resource, got ${JSON.stringify(summary.writes)}`);
  assert.equal(summary.ok, true);
});

test("an errored turn is not ok and carries a truncated reason", async () => {
  const { summary } = await turn([{ ev: "token", data: "" }, { ev: "error", data: "x".repeat(500) }]);
  assert.equal(summary.ok, false);
  assert.ok(summary.error.length <= 200, "the reason is truncated — logs are not a dumping ground");
});

test("NO log line contains the user's message, address, email or phone", async () => {
  const { lines } = await turn([
    { ev: "token", data: "Updated the referral." },
    writeReturn('{"id":"ref-1","updated":true,"verified":true}'),
  ]);
  const blob = JSON.stringify(lines);
  for (const secret of ["Adler One", "4210 Nasa Road", "alice@example.com", "713-555-0134"]) {
    assert.ok(!blob.includes(secret), `structured logs leaked ${JSON.stringify(secret)}: ${blob.slice(0, 400)}`);
  }
});

test("the summary reports reply LENGTH, never reply text", async () => {
  const { summary } = await turn([{ ev: "token", data: "The Adler One referral is updated." }]);
  assert.equal(summary.reply_chars, "The Adler One referral is updated.".length);
  assert.ok(!JSON.stringify(summary).includes("Adler One"));
});

test("a pause logs its own line with tool NAMES and whether it was identified", async () => {
  logged = [];
  mock.reset();
  mock.setFrames([
    { ev: "calledTools", data: [{ tool: "update_referral", toolInput: { id: "ref-1" }, toolOutput: "" }] },
    {
      ev: "agentFlowExecutedData",
      data: [{
        nodeId: "agentAgentflow_0",
        nodeLabel: "Agent",
        data: {
          id: "agentAgentflow_0",
          name: "agentAgentflow",
          output: {
            isWaitingForHumanInput: true,
            calledTools: [{ name: "update_referral", args: { id: "ref-1" } }],
            content: "",
          },
        },
      }],
    },
    { ev: "action", data: { id: "act-1", mapping: { approve: "Proceed", reject: "Reject" }, elements: [], data: { nodeId: "agentAgentflow_0", nodeLabel: "Agent", input: {} } } },
  ]);
  await runTurn(gateway, token, { message: "update it", mode: "manual", context: { page: "/referrals" } });
  const pause = logged.find((l) => l.event === "pause");
  assert.ok(pause, `expected a pause line, got ${JSON.stringify(logged.map((l) => l.event))}`);
  assert.equal(pause.chosen, "update_referral");
  assert.deepEqual(pause.candidates, ["update_referral"]);
  assert.equal(pause.identified, true);
  assert.ok(!JSON.stringify(pause).includes("ref-1"), "pause lines carry tool names, never arguments");

  const summary = logged.filter((l) => l.event === "turn").pop();
  assert.equal(summary.unidentified_pause, false);
  assert.equal(summary.outcome, "approval");
  assert.equal(summary.ok, true, "an identified pause awaiting the user is a healthy turn");
});
