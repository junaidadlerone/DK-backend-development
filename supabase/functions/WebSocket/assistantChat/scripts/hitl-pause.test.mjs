// HITL approval-card behaviour, replayed against REAL captured Flowise frames (2026-07-31).
// Run with: node --test scripts/hitl-pause.test.mjs
//
// The bug these tests exist for: an approval card was rendered reading "Confirming this action"
// with no action name and no target — and a live Approve button — so the user was asked to
// authorise something the gateway itself could not identify.
//
// Mechanism, now proven from the captured frames in ./harness/fixtures/pause-identified.json:
//   * Flowise's `action` (pause) payload carries { id, mapping, elements, data:{nodeId, nodeLabel,
//     input} } — NO tool name and NO arguments. The pause is anonymous.
//   * The authoritative identity arrives on the `agentFlowExecutedData` frame IMMEDIATELY BEFORE it,
//     as `output.calledTools` on the node whose `output.isWaitingForHumanInput === true`.
//   * The gateway ignores that and infers identity from a map keyed by tool NAME, which the same
//     frame's CUMULATIVE `output.usedTools` retires — so when a tool is called twice in one turn,
//     the pending call is deleted microseconds before the card is built, leaving zero candidates.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  frameTexts, hasApproveButton, runTurn, startGateway, startMockStack, thinkingLabels, uiFrames,
} from "./harness/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(readFileSync(join(HERE, "harness", "fixtures", name), "utf8"));

// Captured from production Flowise 3.1.2 on a real "look up X, then update X" turn.
const PAUSE_IDENTIFIED = load("pause-identified.json");

/**
 * The blank-card sequence, derived from the real capture by the ONE mutation that reproduces it:
 * the pause frame's cumulative `usedTools` also lists the pending tool (which is exactly what
 * Flowise sends once that tool has already returned once in the same turn — e.g. the model retries
 * an update, or a second write follows an approved one). The gateway's name-keyed retirement then
 * deletes the pending call just before the card is built.
 */
function withPendingToolRetired(frames, tool) {
  const out = structuredClone(frames);
  const pauseFrame = [...out].reverse().find(
    (f) => f.ev === "agentFlowExecutedData" &&
      (f.data ?? []).some((n) => n?.data?.output?.isWaitingForHumanInput === true),
  );
  const node = (pauseFrame.data ?? []).find((n) => n?.data?.output?.isWaitingForHumanInput === true);
  node.data.output.usedTools = [
    ...(node.data.output.usedTools ?? []),
    { tool, toolInput: { id: "ref-1" }, toolOutput: "{\"id\":\"ref-1\",\"updated\":true}" },
  ];
  return out;
}

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

test("harness sanity: the captured fixture really is an anonymous pause carrying its identity elsewhere", () => {
  const action = PAUSE_IDENTIFIED.find((f) => f.ev === "action");
  assert.ok(action, "fixture must contain an action (pause) frame");
  assert.deepEqual(
    Object.keys(action.data.data).sort(),
    ["input", "nodeId", "nodeLabel"],
    "the pause payload must carry no tool identity — if this changes, Flowise changed and the fix can be simplified",
  );
  const pauseNode = [...PAUSE_IDENTIFIED].reverse()
    .flatMap((f) => (f.ev === "agentFlowExecutedData" ? (f.data ?? []) : []))
    .find((n) => n?.data?.output?.isWaitingForHumanInput === true);
  assert.ok(pauseNode, "fixture must contain the paused node snapshot");
  assert.deepEqual(
    (pauseNode.data.output.calledTools ?? []).map((t) => t.name ?? t.tool),
    ["update_referral"],
    "the identity IS on the wire — this is what the gateway must read instead of inferring",
  );
});

