// Turn outcomes: no silent turns, and no retry after a side effect (D9, 2026-07-31).
// Run with: node --test scripts/turn-outcome.test.mjs
//
// TWO DEFECTS, one root: the gateway decided what to do next from signals that did not describe what
// had already happened.
//
// 1. SILENT TURNS. Every recovery path is guarded, and each guard is there for a good reason — but
//    when they all decline, the turn ended with no text, no card, no UI and no error. The user
//    watched a spinner stop and could not tell a broken turn from a slow one. It is also how a
//    FAILED write became invisible: `sawFailedWrite` gated the recoveries and was surfaced nowhere.
//
// 2. RETRY AFTER A SIDE EFFECT. The error retry's precondition was `!assistantReply` — read as
//    "nothing user-visible happened yet", but it only inspects TEXT. A turn that failed AFTER a
//    write landed would re-run the model, which is not a retry: it is a second attempt at an action
//    that already took effect.
import test from "node:test";
import assert from "node:assert/strict";
import { deltaText, doneFrame, runTurn, startGateway, startMockStack, uiFrames } from "./harness/index.mjs";

let mock;
let gateway;
let token;

test.before(async () => {
  mock = await startMockStack();
  gateway = await startGateway(mock);
  token = await mock.mintToken();
});
test.after(async () => {
  await gateway?.close();
  await mock?.close();
});

const writeReturn = (toolOutput) => ({
  ev: "usedTools",
  data: [{ tool: "update_referral", toolInput: { id: "ref-1" }, toolOutput }],
});
const OK = '{"id":"ref-1","updated":true,"verified":true}';
// The gateway drains a card by scanning tool output for `ui_job_id` followed by a UUID
// (UI_JOB_RE) — a non-UUID id is silently ignored, so these must be real UUIDs.
const UI_JOB_ID = "11111111-2222-4333-8444-555555555555";
const uiJobReturn = () => ({
  ev: "usedTools",
  data: [{ tool: "emit_ui", toolInput: {}, toolOutput: JSON.stringify({ ok: true, ui_job_id: UI_JOB_ID }) }],
});
const uiFrame = () => ({
  type: "ui", surface_id: "design_1", mode: "replace", root: "c",
  components: [{ id: "c", component: { Text: { text: "a design" } } }],
  data_model: {},
});
const FAILED = '{"id":"ref-1","verified":false,"fields_not_applied":["city"]}';

async function turn(frames, body = {}) {
  mock.reset();
  mock.setFrames(frames);
  const res = await runTurn(gateway, token, {
    message: "update the Adler One referral", mode: "manual", context: { page: "/referrals" }, ...body,
  });
  return { ...res, text: deltaText(res.frames), calls: mock.state.predictions.length };
}

// ── 1. No silent turns ───────────────────────────────────────────────────────

test("a turn with no text, no card and no error still says something", async () => {
  const res = await turn([{ ev: "token", data: "" }]);
  assert.notEqual(res.text.trim(), "", "the user must never be left with a stopped spinner and no words");
  assert.match(res.text, /ask me again/i);
});

test("a write that reported FAILURE is reported, not swallowed", async () => {
  const res = await turn([writeReturn(FAILED)]);
  assert.match(res.text, /wasn't able to complete that/i);
  // The tool reported a failure; it did not report a rollback. Claiming the data is untouched would
  // be the same class of unverified assertion this whole effort is about.
  assert.ok(!/nothing was changed|no changes were made/i.test(res.text),
    `must not claim an unobserved rollback: ${JSON.stringify(res.text)}`);
});

test("a silent SUCCESSFUL write is acknowledged without inventing detail", async () => {
  const res = await turn([writeReturn(OK)]);
  assert.match(res.text, /that's done/i);
  assert.ok(!/wasn't able/i.test(res.text));
});

test("the stand-in never overwrites the model's own words", async () => {
  const res = await turn([
    { ev: "token", data: "I've updated the Adler One referral's city." },
    writeReturn(OK),
  ]);
  assert.equal(res.text.trim(), "I've updated the Adler One referral's city.");
});

test("the stand-in is persisted, so a reload shows the same outcome", async () => {
  const res = await turn([writeReturn(FAILED)]);
  const rows = mock.state.restCalls
    .filter((c) => c.path.includes("chat_messages"))
    .flatMap((c) => (Array.isArray(c.body) ? c.body : [c.body]));
  const assistantRows = rows.filter((r) => r?.role === "assistant" || r?.sender === "assistant");
  assert.ok(
    assistantRows.some((r) => /wasn't able to complete that/i.test(String(r?.content ?? r?.message ?? ""))),
    `the streamed line must also be the persisted outcome; got ${JSON.stringify(assistantRows)}`,
  );
});

test("a turn that emitted a UI card is not given a stand-in", async () => {
  mock.reset();
  mock.setUiFrames([uiFrame()]);
  mock.setFrames([uiJobReturn()]);
  const res = await runTurn(gateway, token, { message: "show me", mode: "manual", context: { page: "/referrals" } });
  assert.ok(uiFrames(res.frames).length > 0, "the card must have streamed");
  assert.ok(!/ask me again|wasn't able to complete/i.test(deltaText(res.frames)),
    "a card IS a user-visible outcome — no stand-in");
});

// ── 2. No retry after a side effect ──────────────────────────────────────────

test("an error with nothing done yet still retries once", async () => {
  mock.reset();
  mock.setFramesByCall([
    [{ ev: "error", data: "upstream blew up" }],
    [{ ev: "token", data: "All set — the referral is updated." }],
  ]);
  const res = await runTurn(gateway, token, { message: "update it", mode: "manual", context: { page: "/referrals" } });
  assert.equal(mock.state.predictions.length, 2, "the retry is the whole point of this path — keep it working");
  assert.match(deltaText(res.frames), /All set/);
});

test("an error AFTER a successful write does not re-run the model", async () => {
  mock.reset();
  mock.setFramesByCall([
    [writeReturn(OK), { ev: "error", data: "upstream blew up after the write" }],
    [{ ev: "token", data: "SECOND ATTEMPT — this must never happen" }],
  ]);
  const res = await runTurn(gateway, token, { message: "update it", mode: "manual", context: { page: "/referrals" } });
  assert.equal(mock.state.predictions.length, 1, "re-running after a write is a second write, not a retry");
  assert.ok(!/SECOND ATTEMPT/.test(deltaText(res.frames)));
  assert.ok(doneFrame(res.frames), "the turn must still close cleanly");
});

test("an error AFTER a UI card shipped does not re-run the model", async () => {
  mock.reset();
  mock.setUiFrames([uiFrame()]);
  mock.setFramesByCall([
    [
      uiJobReturn(),
      { ev: "error", data: "upstream blew up after the card" },
    ],
    [{ ev: "token", data: "SECOND ATTEMPT — this must never happen" }],
  ]);
  const res = await runTurn(gateway, token, { message: "show me", mode: "manual", context: { page: "/referrals" } });
  assert.equal(mock.state.predictions.length, 1);
  assert.ok(!/SECOND ATTEMPT/.test(deltaText(res.frames)));
});
