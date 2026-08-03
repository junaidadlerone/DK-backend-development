// The write-verification contract (D1, 2026-07-31).
// Run with: node --test scripts/write-verification.test.mjs
//
// THE INVARIANT: a tool may only assert a mutation it OBSERVED in post-write state.
//
// WHY: `update_referral` sent a nested shape, `updateReferralById` reads only flat keys so its branch
// never fired, and it still answered 200 {status:"success"} — which the tool relayed as
// `updated: true`. The referral's own history shows five agent writes with zero field changes, each
// reported as a success, so the model kept "correcting" a value that had never been stored. A 2xx
// from these endpoints means "your request parsed", never "your data changed".
//
// diffWrite is now the single comparison engine behind every verified write (the referral diff, the
// organization row check, and the five writes that previously claimed success from a 2xx alone).
// These tests pin the engine's THREE distinct outcomes, because they call for different words to the
// user, and the equality helpers, because a false "that didn't save" is its own bug.
import test from "node:test";
import assert from "node:assert/strict";
import {
  dateEq, diffWrite, hexEq, numberEq, phoneEq, readBackAndCompare, unappliedWrite, writeEmpty, writeNorm,
} from "../src/tool-helpers.mjs";
import { bundleNameEq, diffReferralWrite } from "../src/tools-write.mjs";

// ── The three outcomes ───────────────────────────────────────────────────────

test("a stored value matching what we sent verifies", () => {
  const v = diffWrite([{ field: "name", sent: "Adler One", get: (r) => r.name }], { name: "Adler One" });
  assert.equal(v.ok, true);
  assert.deepEqual(v.not_applied, []);
  assert.deepEqual(v.stored_differs, []);
});

test("an EMPTY stored value is a dropped write — this is the reported bug", () => {
  for (const stored of [undefined, null, "", "   "]) {
    const v = diffWrite([{ field: "city", sent: "Houston", get: (r) => r.city }], { city: stored });
    assert.equal(v.ok, false, `stored ${JSON.stringify(stored)} must fail verification`);
    assert.deepEqual(v.not_applied.map((f) => f.field), ["city"]);
  }
});

test("a DIFFERENT stored value is reported but does NOT fail verification", () => {
  // Server-side canonicalization is legitimate. Conflating it with a dropped write would produce
  // confident "that field can't be changed" messages on writes that fully succeeded.
  const v = diffWrite([{ field: "city", sent: "houston tx", get: (r) => r.city }], { city: "Houston" });
  assert.equal(v.ok, true);
  assert.deepEqual(v.stored_differs, [{ field: "city", sent: "houston tx", stored: "Houston" }]);
});

test("NO row at all is `unverified`, never success", () => {
  for (const row of [null, undefined, "not an object", 42]) {
    const v = diffWrite([{ field: "city", sent: "Houston", get: (r) => r.city }], row);
    assert.equal(v.ok, false);
    assert.equal(v.unverified, true, `row ${JSON.stringify(row)} must be unverified, not not_applied`);
  }
});

test("fields we did NOT send are never checked", () => {
  // Only the fields a call actually sent may be asserted — otherwise every partial edit would report
  // every untouched field as dropped.
  const v = diffWrite([
    { field: "name", sent: undefined, get: (r) => r.name },
    { field: "city", sent: "", get: (r) => r.city },
    { field: "zip", sent: null, get: (r) => r.zip },
  ], {});
  assert.equal(v.ok, true);
  assert.deepEqual(v.not_applied, []);
});

test("a getter that throws counts as unverified for that field, not as a crash", () => {
  const v = diffWrite([{ field: "city", sent: "Houston", get: () => { throw new Error("bad shape"); } }], { any: 1 });
  assert.equal(v.ok, false);
  assert.deepEqual(v.not_applied.map((f) => f.field), ["city"]);
});

// ── Removals: the same defect wearing a different hat ────────────────────────

test("`absent` verifies a removal — still-present means the delete didn't take", () => {
  const expect = [{ field: "company_logo", get: (r) => r.company_logo, absent: true }];
  assert.equal(diffWrite(expect, { company_logo: null }).ok, true);
  assert.equal(diffWrite(expect, { company_logo: "" }).ok, true);
  const still = diffWrite(expect, { company_logo: "https://cdn/logo.png" });
  assert.equal(still.ok, false);
  assert.deepEqual(still.not_applied, [{ field: "company_logo", sent: null, stored: "https://cdn/logo.png" }]);
});

test("`absent` needs no `sent` value to be checked", () => {
  // The skip-if-nothing-sent rule must not swallow removal checks (they have nothing to send).
  const v = diffWrite([{ field: "image", get: () => ({ id: "img-1" }), absent: true }], { images: [] });
  assert.equal(v.ok, false, "an absent-check with no `sent` must still run");
});

// ── Equality helpers: a false "that didn't save" is its own bug ───────────────

