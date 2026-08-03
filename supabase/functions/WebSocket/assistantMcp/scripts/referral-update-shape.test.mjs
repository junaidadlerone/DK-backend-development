// Coverage for update_referral's payload shape and post-write verification (2026-07-31).
// Run with: node --test scripts/referral-update-shape.test.mjs
//
// WHY THIS EXISTS — the incident these tests pin down:
// update_referral sent the createReferral-shaped NESTED body { home_owner_info: { name, address } }
// to the updateReferralById endpoint, which reads only FLAT top-level keys. The nested key matched
// no branch, every homeowner/address field was silently discarded, and the endpoint still returned
// HTTP 200 {status:"success"} — so the tool reported `updated: true`. Confirmed against the real
// record: FIVE consecutive assistant edits produced referral-history entries reading only
// "auto-updated status to Draft" with no field changes, while each reported success to the model.
// The model then retried, because it was being told it had worked.
//
// Two invariants are pinned here:
//   1. the PATCH body must use the endpoint's flat contract and must never contain home_owner_info
//   2. a write may only be reported as applied after comparing the read-back record against what
//      was actually sent
import test from "node:test";
import assert from "node:assert/strict";
import { diffReferralWrite, flattenReferralUpdate, resolveCountryName } from "../src/tools-write.mjs";

// ── 1. Payload shape ────────────────────────────────────────────────────────────
test("flatten: never emits home_owner_info (the key the endpoint ignores)", () => {
  const out = flattenReferralUpdate({
    name: "Adler One",
    phone: "+12145551234",
    address: { street_address: "123 Main St", city: "Franklin Township", state: "Ohio", zip: "43001", country: "United States of America" },
  });
  assert.equal("home_owner_info" in out, false, "home_owner_info must never be sent to updateReferralById");
});

test("flatten: name/phone/email go flat at the top level", () => {
  const out = flattenReferralUpdate({ name: "Adler One", phone: "+12145551234", email: "a@b.com" });
  assert.equal(out.name, "Adler One");
  assert.equal(out.phone, "+12145551234");
  assert.equal(out.email, "a@b.com");
});

test("flatten: address is sent as ONE object, not as split flat keys", () => {
  // The object branch merges over the stored address; the split-flat-keys branch writes through a
  // shallow copy and throws on a row whose home_owner_info has no address at all.
  const out = flattenReferralUpdate({ address: { zip: "43001" } });
  assert.deepEqual(out.address, { zip: "43001" });
  assert.equal("zip" in out, false, "zip must live inside address, not at the top level");
  assert.equal("street_address" in out, false);
});

test("flatten: a zip-only edit sends nothing else (partial edits stay partial)", () => {
  const out = flattenReferralUpdate({ address: { zip: "43001" } });
  assert.deepEqual(Object.keys(out), ["address"]);
});

test("flatten: absent fields are omitted, never sent as undefined", () => {
  const out = flattenReferralUpdate({ name: "Adler One" });
  assert.deepEqual(Object.keys(out), ["name"]);
});

test("flatten: an empty/absent home_owner_info contributes nothing", () => {
  assert.deepEqual(flattenReferralUpdate(undefined), {});
  assert.deepEqual(flattenReferralUpdate({}), {});
});

// ── 2. Post-write verification ──────────────────────────────────────────────────
const recWith = (address, extra = {}) => ({ home_owner_info: { name: "Adler One", address }, job_details: {}, ...extra });

test("diff: the real incident — zip sent, record still empty => NOT applied", () => {
  const sent = { address: { zip: "43001" } };
  const out = diffReferralWrite(sent, recWith({ street_address: "123", city: "Franklin County" }));
  assert.equal(out.ok, false);
  assert.deepEqual(out.not_applied.map((f) => f.field), ["address.zip"]);
});

test("diff: every address field dropped => all reported, so the model cannot retry blindly", () => {
  const sent = { address: { street_address: "123 Main St", city: "Franklin Township", state: "Ohio", zip: "43001", country: "United States of America" } };
  const out = diffReferralWrite(sent, recWith({}));
  assert.equal(out.ok, false);
  assert.deepEqual(
    out.not_applied.map((f) => f.field).sort(),
    ["address.city", "address.country", "address.state", "address.street_address", "address.zip"],
  );
});

test("diff: a write that landed verifies clean", () => {
  const sent = { address: { zip: "43001", city: "Franklin Township" } };
  const out = diffReferralWrite(sent, recWith({ zip: "43001", city: "Franklin Township" }));
  assert.equal(out.ok, true);
  assert.deepEqual(out.not_applied, []);
});

