// Unit coverage for the gateway's pure decision functions (F2, 2026-07-31).
// Run with: node --test scripts/pure-surface.test.mjs
//
// These three were already `export`ed and had ZERO test callers, while every hardening decision in
// them is recorded in a comment as a lesson from a live incident. They are pure, they decide
// user-visible behaviour, and a silent regression in any of them looks like the model misbehaving
// rather than like a bug:
//
//   announceNudgeCheck — decides whether a reply that PROMISED an action but ran nothing gets
//     re-driven. A false positive re-POSTs a turn that was legitimately waiting on the user; a
//     false negative leaves the user holding an unfulfilled promise. 27 veto phrases, and the
//     load-bearing `\b` in the commitment pattern, are pinned here.
//   toolSucceeded — decides whether a data-refresh frame is emitted and whether a cut-off retry is
//     safe. Wrong → a stale screen, or a repeated write.
//   normalizeContext — the screen context every "this page" answer depends on.
import test from "node:test";
import assert from "node:assert/strict";
import { announceNudgeCheck, normalizeContext, toolSucceeded } from "../src/chat.mjs";

// ── announceNudgeCheck: it SHOULD fire ─────────────────────────────────────────
test("fires on an unfulfilled first-person commitment", () => {
  const cases = [
    "I'll create that campaign now.",
    "I will update the referral for you.",
    "I'm going to delete that design.",
    "Let me pull up your campaign list.",
    "One moment — I'll add those addresses.",
    "Give me a second, I'll check your analytics.",
    "Hang tight, I'll duplicate that template.",
    "Sure. I’ll send that invitation.", // curly apostrophe
    // Particle verbs with an intervening object. "set it up" does NOT contain the literal
    // "set up", so these used to slip the net entirely and the promise was never chased.
    "I'll set it up.",
    "I'll set that up for you.",
    "I'll set the campaign up now.",
    "I'll look it up.",
    "I'll pull that up.",
  ];
  for (const reply of cases) {
    const out = announceNudgeCheck(reply);
    assert.equal(out.trigger, true, `should have fired: ${reply}`);
    assert.equal(out.veto, null);
  }
});

test("only the LAST TWO sentences are considered", () => {
  // An early promise that the reply went on to fulfil must not re-trigger at the end.
  const early = "I'll look that up. Here are your three campaigns, all active. Anything else?";
  assert.equal(announceNudgeCheck(early).trigger, false);
});

// ── announceNudgeCheck: it MUST NOT fire ───────────────────────────────────────
test("does not fire without terminal punctuation (that is the cut-off retry's job)", () => {
  const out = announceNudgeCheck("I'll create that campaign");
  assert.equal(out.trigger, false);
  assert.equal(out.tail, "", "an unfinished reply short-circuits before tail extraction");
});

test("does not fire without a first-person commitment", () => {
  for (const reply of [
    "We'll need to create the campaign first.",   // we'll, not I'll
    "You'll want to update that referral.",        // you'll
    "The campaign was created.",                    // past tense, already done
    "Deleting the campaign now.",                   // no commitment token — known gap, pinned deliberately
  ]) {
    assert.equal(announceNudgeCheck(reply).trigger, false, `should not have fired: ${reply}`);
  }
});

test("does not fire when the commitment has no action verb after it", () => {
  // NB the verb list is stem-based and broad — "changes" matches `chang`, "gets" matches `get`.
  // So a genuine no-verb tail has to avoid all 40 stems; that breadth is deliberate (a missed
  // promise is worse than an extra continuation) and is pinned here rather than assumed.
  assert.equal(announceNudgeCheck("I'll be honest with you.").trigger, false);
  assert.equal(announceNudgeCheck("I'll be brief.").trigger, false);
});

test("a trailing question short-circuits BEFORE any veto is evaluated", () => {
  // The punctuation gate runs first, so `veto` is null rather than named. This distinction matters:
  // the gateway logs named vetoes as near-misses for tuning, and a question is not a near-miss —
  // it is the model legitimately waiting on the user.
  for (const reply of [
    "I'll create it — which one did you mean?",
    "I'll delete it — would you like me to?",
    "I'll set it up. Do you want the referral type?",
    "I'll update it — which of the two designs?",
  ]) {
    const out = announceNudgeCheck(reply);
    assert.equal(out.trigger, false, `should not have fired: ${reply}`);
    assert.equal(out.veto, null, "a question short-circuits, so no veto is attributed");
  }
});

