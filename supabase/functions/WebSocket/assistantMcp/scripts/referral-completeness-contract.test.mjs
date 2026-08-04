// The MCP's idea of "a complete referral" must match the app's (2026-08-04).
// Run with: node --test scripts/referral-completeness-contract.test.mjs
//
// REPORTED LIVE: the agent created a referral with every field filled and said "saved as a draft with
// all the details", and a campaign later refused it for having no job photo. The requirement existed in
// the campaign gate and in the form's red asterisk, and was missing from what the referral tools
// reported — so the agent could not have known.
//
// The root problem is that "complete" was defined in FIVE places and they disagreed: the form's
// asterisks, isRequiredComplete (which gates Submit), validateForm (which blocks it), the server's own
// 8-condition recompute, and referralMissingToFinalize. Fixing the photo fixed one instance. This test
// closes the drift: add a required field to the app's form and it fails here until the MCP's report
// covers it, rather than the agent quietly promising a completeness it cannot deliver.
//
// The app's list arrives in the generated artifact (frontend `npm run genui:catalog`), because
// dk-assistant-mcp is a separate repository whose CI cannot read that source.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

process.env.SUPABASE_URL ??= "http://127.0.0.1:9999";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.SUPABASE_ANON_KEY ??= "test-anon-key";
const { referralMissingToFinalize } = await import("../src/tools-write.mjs");

const HERE = dirname(fileURLToPath(import.meta.url));
const artifact = JSON.parse(readFileSync(join(HERE, "..", "src", "genui-catalog.schema.json"), "utf8"));

/**
 * The app's field name → what this service calls it, or who owns it.
 *
 * A DECLARED table, deliberately, in the same spirit as the auto-approve decision table: a new field in
 * the app's form lands here as a compile-time decision rather than being silently absent. `owner`
 * distinguishes the three answers that matter to the agent:
 *   "agent"  — the assistant can fill it from what the user said, and must report it as missing
 *   "user"   — only the user can do it, in the app (consent + signature); never the agent's to claim
 */
const FIELD_MAP = {
  country: { as: "country", owner: "agent" },
  name: { as: "referrer_name", owner: "agent" },
  street: { as: "street_address", owner: "agent" },
  state: { as: "state", owner: "agent" },
  city: { as: "city", owner: "agent" },
  zip: { as: "zip", owner: "agent" },
  jobType: { as: "job_type", owner: "agent" },
  jobValue: { as: "job_value", owner: "agent" },
  // consentSignatureId + homeownerConsent. The agent can NEVER set these — no schema exposes them, and
  // the server's own recompute is what promotes a referral once the user does it in the app.
  consent: { as: null, owner: "user" },
};

/** An empty referral: every agent-fillable field should be reported missing. */
const emptyMissing = () => referralMissingToFinalize({}, {}, 0);

test("the artifact actually carries the app's list (guards the guard)", () => {
  const fields = artifact.referral_required_fields;
  assert.ok(Array.isArray(fields) && fields.length >= 8,
    `expected the app's required fields in the artifact, got ${JSON.stringify(fields)} — re-run npm run genui:catalog in the frontend and re-copy`);
  assert.ok(fields.includes("consent"), "consent gates the app's Submit button and must be in the list");
});

test("every field the APP requires is mapped here on purpose", () => {
  const unmapped = artifact.referral_required_fields.filter((f) => !(f in FIELD_MAP));
  assert.deepEqual(unmapped, [],
    "the app's form gained a required field. Decide what it means for the assistant: add it to FIELD_MAP "
    + "as owner 'agent' (and report it from referralMissingToFinalize) or 'user' (only they can do it).");
});

test("this table has no entries the app no longer requires", () => {
  const stale = Object.keys(FIELD_MAP).filter((f) => !artifact.referral_required_fields.includes(f));
  assert.deepEqual(stale, [], "remove these — the app stopped requiring them");
});

test("every AGENT-owned field is reported as missing when it is missing", () => {
  // This is the assertion the photo bug would have failed: a field the app requires, which the agent is
  // able to fill, and which the tool never mentioned.
  const missing = emptyMissing();
  const notReported = Object.entries(FIELD_MAP)
    .filter(([, v]) => v.owner === "agent")
    .map(([, v]) => v.as)
    .filter((name) => !missing.includes(name));
  assert.deepEqual(notReported, [],
    "referralMissingToFinalize must name every app-required field the assistant can fill — otherwise it "
    + "reports a draft as complete that the app, and then a campaign, will refuse");
});

test("USER-owned fields are never reported as the agent's to fill", () => {
  // Consent and signature are the user's. Listing them under missing_to_finalize would invite the model
  // to try, and it has no tool for it — the hole that let a referral reach Ready without consent.
  const missing = emptyMissing();
  for (const bad of ["consent", "owner_consent", "owner_signature", "signature", "signature_id"]) {
    assert.ok(!missing.includes(bad), `${bad} must not appear in missing_to_finalize`);
  }
});

test("the job photo is reported, though the app's own gate omits it", () => {
  // Deliberate asymmetry, kept because the app is inconsistent with ITSELF: "Upload Job Images" carries
  // the same red asterisk as every required field, yet isRequiredComplete and validateForm both skip it,
  // so a referral reaches Ready with no photo. The campaign gate then refuses it, because a campaign's
  // artwork comes from gallery[0]. The agent reports it so the user finds out at the referral, not three
  // steps later. (The app not honouring its own asterisk is logged as a separate frontend bug.)
  assert.ok(emptyMissing().includes("job_photo"));
  assert.ok(!artifact.referral_required_fields.includes("jobPhoto"),
    "if the app ever adds the photo to isRequiredComplete, fold it into FIELD_MAP and delete this note");
});

test("a fully-supplied referral with a photo reports nothing missing", () => {
  const missing = referralMissingToFinalize(
    { name: "Adler Three", address: { country: "United States", street_address: "123 Franklin", city: "Franklin Township", state: "OH", zip: "43001" } },
    { job_type: { name: "Roof Repair" }, value: 600 },
    1,
  );
  assert.deepEqual(missing, [], "the two definitions must agree on the positive case too");
});
