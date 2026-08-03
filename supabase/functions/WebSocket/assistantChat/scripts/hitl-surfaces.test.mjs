// Surface identity, persistence and resume parity — replayed against the real handler (2026-07-31).
// Run with: node --test scripts/hitl-surfaces.test.mjs
//
// Three defects, all found by audit and all invisible to any unit test because they live in the
// interaction between the event stream, the surface buffer and the persistence write:
//
//  C3  Approval cards are keyed `perm_${actionId ?? sessionId}`. Whenever Flowise omits an action
//      id, EVERY approval card in a session collapses onto one chat_surfaces row, so card #2's
//      persist overwrites card #1's recorded Approve/Reject — and a reload re-arms a decision the
//      user already made, which the gateway's own comment warns can double-execute the write.
//
//  C4  One turn can emit the same surface_id twice (a recovery re-POST re-running emit_ui, or two
//      frames from one drain). persistTurn passes all of them to a single bulk upsert, and Postgres
//      rejects two conflicting rows in one INSERT ... ON CONFLICT DO UPDATE with SQLSTATE 21000 —
//      aborting the whole statement, so EVERY card from that turn is lost on reload while the only
//      trace is a "surface persist failed" log line.
//
//  C5  A manual resume sends question "proceed"; an AUTO resume re-sends the ORIGINAL user message
//      alongside humanInput. The model therefore sees its whole task again after the pause and can
//      redo work it already did — the "auto mode is worse than manual" report.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { doneFrame, runTurn, startGateway, startMockStack, uiFrames } from "./harness/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAUSE = JSON.parse(readFileSync(join(HERE, "harness", "fixtures", "pause-identified.json"), "utf8"));

/** The same captured pause, with the action id stripped — what Flowise sends when it omits one. */
function withoutActionId(frames) {
  const out = structuredClone(frames);
  const action = out.find((f) => f.ev === "action");
  delete action.data.id;
  return out;
}

/** A GenUI frame as the MCP's jobs side channel would hand it back. */
const uiFrame = (surfaceId, text) => ({
  type: "ui",
  surface_id: surfaceId,
  mode: "replace",
  root: "c",
  components: [
    { id: "c", component: { Card: { title: "Design", children: ["t"] } } },
    { id: "t", component: { Text: { text } } },
  ],
  data_model: {},
});

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

test("C3: two pauses in one session with no action id must not share a surface row", async () => {
  mock.reset();
  mock.setFrames(withoutActionId(PAUSE));

  const first = await runTurn(gateway, token, {
    message: "Update that referral", mode: "manual", context: { page: "/referrals" },
  });
  const sessionId = doneFrame(first.frames)?.session_id;
  assert.ok(sessionId, "first turn must establish a session");

  const second = await runTurn(gateway, token, {
    message: "Update the other referral", mode: "manual", session_id: sessionId, context: { page: "/referrals" },
  });

  const idOf = (r) => uiFrames(r.frames)[0]?.surface_id;
  assert.ok(idOf(first), "first turn should card");
  assert.ok(idOf(second), "second turn should card");
  assert.notEqual(
    idOf(second),
    idOf(first),
    "both approval cards collapsed onto one surface id — the second card's persist would overwrite the first card's recorded decision, and a reload would re-arm an already-answered approval",
  );
});

test("C4: a turn emitting one surface_id twice must not send duplicate rows to the surface upsert", async () => {
  mock.reset();
  const jobId = "11111111-2222-4333-8444-555555555555";
  // One drain returning TWO frames that share a surface_id — the shape a recovery re-POST or a
  // re-emitted card produces.
  mock.setUiFrames([uiFrame("design_1", "first render"), uiFrame("design_1", "revised render")]);
  mock.setFrames([
    { ev: "calledTools", data: [{ tool: "emit_ui", toolInput: {}, toolOutput: "" }] },
    { ev: "usedTools", data: [{ tool: "emit_ui", toolInput: {}, toolOutput: JSON.stringify({ ui_job_id: jobId }) }] },
  ]);

  await runTurn(gateway, token, {
    message: "show me the design", mode: "manual", context: { page: "/templates" },
  });

  const upserts = mock.state.restCalls.filter((c) => c.path.includes("chat_surfaces"));
  assert.ok(upserts.length > 0, "the turn should have persisted its surfaces");
  for (const call of upserts) {
    const rows = Array.isArray(call.body) ? call.body : [call.body];
    const ids = rows.map((r) => r?.surface_id).filter(Boolean);
    assert.equal(
      new Set(ids).size,
      ids.length,
      `duplicate surface_id in ONE upsert (${ids.join(", ")}) — Postgres aborts the whole statement with SQLSTATE 21000, so every card from this turn is lost on reload`,
    );
  }
});

test("C5: an auto resume must send the same signal as a manual one, not the original question", async () => {
  mock.reset();
  mock.setFramesByCall([PAUSE, []]);

  const original = "Update that referral's notes to say hello";
  await runTurn(gateway, token, {
    message: original, mode: "auto", context: { page: "/referrals" },
  });

  assert.ok(mock.state.predictions.length >= 2, "the auto-approved pause must be resumed upstream");
  const resume = mock.state.predictions[1];
  assert.equal(resume.humanInput?.type, "proceed", "the resume must carry humanInput proceed");
  assert.notEqual(
    resume.question,
    original,
    "the auto resume re-sent the user's whole original request after the pause, so the model can redo work it already did — a manual resume sends only 'proceed'",
  );
  assert.equal(resume.question, "proceed", "auto and manual resumes should send the identical signal");
});
