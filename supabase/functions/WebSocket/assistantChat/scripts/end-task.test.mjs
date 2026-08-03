// The end_task completion signal (D8, 2026-08-03).
// Run with: node --test scripts/end-task.test.mjs
//
// WHY: when a Flowise turn stops, the gateway has no idea why. Finished, announced-then-stopped,
// tool-call-written-as-text, or waiting on something only the user can do in the app — all four look
// identical on the wire (a stream that ends). So the gateway GUESSES, with heuristics built one QA
// report at a time: a 40-stem/26-veto announce nudge, a cut-off detector, a toolless-leak retry, and a
// referenced-but-never-emitted-UI nudge. Every one of them infers a fact the model could state.
//
// NOTHING IS RETIRED HERE. These tests pin that the signal is captured and measured. Whether the model
// calls it reliably enough to replace a heuristic is a question for the numbers, not for an argument —
// each heuristic exists because QA saw the failure it catches.
import test from "node:test";
import assert from "node:assert/strict";
import { deltaText, runTurn, startGateway, startMockStack } from "./harness/index.mjs";

let mock;
let gateway;
let token;
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

const endTask = (status, summary) => ({
  ev: "usedTools",
  data: [{
    tool: "end_task",
    toolInput: { status, ...(summary ? { summary } : {}) },
    toolOutput: JSON.stringify({ ok: true, acknowledged: status }),
  }],
});

async function turn(frames) {
  logged = [];
  mock.reset();
  mock.setFrames(frames);
  const res = await runTurn(gateway, token, { message: "do the thing", mode: "manual", context: { page: "/referrals" } });
  return { text: deltaText(res.frames), summary: logged.filter((l) => l.event === "turn").pop() };
}

test("a declared ending is recorded in the per-turn line", async () => {
  const { summary } = await turn([
    { ev: "token", data: "All done — the referral is updated." },
    endTask("complete", "Updated the Adler One referral's city."),
  ]);
  assert.equal(summary.end_task, "complete");
});

test("each status reaches the log verbatim", async () => {
  for (const status of ["complete", "needs_user_in_app", "blocked", "failed"]) {
    const { summary } = await turn([{ ev: "token", data: "Here you go." }, endTask(status)]);
    assert.equal(summary.end_task, status, `status ${status}`);
  }
});

test("a turn with NO end_task records null — that number is the whole point", async () => {
  // How often the model omits it is what decides whether any heuristic can be retired.
  const { summary } = await turn([{ ev: "token", data: "Here you go." }]);
  assert.equal(summary.end_task, null);
});

test("end_task is not treated as a write: no refresh, no failed-write", async () => {
  const { summary } = await turn([{ ev: "token", data: "All done." }, endTask("complete")]);
  assert.deepEqual(summary.writes, [], "it changes no data, so it dirties no screen");
  assert.equal(summary.failed_write, false);
  assert.equal(summary.ok, true);
});

test("the tool's ARGUMENTS are the claim, not its constant ack", async () => {
  // The ack is always {ok:true}; reading the outcome from there would record every ending as success.
  const { summary } = await turn([{ ev: "token", data: "That didn't work." }, endTask("failed", "The design save failed.")]);
  assert.equal(summary.end_task, "failed");
});

test("a declared summary stands in for a silent turn, in the model's own words", async () => {
  // Better than D9's generic line: the model knows what it was doing.
  const { text } = await turn([endTask("needs_user_in_app", "Everything's filled in — complete the consent section in the app to finalise it.")]);
  assert.match(text, /complete the consent section in the app/);
  assert.ok(!/didn't manage to put a reply together/.test(text));
});

test("a FAILED ending never becomes a cheerful stand-in", async () => {
  const { text } = await turn([endTask("failed", "I couldn't save the design.")]);
  assert.ok(!/That's done/.test(text), `a failure must not read as success: ${JSON.stringify(text)}`);
});

test("the model's own reply always wins over the declared summary", async () => {
  const { text } = await turn([
    { ev: "token", data: "I've updated the referral's city to Houston." },
    endTask("complete", "Updated city."),
  ]);
  assert.equal(text.trim(), "I've updated the referral's city to Houston.");
});

test("a failed WRITE outranks a 'complete' declaration", async () => {
  // The tool's evidence beats the model's account of it — the model claiming completion is precisely
  // the unverified assertion this whole effort removes.
  const { text, summary } = await turn([
    { ev: "usedTools", data: [{ tool: "update_referral", toolInput: { id: "ref-1" }, toolOutput: '{"verified":false,"fields_not_applied":["city"]}' }] },
    endTask("complete", "Updated the referral."),
  ]);
  assert.match(text, /wasn't able to complete that/i);
  assert.equal(summary.failed_write, true);
  assert.equal(summary.ok, false);
});