test("phoneEq ignores formatting and country code", () => {
  assert.ok(phoneEq("+12145551234", "(214) 555-1234"));
  assert.ok(phoneEq("2145551234", "+1 214-555-1234"));
  assert.ok(!phoneEq("2145551234", "2145559999"));
  assert.ok(!phoneEq("", "2145551234"), "an empty side never matches");
});

test("dateEq compares the date part only", () => {
  assert.ok(dateEq("2026-08-15", "2026-08-15T00:00:00+00:00"));
  assert.ok(!dateEq("2026-08-15", "2026-08-16T00:00:00+00:00"));
  assert.ok(!dateEq("", "2026-08-15"));
});

test("hexEq is case-insensitive and shorthand-aware", () => {
  assert.ok(hexEq("#E17019", "#e17019"));
  assert.ok(hexEq("#FFF", "#ffffff"));
  assert.ok(hexEq("E17019", "#E17019"));
  assert.ok(!hexEq("#E17019", "#4EC02B"));
});

test("numberEq compares numerically, not as strings", () => {
  assert.ok(numberEq(500, "500"));
  assert.ok(numberEq("500.00", 500));
  assert.ok(!numberEq(500, 501));
});

test("bundleNameEq strips the side token the server appends", () => {
  assert.ok(bundleNameEq("QA Dup v2", "QA Dup v2 Front"));
  assert.ok(bundleNameEq("QA Dup v2", "QA Dup v2 back"));
  assert.ok(bundleNameEq("QA Dup v2", "QA Dup v2"));
  assert.ok(!bundleNameEq("QA Dup v2", "Something Else Front"));
});

test("writeNorm/writeEmpty behave as the engine assumes", () => {
  assert.equal(writeNorm("  Houston   TX "), "houston tx");
  assert.equal(writeEmpty("   "), true);
  assert.equal(writeEmpty(0), false, "0 is a real value — never treat it as missing");
  assert.equal(writeEmpty(false), false);
});

// ── The refusal envelope ─────────────────────────────────────────────────────

test("a failed verification returns a `blocked` decision with retry:false", () => {
  const verdict = diffWrite([{ field: "city", sent: "Houston", get: (r) => r.city }], {});
  const env = unappliedWrite(verdict, { tool: "update_referral", id: "ref-1", subject: "referral" });
  assert.equal(env.blocked, "write_not_applied");
  assert.equal(env.verified, false);
  assert.equal(env.retry, false, "repeating the call behaves identically — the model must not loop");
  assert.deepEqual(env.fields_not_applied, ["city"]);
  assert.match(env.plain, /didn't save/);
  assert.equal(env.id, "ref-1");
  assert.ok(!("updated" in env), "a refusal must never carry a success flag");
});

test("an unverified write says so instead of guessing", () => {
  const verdict = diffWrite([{ field: "city", sent: "Houston", get: (r) => r.city }], null);
  const env = unappliedWrite(verdict, { tool: "update_referral", id: "ref-1" });
  assert.equal(env.blocked, "write_unverified");
  assert.match(env.plain, /couldn't confirm/i);
  assert.ok(!/didn't save/.test(env.plain), "we don't know that it didn't save — only that we can't confirm it did");
});

// ── readBackAndCompare ───────────────────────────────────────────────────────

test("readBackAndCompare passes the row through on success", async () => {
  const { refusal, verdict, row } = await readBackAndCompare({
    tool: "t",
    expect: [{ field: "full_name", sent: "Ada L", get: (u) => u.full_name }],
    read: async () => ({ full_name: "Ada L", extra: 1 }),
  });
  assert.equal(refusal, null);
  assert.equal(verdict.ok, true);
  assert.deepEqual(row, { full_name: "Ada L", extra: 1 });
});

test("a read-back that THROWS is unverified — never silently successful", async () => {
  const { refusal } = await readBackAndCompare({
    tool: "t",
    expect: [{ field: "full_name", sent: "Ada L", get: (u) => u.full_name }],
    read: async () => { throw new Error("network down"); },
  });
  assert.equal(refusal.blocked, "write_unverified");
});

test("a read-back returning null is unverified", async () => {
  const { refusal } = await readBackAndCompare({
    tool: "t",
    expect: [{ field: "full_name", sent: "Ada L", get: (u) => u.full_name }],
    read: async () => null,
  });
  assert.equal(refusal.blocked, "write_unverified");
});

// ── The referral diff still behaves after moving onto the shared engine ──────
// (referral-update-shape.test.mjs covers this field-by-field; this is the seam check.)

test("diffReferralWrite still reads the flat body against the nested record", () => {
  const sent = { name: "Adler One", address: { city: "Houston" }, job_details: { value: 500 } };
  const ok = diffReferralWrite(sent, {
    home_owner_info: { name: "Adler One", address: { city: "Houston" } },
    job_details: { value: "500" },
  });
  assert.equal(ok.ok, true, "numberEq must still apply to job value");

  const dropped = diffReferralWrite(sent, { home_owner_info: { name: "Adler One" }, job_details: {} });
  assert.equal(dropped.ok, false);
  assert.deepEqual(dropped.not_applied.map((f) => f.field), ["address.city", "job_details.value"]);
});