test("diff: phone compared on digits, so formatting is not a false alarm", () => {
  const out = diffReferralWrite({ phone: "+12145551234" }, { home_owner_info: { phone: "(214) 555-1234" }, job_details: {} });
  assert.equal(out.ok, true);
});

test("diff: email compared case-insensitively", () => {
  const out = diffReferralWrite({ email: "A@B.com" }, { home_owner_info: { email: "a@b.com" }, job_details: {} });
  assert.equal(out.ok, true);
});

test("diff: whitespace is not a false alarm", () => {
  const out = diffReferralWrite({ name: " Adler One " }, { home_owner_info: { name: "Adler One" }, job_details: {} });
  assert.equal(out.ok, true);
});

test("diff: job_details value and notes are verified too", () => {
  const sent = { job_details: { value: 9000, notes: "probe" } };
  const okRec = { home_owner_info: {}, job_details: { value: 9000, notes: "probe" } };
  assert.equal(diffReferralWrite(sent, okRec).ok, true);
  const badRec = { home_owner_info: {}, job_details: {} };
  const out = diffReferralWrite(sent, badRec);
  assert.equal(out.ok, false);
  assert.deepEqual(out.not_applied.map((f) => f.field).sort(), ["job_details.notes", "job_details.value"]);
});

test("diff: job_type is verified by name", () => {
  const sent = { job_details: { job_type: { id: "x", name: "Roof Repair" } } };
  assert.equal(diffReferralWrite(sent, { home_owner_info: {}, job_details: { job_type: { id: "x", name: "Roof Repair" } } }).ok, true);
  assert.equal(diffReferralWrite(sent, { home_owner_info: {}, job_details: {} }).ok, false);
});

test("diff: a DIFFERENT non-empty stored value is reported separately, not as a drop", () => {
  // Server-side canonicalization is legitimate; only an ABSENT value proves the write was dropped.
  // Conflating the two would manufacture "this field can't be changed" on successful writes.
  const out = diffReferralWrite({ address: { state: "Ohio" } }, recWith({ state: "OH" }));
  assert.equal(out.ok, true, "a transformed value must not fail verification");
  assert.deepEqual(out.stored_differs.map((f) => f.field), ["address.state"]);
});

test("diff: an unreadable record cannot be used to claim success", () => {
  const out = diffReferralWrite({ address: { zip: "43001" } }, null);
  assert.equal(out.ok, false);
  assert.equal(out.unverified, true, "no read-back means unverified, never 'applied'");
});

// ── 3. Country canonicalization (C6b) ───────────────────────────────────────────
// The assistant wrote "United States". A live probe showed the app stores
// "United States of America", and getAllStatesV2?country_name=United States returns
// 404 "Country not found" — so the wrong country ALSO defeated state canonicalization.
const WORLD = [
  { name: "United States of America", code: "US" },
  { name: "United States Minor Outlying Islands", code: "UM" },
  { name: "American Samoa", code: "AS" },
  { name: "United Kingdom of Great Britain and Northern Ireland", code: "GB" },
];

test("country: 'United States' resolves to the canonical stored name", () => {
  assert.equal(resolveCountryName("United States", WORLD), "United States of America");
});

test("country: the exact canonical name is preserved", () => {
  assert.equal(resolveCountryName("United States of America", WORLD), "United States of America");
});

test("country: an ISO code resolves", () => {
  assert.equal(resolveCountryName("US", WORLD), "United States of America");
  assert.equal(resolveCountryName("gb", WORLD), "United Kingdom of Great Britain and Northern Ireland");
});

test("country: common spellings and punctuation resolve", () => {
  for (const input of ["USA", "U.S.A.", "usa", "america", "united states of america"]) {
    assert.equal(resolveCountryName(input, WORLD), "United States of America", `failed for ${input}`);
  }
});

test("country: an unknown value resolves to null so it is left exactly as the user typed it", () => {
  assert.equal(resolveCountryName("Freedonia", WORLD), null);
  assert.equal(resolveCountryName("", WORLD), null);
  assert.equal(resolveCountryName(undefined, WORLD), null);
});

test("country: must not confuse a lookalike ('United States Minor Outlying Islands')", () => {
  assert.equal(resolveCountryName("United States Minor Outlying Islands", WORLD), "United States Minor Outlying Islands");
});

test("country: with no list available it still maps the US aliases (offline fallback)", () => {
  assert.equal(resolveCountryName("United States", null), "United States of America");
  assert.equal(resolveCountryName("Freedonia", null), null);
});
