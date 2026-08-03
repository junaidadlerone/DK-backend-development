// A referral must be genuinely finished before a campaign can use it (C11, 2026-07-31).
// Run with: node --test scripts/referral-readiness.test.mjs
//
// QA: the assistant created a referral campaign on a DRAFT referral — missing address, no consent,
// no signature. The rule existed only as prose in a similarity-retrieved playbook (measured present
// on ~2 of 8 turns), and the referral's status was visible in the injected context, so this was an
// ENFORCEMENT failure, not a knowledge failure. It is now refused at the tool boundary.
//
// Owner-set rule: the assistant may fill the ordinary fields; the USER completes the consent +
// signature section and finalises the referral; only a referral the user has made Ready may be used.
// Plus: at least one job photo (agent-side only — the server's Ready computation is NOT changed).
import test from "node:test";
import assert from "node:assert/strict";
import { referralCampaignBlockers, referralMissingToFinalize } from "../src/tools-write.mjs";

const READY = {
  status: { name: "Ready" },
  home_owner_info: {
    name: "Adler One",
    address: { street_address: "123 Main St", city: "Franklin Township", state: "Ohio", zip: "43001", country: "United States of America" },
  },
  job_details: { job_type: { id: "jt-1", name: "Roof Repair" }, value: 9000 },
};

test("a complete, user-finalised referral with a photo is usable", () => {
  const out = referralCampaignBlockers(READY, 2);
  assert.equal(out.ok, true);
  assert.deepEqual(out.missing, []);
  assert.equal(out.plain, null);
});

test("REGRESSION: a Draft referral is refused, and consent/signature are the USER's to complete", () => {
  const draft = structuredClone(READY);
  draft.status = { name: "Draft" };
  const out = referralCampaignBlockers(draft, 1);
  assert.equal(out.ok, false);
  assert.deepEqual(out.user_completes_in_app, ["owner_consent", "owner_signature"]);
  assert.deepEqual(out.you_can_fill, [], "nothing here is the assistant's to fill");
  assert.match(out.plain, /consent/i);
});

test("a Ready referral with NO photo is still refused, and the assistant can offer the uploader", () => {
  // The app marks job images required but enforces it nowhere, and the campaign's printed image is
  // the referral's first gallery photo — so a photo-less referral prints without one.
  const out = referralCampaignBlockers(READY, 0);
  assert.equal(out.ok, false);
  assert.deepEqual(out.agent_can_offer, ["job_photo"]);
  assert.deepEqual(out.user_completes_in_app, [], "consent is already on file for a Ready referral");
  assert.match(out.plain, /photo/i);
});

test("missing ordinary fields are the assistant's to fill, and are named individually", () => {
  const bare = { status: { name: "Draft" }, home_owner_info: { address: {} }, job_details: {} };
  const out = referralCampaignBlockers(bare, 0);
  assert.equal(out.ok, false);
  assert.deepEqual(
    out.you_can_fill,
    ["referrer_name", "street_address", "city", "state", "zip", "country", "job_type", "job_value"],
  );
  assert.deepEqual(out.agent_can_offer, ["job_photo"]);
  assert.deepEqual(out.user_completes_in_app, ["owner_consent", "owner_signature"]);
});

test("an 'In Use' referral counts as user-finalised (it is already on a campaign)", () => {
  const inUse = structuredClone(READY);
  inUse.status = { name: "In Use" };
  assert.equal(referralCampaignBlockers(inUse, 1).ok, true);
});

test("zero job value is refused (the app requires a value greater than zero)", () => {
  const noValue = structuredClone(READY);
  noValue.job_details.value = 0;
  assert.deepEqual(referralCampaignBlockers(noValue, 1).you_can_fill, ["job_value"]);
});

test("plain wording never leaks internal field names", () => {
  const out = referralCampaignBlockers({ status: { name: "Draft" }, home_owner_info: { address: {} }, job_details: {} }, 0);
  for (const snake of ["street_address", "job_type", "job_value", "owner_consent", "owner_signature", "job_photo"]) {
    assert.equal(out.plain.includes(snake), false, `plain must not contain ${snake}`);
  }
});

test("a missing/unreadable record is refused rather than treated as ready", () => {
  assert.equal(referralCampaignBlockers(null, 0).ok, false);
  assert.equal(referralCampaignBlockers(undefined, 5).ok, false);
});

// ── The job photo must appear in the referral's OWN completeness report ────────
// Reported live 2026-08-03, auto-approve on: the agent created a referral with every field filled and
// answered "saved as a draft with all the details… complete the consent and signature section". It
// never mentioned a photo. The user found out only when a campaign later refused the referral.
//
// The photo requirement HAD been implemented — in referralCampaignBlockers, the campaign gate — but
// never in what create_referral/update_referral report, which is what the agent reads at the moment it
// decides what to say. And the prompt only tells it to render the uploader when the user WANTS photos,
// which is reactive, so nothing triggered it. These tests pin the trigger.
test("a brand-new referral reports job_photo as outstanding", () => {
  // create_referral passes 0 without a read: a referral it just made cannot have images.
  const miss = referralMissingToFinalize(
    { name: "Adler Three", address: { country: "United States", street_address: "123 Franklin", city: "Franklin Township", state: "OH", zip: "43001" } },
    { job_type: { name: "Roof Repair" }, value: 600 },
    0,
  );
  assert.deepEqual(miss, ["job_photo"], "every field was supplied, so the photo is the ONLY thing left");
});

test("a referral that HAS a photo does not report one missing", () => {
  const miss = referralMissingToFinalize(
    { name: "Adler Three", address: { country: "US", street_address: "1", city: "c", state: "OH", zip: "43001" } },
    { job_type: { name: "Roof Repair" }, value: 600 },
    2,
  );
  assert.deepEqual(miss, [], "telling the user to upload a photo they already uploaded is its own bug");
});

test("an UNREADABLE gallery claims nothing either way", () => {
  // referralPhotoCount returns undefined on a failed read. Reporting "no photo" then would send the
  // user round a loop they cannot exit — the same class of unverified assertion as claiming a write.
  const miss = referralMissingToFinalize(
    { name: "A B", address: { country: "US", street_address: "1", city: "c", state: "OH", zip: "43001" } },
    { job_type: { name: "Roof Repair" }, value: 600 },
    undefined,
  );
  assert.deepEqual(miss, []);
});

test("the photo is listed alongside genuinely missing fields, not instead of them", () => {
  const miss = referralMissingToFinalize({ name: "A B" }, {}, 0);
  assert.ok(miss.includes("job_photo"));
  for (const f of ["country", "street_address", "city", "state", "zip", "job_type", "job_value"]) {
    assert.ok(miss.includes(f), `${f} must still be reported`);
  }
});
