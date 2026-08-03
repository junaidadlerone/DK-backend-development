// Create-once (D6, 2026-08-03).
// Run with: node --test scripts/idempotency.test.mjs
//
// WHY ONLY CREATES: an update applied twice is the same update; a create applied twice is two
// referrals. And the agent has several independent reasons to repeat one — the gateway's error retry
// re-runs a turn, an upstream timeout leaves the tool unsure whether the write landed, and the model
// re-calls a tool when a reply looks incomplete.
//
// The behaviour that matters most in these tests is what does NOT get suppressed. A window that
// swallows a legitimate second create, or that caches a failure and refuses the retry, is worse than
// the duplicate it prevents.
import test from "node:test";
import assert from "node:assert/strict";
import { __resetIdempotency, createOnce, idempotencyKey, stableStringify } from "../src/idempotency.mjs";
import { makeGuard } from "../src/tool-helpers.mjs";

test.beforeEach(() => __resetIdempotency());

const call = (overrides = {}) => ({
  userId: "user-1",
  tool: "create_referral",
  args: { home_owner_info: { name: "Adler One" } },
  ...overrides,
});

// ── Keying ───────────────────────────────────────────────────────────────────

test("stableStringify is key-order independent", () => {
  assert.equal(stableStringify({ a: 1, b: { c: 2, d: 3 } }), stableStringify({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(stableStringify({ a: 1 }), stableStringify({ a: 2 }));
  assert.equal(stableStringify([1, { b: 2, a: 1 }]), '[1,{"a":1,"b":2}]');
});

test("stableStringify ignores undefined values, which JSON drops anyway", () => {
  assert.equal(stableStringify({ a: 1, b: undefined }), stableStringify({ a: 1 }));
});

test("the key is stable across argument order and cosmetic string differences", () => {
  // The model does not emit arguments in a stable order or with stable whitespace/casing; a key that
  // depended on either would suppress nothing.
  const a = idempotencyKey("u1", "create_referral", { name: "Adler One", city: "Houston" });
  const b = idempotencyKey("u1", "create_referral", { city: " houston ", name: "adler  one" });
  assert.equal(a, b);
});

test("the key separates users, tools and genuinely different arguments", () => {
  const base = idempotencyKey("u1", "create_referral", { name: "Adler One" });
  assert.notEqual(base, idempotencyKey("u2", "create_referral", { name: "Adler One" }), "per user");
  assert.notEqual(base, idempotencyKey("u1", "create_campaign", { name: "Adler One" }), "per tool");
  assert.notEqual(base, idempotencyKey("u1", "create_referral", { name: "Adler Two" }), "per arguments");
});

// ── Suppression ──────────────────────────────────────────────────────────────

test("an identical repeat does not run the create a second time", async () => {
  let runs = 0;
  const fn = async () => { runs += 1; return { id: "ref-1", status: "Draft", note: "Created as a draft." }; };
  const first = await createOnce({ ...call(), fn });
  const second = await createOnce({ ...call(), fn });
  assert.equal(runs, 1, "the upstream create must have run exactly once");
  assert.equal(second.id, first.id, "the repeat resolves to the SAME referral");
});

test("the repeat is DISTINGUISHABLE, so the model can't announce a second creation", async () => {
  const fn = async () => ({ id: "ref-1", note: "Created as a draft." });
  await createOnce({ ...call(), fn, onDuplicate: (r) => ({ ...r, duplicate_suppressed: true, note: "ALREADY created." }) });
  const second = await createOnce({ ...call(), fn, onDuplicate: (r) => ({ ...r, duplicate_suppressed: true, note: "ALREADY created." }) });
  assert.equal(second.duplicate_suppressed, true);
  assert.match(second.note, /ALREADY/);
});

test("two CONCURRENT identical creates make exactly one upstream request", async () => {
  // The realistic race: the gateway's retry fires while the first attempt is still in flight.
  let runs = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const fn = async () => { runs += 1; await gate; return { id: "ref-1" }; };
  const both = Promise.all([createOnce({ ...call(), fn }), createOnce({ ...call(), fn })]);
  release();
  const [a, b] = await both;
  assert.equal(runs, 1, "the second caller must join the first's promise, not start its own create");
  assert.equal(a.id, b.id);
});

// ── What must NOT be suppressed ──────────────────────────────────────────────

test("a FAILED create stays retryable", async () => {
  let runs = 0;
  const fn = async () => { runs += 1; return runs === 1 ? { error: "upstream exploded" } : { id: "ref-1" }; };
  const first = await createOnce({ ...call(), fn });
  assert.ok(first.error);
  const second = await createOnce({ ...call(), fn });
  assert.equal(second.id, "ref-1", "retrying something that did not work is a legitimate retry");
  assert.equal(runs, 2);
});

test("a BLOCKED create stays retryable", async () => {
  // e.g. referral_not_ready — the user then completes consent and asks again.
  let runs = 0;
  const fn = async () => { runs += 1; return runs === 1 ? { blocked: "referral_not_ready" } : { campaign_id: "camp-1" }; };
  await createOnce({ ...call({ tool: "create_campaign" }), fn });
  const second = await createOnce({ ...call({ tool: "create_campaign" }), fn });
  assert.equal(second.campaign_id, "camp-1");
  assert.equal(runs, 2);
});

test("a genuinely different create is never suppressed", async () => {
  let runs = 0;
  const fn = async () => { runs += 1; return { id: `ref-${runs}` }; };
  await createOnce({ ...call(), fn });
  const other = await createOnce({ ...call({ args: { home_owner_info: { name: "Bea Two" } } }), fn });
  assert.equal(runs, 2, "a different referrer is a different referral");
  assert.equal(other.id, "ref-2");
});

test("the same request AFTER the window is a new create", async () => {
  // A second referral for the same homeowner an hour later is legitimate — the window is a
  // duplicate-suppression window, not a uniqueness constraint.
  let runs = 0;
  let clock = 1_000;
  const fn = async () => { runs += 1; return { id: `ref-${runs}` }; };
  const opts = { ...call(), fn, ttlMs: 1000, now: () => clock };
  await createOnce(opts);
  clock += 5000;
  const later = await createOnce(opts);
  assert.equal(runs, 2);
  assert.equal(later.id, "ref-2");
});

test("a throwing create does not poison the key", async () => {
  let runs = 0;
  const fn = async () => { runs += 1; if (runs === 1) throw new Error("boom"); return { id: "ref-1" }; };
  await assert.rejects(() => createOnce({ ...call(), fn }), /boom/);
  const second = await createOnce({ ...call(), fn });
  assert.equal(second.id, "ref-1", "an in-flight entry must be cleared even when the call throws");
});

// ── The unknown-outcome message ──────────────────────────────────────────────

test("an unreachable server tells a WRITE not to blindly repeat", () => {
  const g = makeGuard("write")({ __error: true, status: 0, body: "socket hang up" });
  assert.match(g.error, /don't know whether that went through/i);
  assert.equal(g.retry, false);
  assert.match(g.note, /READ the current state back/i);
});

test("…while a READ is simply retryable", () => {
  const g = makeGuard("read")({ __error: true, status: 0, body: "socket hang up" });
  assert.match(g.error, /try again in a moment/i);
  assert.equal(g.retry, undefined, "a read has no side effect to be unsure about");
});
