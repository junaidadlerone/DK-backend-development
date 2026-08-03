// A pause on a control tool must never become an approval card (2026-08-03).
// Run with: node --test scripts/control-pause.test.mjs
//
// PROVEN LIVE, from the LangSmith trace of the reported turn (auto-approve on):
//   inputs: "proceed"                          ← the create had already auto-resumed
//   child run: create_referral  status=success ← the write LANDED
//   output: "Done. Adler Three's referral is saved as a draft…
//            Attempting to use tool:
//            { "name": "end_task", "args": { "status": "needs_user_in_app", … } }"
//
// Flowise emitted that end_task call as a human-input pause. The gateway has no PERM_ACTIONS copy for
// end_task, so `identified` was false and the card rendered "Cancelled for safety / I couldn't confirm
// what this would change" — over a turn that had worked perfectly. C2's no-identity-no-Approve rule did
// exactly what it should; the pause is what should not exist.
//
// Root cause is Flowise config (end_task belongs only in the UNGATED entry). These tests are the belt,
// because the prompt now asks for end_task on EVERY turn — so a misplaced entry would card every turn.
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

/** A Flowise human-input pause naming `tool`, in the shape the captured frames use. */
const pauseOn = (tool, args = {}) => ([
  { ev: "calledTools", data: [{ tool, toolInput: args, toolOutput: "" }] },
  {
    ev: "agentFlowExecutedData",
    data: [{
      nodeId: "agentAgentflow_0",
      nodeLabel: "Agent",
      data: {
        id: "agentAgentflow_0",
        name: "agentAgentflow",
        output: { isWaitingForHumanInput: true, calledTools: [{ name: tool, args }], content: "" },
      },
    }],
  },
  { ev: "action", data: { id: "act-1", mapping: { approve: "Proceed", reject: "Reject" }, elements: [], data: { nodeId: "agentAgentflow_0", nodeLabel: "Agent", input: {} } } },
]);

async function turn(frames, mode) {
  mock.reset();
  mock.setFramesByCall([frames, [{ ev: "token", data: "All set." }]]);
  const res = await runTurn(gateway, token, { message: "create a referral", mode, context: { page: "/referrals" } });
  return { res, cards: uiFrames(res.frames), calls: mock.state.predictions.length, done: doneFrame(res.frames) };
}

for (const mode of ["auto", "manual"]) {
  test(`an end_task pause is resumed silently in ${mode} mode, not carded`, async () => {
    const { cards, calls, done, res } = await turn(pauseOn("end_task", { status: "needs_user_in_app", summary: "Consent is the user's step." }), mode);
    const perm = cards.filter((c) => String(c.surface_id).startsWith("perm_"));
    assert.deepEqual(perm, [], `no approval card may be shown for a control tool (${mode})`);
    assert.ok(!/Cancelled for safety/.test(JSON.stringify(res.frames)), "the reported symptom must be gone");
    assert.equal(calls, 2, "the pause must be RESUMED, so the turn can finish");
    assert.equal(done?.awaiting_approval, false, "and the composer must not be left locked");
  });
}

test("a WRITE pause still cards in manual mode — the fix must not widen", async () => {
  const { cards, done } = await turn(pauseOn("update_referral", { id: "ref-1" }), "manual");
  const perm = cards.filter((c) => String(c.surface_id).startsWith("perm_"));
  assert.equal(perm.length, 1, "a real mutation must still ask");
  assert.equal(done?.awaiting_approval, true);
});

test("a delete still cards even in AUTO mode", async () => {
  const { cards } = await turn(pauseOn("delete_campaign", { id: "camp-1", name: "X" }), "auto");
  assert.equal(cards.filter((c) => String(c.surface_id).startsWith("perm_")).length, 1,
    "the /^delete_/ belt must be untouched by this change");
});

test("a MIXED pause (control + write) still cards — control must not launder a write", async () => {
  // If Flowise ever batches them, the write decides. One Approve executes the WHOLE batch.
  mock.reset();
  mock.setFramesByCall([[
    { ev: "calledTools", data: [{ tool: "end_task", toolInput: { status: "complete" }, toolOutput: "" }] },
    { ev: "calledTools", data: [{ tool: "update_referral", toolInput: { id: "ref-1" }, toolOutput: "" }] },
    {
      ev: "agentFlowExecutedData",
      data: [{
        nodeId: "agentAgentflow_0", nodeLabel: "Agent",
        data: { id: "agentAgentflow_0", name: "agentAgentflow", output: { isWaitingForHumanInput: true, calledTools: [{ name: "end_task", args: {} }, { name: "update_referral", args: { id: "ref-1" } }], content: "" } },
      }],
    },
    { ev: "action", data: { id: "act-1", mapping: {}, elements: [], data: { nodeId: "agentAgentflow_0", nodeLabel: "Agent", input: {} } } },
  ], [{ ev: "token", data: "ok" }]]);
  const res = await runTurn(gateway, token, { message: "update it", mode: "manual", context: { page: "/referrals" } });
  assert.equal(uiFrames(res.frames).filter((c) => String(c.surface_id).startsWith("perm_")).length, 1,
    "a batch containing a write must still be approved");
});

test("the reply the model already wrote is not lost to the resume", async () => {
  mock.reset();
  mock.setFramesByCall([
    [{ ev: "token", data: "Done. The referral is saved as a draft." }, ...pauseOn("end_task", { status: "needs_user_in_app" })],
    [{ ev: "token", data: "" }],
  ]);
  const res = await runTurn(gateway, token, { message: "create a referral", mode: "auto", context: { page: "/referrals" } });
  assert.match(deltaText(res.frames), /Done\. The referral is saved as a draft\./);
});