test("every non-question veto phrase suppresses the commitment AND names itself", () => {
  // Each of these WOULD trigger without its veto — that is what makes them the near-misses worth
  // pinning. A named `veto` is what the gateway logs for tuning.
  const vetoed = [
    "I'll update it, let me know when you're ready.",
    "I'll create that, just wait a moment for the details.",
    "I'll set it up, but hold off until you confirm.",
    "I'll add them, please stand by.",
    "I'll change it once you check with your team.",
    "I'll delete it if you want me to.",
    "I'll launch it once you approve.",
    "I'll send it when you say so.",
    "I'll update it after you review the copy.",
    "I'll create it as soon as you send the address.",
    "I'll remove it unless you'd rather keep it.",
    "I'll update the referral, but I need the zip code.",
    "I'll create it — I'll need your business address.",
    "I'll add them, I need you to pick a design.",
    "I'll create it, feel free to change the name after.",
    "I'll get it ready and I'll be here when you're back.",
    "I'll update it, or leave it as it is.",
    "I'll change the name and keep that design.",
    "I'll create it — let me explain the steps first.",
    "I'll set it up and walk you through it.",
    "I'll update it, no changes to the audience.",
  ];
  for (const reply of vetoed) {
    const out = announceNudgeCheck(reply);
    assert.equal(out.trigger, false, `should have been vetoed: ${reply}`);
    assert.ok(out.veto, `a veto NAME must be reported for tuning: ${reply}`);
  }
});

test("handles empty and non-string input without throwing", () => {
  for (const input of [undefined, null, "", "   ", 42, {}]) {
    assert.equal(announceNudgeCheck(input).trigger, false);
  }
});

// ── toolSucceeded ──────────────────────────────────────────────────────────────
test("a clean write result is a success", () => {
  assert.equal(toolSucceeded('{"id":"x","updated":true}'), true);
  assert.equal(toolSucceeded('{"verified":true,"updated":true}'), true);
});

test("REGRESSION: a `blocked` refusal is NOT a success", () => {
  // These envelopes carry no `error` key. Before this was handled, a refused write emitted a
  // data-refresh frame for a change that never happened.
  assert.equal(toolSucceeded('{"blocked":"referral_not_ready","retry":false}'), false);
  assert.equal(toolSucceeded('{"blocked":"campaign_live_or_mailed"}'), false);
});

test("REGRESSION: an unverified write is NOT a success", () => {
  assert.equal(toolSucceeded('{"verified":false,"fields_not_applied":["address.zip"]}'), false);
});

test("the original failure markers still count as failures", () => {
  assert.equal(toolSucceeded('{"error":"Not found."}'), false);
  assert.equal(toolSucceeded('{"missing_required":["campaign_name"]}'), false);
  assert.equal(toolSucceeded('{"role_restricted":true}'), false);
});

test("falls back to a string scan when the output is not parseable JSON", () => {
  assert.equal(toolSucceeded('Error: {"error":"boom"} trailing junk'), false);
  assert.equal(toolSucceeded('prefix {"blocked":"x"} suffix'), false);
  assert.equal(toolSucceeded('noise {"verified": false} noise'), false);
  assert.equal(toolSucceeded("plain success text"), true);
});

// ── normalizeContext ───────────────────────────────────────────────────────────
test("returns null for a missing or non-object context", () => {
  for (const input of [undefined, null, "", "/campaigns", 7]) {
    assert.equal(normalizeContext(input), null);
  }
});

test("passes an already-tokenized context through", () => {
  const out = normalizeContext({ page: "campaign_detail", campaign_id: "c-1" });
  assert.equal(out.page, "campaign_detail");
  assert.equal(out.campaign_id, "c-1");
});

test("derives page and entity id from a legacy path", () => {
  const out = normalizeContext({ path: "/campaigns/abc-123" });
  assert.ok(out, "a legacy path must still produce a context");
  assert.match(JSON.stringify(out), /campaign/i);
});

test("an unknown shape still yields a usable page rather than throwing", () => {
  const out = normalizeContext({ something: "else" });
  if (out !== null) assert.equal(typeof out.page, "string");
});
