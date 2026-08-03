// The surface lifecycle (D4, 2026-08-03).
// Run with: node --test scripts/surface-lifecycle.test.mjs
//
// REPORTED BUG: completed GenUI cards became actionable again. Two independent chains caused it, and
// this file covers the server half — the half the browser structurally could not fix:
//
//   * `persistTurn` upsert every surface with `interaction: null`, so re-emitting a surface_id ERASED
//     the user's recorded Approve and the reloaded conversation handed them a fresh, actionable copy
//     of a card they had already used.
//   * The live lock was `disabled={isStreaming}`, which re-arms the moment the stream ends, and the
//     per-card `done` flag lived in React state that dies on unmount — and the widget unmounts on
//     panel minimize AND on route navigation. Nothing outside the component remembered.
//
// The fix is a terminal state on the server (`chat_surfaces.state`), so "this card is finished" is
// re-derivable after any unmount, and a consumed surface_id is dead for the rest of the session.
import test from "node:test";
import assert from "node:assert/strict";
import { doneFrame, runTurn, startGateway, startMockStack, uiFrames } from "./harness/index.mjs";

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

const JOB_ID = "22222222-3333-4444-8555-666666666666";
const uiJobReturn = () => ({
  ev: "usedTools",
  data: [{ tool: "emit_ui", toolInput: {}, toolOutput: JSON.stringify({ ok: true, ui_job_id: JOB_ID }) }],
});
const card = (surfaceId) => ({
  type: "ui", surface_id: surfaceId, mode: "replace", root: "c",
  components: [{ id: "c", component: { Button: { label: "Launch", action: { type: "send", prompt: "launch it" } } } }],
  data_model: {},
});

/** Every chat_surfaces write the gateway made, flattened to rows. */
const surfaceRows = () => mock.state.restCalls
  .filter((c) => c.path.includes("chat_surfaces"))
  .flatMap((c) => ({ method: c.method, rows: Array.isArray(c.body) ? c.body : [c.body] }));

test("a persisted surface never carries interaction:null — that erased the user's Approve", async () => {
  mock.reset();
  mock.setUiFrames([card("launch_1")]);
  mock.setFrames([uiJobReturn()]);
  const res = await runTurn(gateway, token, { message: "show me", mode: "manual", context: { page: "/campaigns" } });
  assert.ok(uiFrames(res.frames).length > 0, "the card must have streamed");

  const upserts = surfaceRows().filter((c) => c.method === "POST");
  assert.ok(upserts.length > 0, "the surface should have been persisted");
  for (const { rows } of upserts) {
    for (const row of rows) {
      assert.ok(!("interaction" in row),
        `the upsert must not touch interaction at all, got ${JSON.stringify(row)}`);
      assert.ok(!("state" in row),
        "…nor state: an upsert may only replace what THIS turn produced, never the record of what the user did");
    }
  }
});

test("a card click marks the surface terminal, not just recorded", async () => {
  mock.reset();
  mock.setFrames([{ ev: "token", data: "On it." }]);
  const first = await runTurn(gateway, token, { message: "hi", mode: "manual", context: { page: "/campaigns" } });
  const sessionId = doneFrame(first.frames)?.session_id;
  assert.ok(sessionId);

  mock.reset();
  mock.setFrames([{ ev: "token", data: "Launching." }]);
  await runTurn(gateway, token, {
    message: "launch it", mode: "manual", session_id: sessionId, context: { page: "/campaigns" },
    surface_id: "launch_1", interaction: { action: "send", display: "Launch" },
  });

  const updates = surfaceRows().filter((c) => c.method === "PATCH");
  assert.ok(updates.length > 0, "the click must be recorded");
  const stamped = updates.flatMap((u) => u.rows);
  assert.ok(stamped.some((r) => r?.state === "consumed"),
    `the click must mark the surface consumed; got ${JSON.stringify(stamped)}`);
  assert.ok(stamped.some((r) => r?.interaction?.resolved === true),
    "…and still record WHAT the user did");
});

test("re-emitting the surface the user just clicked streams it LOCKED, not re-armed", async () => {
  mock.reset();
  mock.setFrames([{ ev: "token", data: "On it." }]);
  const first = await runTurn(gateway, token, { message: "hi", mode: "manual", context: { page: "/campaigns" } });
  const sessionId = doneFrame(first.frames)?.session_id;

  // The turn the click starts re-runs emit_ui for the SAME surface_id — a recovery re-POST, or the
  // model reaching for the id it already used. This is the sequence that re-armed the card.
  mock.reset();
  mock.setUiFrames([card("launch_1")]);
  mock.setFrames([uiJobReturn()]);
  const res = await runTurn(gateway, token, {
    message: "launch it", mode: "manual", session_id: sessionId, context: { page: "/campaigns" },
    surface_id: "launch_1", interaction: { action: "send", display: "Launch" },
  });

  const streamed = uiFrames(res.frames).find((f) => f.surface_id === "launch_1");
  assert.ok(streamed, "the frame must still reach the client — the reply's words refer to it");
  assert.deepEqual(streamed.resolved, { display: "Launch" },
    "it must arrive carrying the outcome the user chose, so it renders locked");

  // And it must NOT overwrite the recorded row: that row holds the frame the user actually acted on.
  const upserts = surfaceRows().filter((c) => c.method === "POST").flatMap((u) => u.rows);
  assert.ok(!upserts.some((r) => r?.surface_id === "launch_1"),
    `a consumed surface must not be re-persisted; got ${JSON.stringify(upserts)}`);
});

test("a brand-new surface_id in the same session is still fully actionable", async () => {
  mock.reset();
  mock.setFrames([{ ev: "token", data: "On it." }]);
  const first = await runTurn(gateway, token, { message: "hi", mode: "manual", context: { page: "/campaigns" } });
  const sessionId = doneFrame(first.frames)?.session_id;

  mock.reset();
  mock.setUiFrames([card("launch_2")]);
  mock.setFrames([uiJobReturn()]);
  const res = await runTurn(gateway, token, {
    message: "launch it", mode: "manual", session_id: sessionId, context: { page: "/campaigns" },
    surface_id: "launch_1", interaction: { action: "send", display: "Launch" },
  });

  const streamed = uiFrames(res.frames).find((f) => f.surface_id === "launch_2");
  assert.ok(streamed, "a different surface_id must stream normally");
  assert.equal(streamed.resolved, undefined, "…unlocked — consuming one card must not lock the next");
  const upserts = surfaceRows().filter((c) => c.method === "POST").flatMap((u) => u.rows);
  assert.ok(upserts.some((r) => r?.surface_id === "launch_2"), "and it must be persisted");
});

test("the consumed-surface load failing does not break the turn", async () => {
  // Before the 20260803 migration the `state` column does not exist, so the SELECT errors. The turn
  // must degrade to just the clicked surface rather than fail — a deploy ordering must never take
  // chat down.
  mock.reset();
  mock.setFrames([{ ev: "token", data: "On it." }]);
  const first = await runTurn(gateway, token, { message: "hi", mode: "manual", context: { page: "/campaigns" } });
  const sessionId = doneFrame(first.frames)?.session_id;

  mock.reset();
  mock.failSurfaceSelect = true;
  mock.setFrames([{ ev: "token", data: "Still fine." }]);
  const res = await runTurn(gateway, token, {
    message: "carry on", mode: "manual", session_id: sessionId, context: { page: "/campaigns" },
  });
  mock.failSurfaceSelect = false;
  assert.ok(doneFrame(res.frames), "the turn must still complete");
});