test("a pause the gateway can attribute renders a card naming the action", async () => {
  mock.reset();
  mock.setFrames(PAUSE_IDENTIFIED);
  const { frames } = await runTurn(gateway, token, {
    message: "Update that referral's notes", mode: "manual", context: { page: "/referrals" },
  });

  const cards = uiFrames(frames);
  assert.equal(cards.length, 1, "expected exactly one approval card");
  const texts = frameTexts(cards[0]).join(" | ");
  assert.match(texts, /referral/i, `card should name the action; got: ${texts}`);
  assert.doesNotMatch(texts, /Confirming this action/i, "must not fall back to the generic title when the tool IS known");
  assert.equal(hasApproveButton(cards[0]), true, "an identified action should still be approvable");
  assert.match(thinkingLabels(frames).join(" | "), /referral/i);
});

test("REGRESSION: a second call to the same tool must not produce an unidentified approval card", async () => {
  // This is the owner-reported defect. Same real frames, with the pending tool also present in the
  // pause frame's cumulative usedTools — the shape Flowise sends on a second same-tool pause.
  mock.reset();
  mock.setFrames(withPendingToolRetired(PAUSE_IDENTIFIED, "update_referral"));
  const { frames } = await runTurn(gateway, token, {
    message: "Update that referral's notes again", mode: "manual", context: { page: "/referrals" },
  });

  const cards = uiFrames(frames);
  assert.equal(cards.length, 1, "a pause must still surface a card (never a silent dead end)");
  const texts = frameTexts(cards[0]).join(" | ");

  // The safety invariant, stated as the assertion that matters:
  // a card the gateway cannot attribute must NOT offer a live Approve.
  if (/Confirming this action/i.test(texts)) {
    assert.equal(
      hasApproveButton(cards[0]),
      false,
      "UNSAFE: the card could not name the action yet still offered Approve — the user is being asked to authorise an unknown write",
    );
  }
  // And the fix proper: the identity is on the pause frame, so the card should be named.
  assert.doesNotMatch(
    texts,
    /Confirming this action/i,
    "the pending tool's identity was available on the pause frame (output.calledTools) and should have been used",
  );
});

test("auto mode: an auto-approvable write resumes without a card and says what it did", async () => {
  mock.reset();
  // Same pause; auto mode + a non-destructive annotated tool → silent resume, no card.
  // Second upstream call (the resume) streams nothing further.
  mock.setFramesByCall([PAUSE_IDENTIFIED, []]);
  const { frames } = await runTurn(gateway, token, {
    message: "Update that referral's notes", mode: "auto", context: { page: "/referrals" },
  });

  assert.equal(uiFrames(frames).length, 0, "an auto-approved write should not card");
  const labels = thinkingLabels(frames).join(" | ");
  assert.match(labels, /Auto-approved/i, "the user's only notice of a cardless write is the auto-approved step");
  assert.match(labels, /referral/i, "the auto-approved label must name what was touched");
  assert.ok(mock.state.predictions.length >= 2, "the pause must actually be resumed upstream");
  assert.equal(
    mock.state.predictions[1]?.humanInput?.type,
    "proceed",
    "the resume must carry humanInput proceed",
  );
});

test("a delete always cards, even in auto mode (annotation-independent belt)", async () => {
  mock.reset();
  const deleteFrames = structuredClone(PAUSE_IDENTIFIED);
  for (const f of deleteFrames) {
    if (f.ev === "calledTools") {
      for (const t of f.data ?? []) if (t.tool === "update_referral") t.tool = "delete_referral";
    }
    if (f.ev === "agentFlowExecutedData") {
      for (const n of f.data ?? []) {
        for (const t of n?.data?.output?.calledTools ?? []) {
          if ((t.name ?? t.tool) === "update_referral") { if (t.name) t.name = "delete_referral"; else t.tool = "delete_referral"; }
        }
      }
    }
  }
  mock.setFrames(deleteFrames);
  const { frames } = await runTurn(gateway, token, {
    message: "delete that referral", mode: "auto", context: { page: "/referrals" },
  });

  assert.equal(uiFrames(frames).length, 1, "a delete must card in auto mode too");
  assert.doesNotMatch(
    thinkingLabels(frames).join(" | "),
    /Auto-approved/i,
    "a delete must never be reported as auto-approved",
  );
});
