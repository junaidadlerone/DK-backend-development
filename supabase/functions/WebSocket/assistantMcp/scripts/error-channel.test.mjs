// The error channel must not destroy a server-side refusal (2026-07-31).
// Run with: node --test scripts/error-channel.test.mjs
//
// THE DEFECT: sanitizeUpstream is written for PROSE — it deletes SCREAMING_SNAKE codes and JSON
// punctuation because its output is interpolated into a sentence. Applied to a REFUSAL that is
// its own justification, it deletes the only actionable parts. A server gate answering
//    400 {"error":"REFERRAL_NOT_READY","missing":["zip","owner_consent"]}
// reached the model as "That didn't pass validation: ." — and a vague message reads as transient,
// which invites exactly the blind retry the gate exists to prevent.
//
// This matters beyond one endpoint: it is the channel EVERY future server-side validation has to
// travel, so any precondition added upstream would have been invisible to the assistant.
import test from "node:test";
import assert from "node:assert/strict";
import { makeGuard, sanitizeUpstream, upstreamRefusal } from "../src/tool-helpers.mjs";

const guard = makeGuard("write");
const upstream = (status, body, extra = {}) => ({ __error: true, status, body: JSON.stringify(body), ...extra });

// ── The regression, stated as the original symptom ──────────────────────────────
test("REGRESSION: a code-only refusal is no longer flattened to an empty sentence", () => {
  const body = { error: "REFERRAL_NOT_READY", missing: ["zip", "owner_consent"] };
  // The old behaviour, still true of the prose sanitizer — this is WHY the structured path exists.
  assert.equal(sanitizeUpstream(JSON.stringify(body)), "", "sanitizeUpstream still yields nothing for this shape");

  const out = guard(upstream(400, body));
  assert.equal(out.code, "REFERRAL_NOT_READY");
  assert.deepEqual(out.missing_required, ["zip", "owner_consent"]);
  assert.equal(out.retry, false, "a refusal must be marked non-retryable");
  assert.match(out.error, /\S/, "there must still be a human sentence for the model to work from");
  assert.doesNotMatch(out.error, /^That didn't pass validation: \.$/, "the empty-sentence bug");
});

test("a refusal with a real message keeps the message AND the structure", () => {
  const out = guard(upstream(422, { error: "INVALID_INPUT", message: "Zip must be 5 digits or ZIP+4." }));
  assert.match(out.error, /Zip must be 5 digits/);
  assert.equal(out.code, "INVALID_INPUT");
  assert.equal(out.retry, false);
});

test("the note tells the model not to retry and not to leak the code", () => {
  const out = guard(upstream(400, { error: "REFERRAL_NOT_READY" }));
  assert.match(out.note, /not a transient failure|identical/i);
  assert.match(out.note, /never show the user a code|plain product language/i);
});

// ── A 200 that actually means failure ───────────────────────────────────────────
test("a 2xx error envelope is treated as a refusal too", () => {
  const out = guard(upstream(200, { success: false, error: "CAMPAIGN_LOCKED", message: "That campaign is locked." }, { __envelope: true }));
  assert.equal(out.code, "CAMPAIGN_LOCKED");
  assert.match(out.error, /locked/i);
  assert.equal(out.retry, false);
  assert.match(out.note, /nothing was changed/i);
});

// ── upstreamRefusal in isolation ────────────────────────────────────────────────
test("recognises the field-list keys servers actually use", () => {
  for (const key of ["missing_required", "missing", "missing_fields", "required"]) {
    const out = upstreamRefusal(JSON.stringify({ error: "X_Y", [key]: ["city"] }));
    assert.deepEqual(out.missing_required, ["city"], `failed for ${key}`);
  }
});

test("a message that IS just the code is not passed off as a sentence", () => {
  const out = upstreamRefusal(JSON.stringify({ error: "NOT_FOUND", message: "NOT_FOUND" }));
  assert.equal(out.code, "NOT_FOUND");
  assert.equal(out.plain, undefined, "repeating the code as prose tells the model nothing new");
});

test("still strips genuine leak risks from the message", () => {
  const out = upstreamRefusal(JSON.stringify({
    error: "BAD_REF",
    message: "Referral 010d382b-33fa-42a2-97d1-eafb3a679a32 at https://internal.example/api/v1/x is invalid",
  }));
  assert.doesNotMatch(out.plain, /010d382b/, "ids must not survive");
  assert.doesNotMatch(out.plain, /https?:\/\//, "URLs must not survive");
  assert.match(out.plain, /is invalid/, "the human part survives");
});

test("returns null when there is nothing structured to report", () => {
  assert.equal(upstreamRefusal("not json at all"), null);
  assert.equal(upstreamRefusal(JSON.stringify({ unrelated: true })), null);
  assert.equal(upstreamRefusal(JSON.stringify([1, 2, 3])), null, "an array is not a refusal envelope");
  assert.equal(upstreamRefusal(""), null);
  assert.equal(upstreamRefusal(null), null);
});

test("an over-long server message is capped rather than dumped into the turn", () => {
  const out = upstreamRefusal(JSON.stringify({ error: "E_C", message: "x".repeat(500) }));
  assert.ok(out.plain.length <= 241, `expected a capped message, got ${out.plain.length}`);
});

// ── The other statuses must keep behaving exactly as before ─────────────────────
test("non-refusal statuses are unchanged (no structure, no retry flag)", () => {
  const cases = [
    [401, /session has expired/i],
    [403, /permission|role/i],
    [404, /not found/i],
    [409, /conflicts/i],
    [500, /server error/i],
  ];
  for (const [status, re] of cases) {
    const out = guard(upstream(status, { error: "SOMETHING_ELSE" }));
    assert.match(out.error, re, `status ${status}`);
    assert.equal(out.retry, undefined, `status ${status} must not be marked non-retryable`);
    assert.equal(out.code, undefined, `status ${status} must not carry a code`);
  }
});

// Status 0 is deliberately NOT in the list above (changed by D6, 2026-08-03). A transport failure
// means the request may or may not have reached the server, so for a WRITE "try again in a moment" is
// an instruction to possibly perform the mutation twice — and for a create that is a duplicate.
test("status 0 on a WRITE reports an unknown outcome instead of inviting a blind retry", () => {
  const out = guard(upstream(0, { error: "SOMETHING_ELSE" }));
  assert.match(out.error, /don't know whether that went through/i);
  assert.equal(out.retry, false);
  assert.match(out.note, /READ the current state back/i);
});

test("status 0 on a READ is still simply retryable", () => {
  const out = makeGuard("read")(upstream(0, { error: "SOMETHING_ELSE" }));
  assert.match(out.error, /couldn't reach/i);
  assert.equal(out.retry, undefined, "a read has no side effect to be unsure about");
});

test("a successful call is still passed through untouched", () => {
  assert.equal(guard({ status: 200, body: "{}" }), null);
  assert.equal(guard(null), null);
});
