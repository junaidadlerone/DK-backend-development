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
import { IDEMPOTENCY_TTL_MS, __resetIdempotency, createOnce, idempotencyKey, setIdempotencyStore, stableStringify } from "../src/idempotency.mjs";
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

// ── The durable layer (2026-08-04) ───────────────────────────────────────────
// The in-memory window failed in production exactly as its own caveat predicted: two campaigns from
// identical arguments, minutes apart in one conversation, both from a "proceed" approval. 120 seconds
// cannot span a user pausing to look at what they just made, and the record did not survive an instance
// change either — this service is stateless per request.
//
// The store is INJECTED so these tests exercise the real logic against a fake: an idempotency guard
// whose tests need a database is a guard that goes untested.

/** A fake store with the same contract as supabaseIdempotencyStore, plus failure injection. */
function fakeStore({ failRead = false, failWrite = false } = {}) {
  const rows = new Map(); // key -> { result, at }
  return {
    rows,
    reads: 0,
    writes: 0,
    async read(key, ttlMs, nowMs) {
      this.reads += 1;
      if (failRead) throw new Error("store unavailable");
      const row = rows.get(key);
      if (!row) return null;
      return nowMs - row.at > ttlMs ? null : row.result;
    },
    async write(key, { result }) {
      this.writes += 1;
      if (failWrite) throw new Error("store unavailable");
      rows.set(key, { result, at: Date.now() });
    },
  };
}

test("THE REPORTED CASE: a repeat on a FRESH instance is still suppressed", async () => {
  // Two campaigns were created from identical args. Simulate it exactly: the first create records
  // durably, then process memory is wiped (a new instance, or a restart) and the same call arrives.
  const store = fakeStore();
  setIdempotencyStore(store);
  let runs = 0;
  const fn = async () => { runs += 1; return { campaign_id: `camp-${runs}` }; };
  const call = { userId: "u1", tool: "create_campaign", args: { campaign_name: "Location Zone", target_type: "location_zone" }, fn };

  const first = await createOnce(call);
  assert.equal(first.campaign_id, "camp-1");

  __resetIdempotency();           // the instance change: memory gone, DB intact
  setIdempotencyStore(store);

  const second = await createOnce(call);
  assert.equal(runs, 1, "the second create must NOT have run — this is the production bug");
  assert.equal(second.campaign_id, "camp-1", "and it must answer with the SAME campaign");
});

test("the durable window is long enough to span a user looking at their work", () => {
  // The old 120s window is what let this through; the key is the exact arguments, so hours are safe.
  assert.ok(IDEMPOTENCY_TTL_MS >= 60 * 60 * 1000, `window is ${IDEMPOTENCY_TTL_MS}ms — too short to help`);
});

test("a durable record older than the window does not suppress", async () => {
  const store = fakeStore();
  setIdempotencyStore(store);
  let runs = 0;
  const fn = async () => { runs += 1; return { id: `r-${runs}` }; };
  const call = { userId: "u1", tool: "create_referral", args: { name: "Adler" }, fn, ttlMs: 1000 };
  await createOnce(call);
  for (const [k, v] of store.rows) store.rows.set(k, { ...v, at: v.at - 5000 }); // age it past the window
  __resetIdempotency();
  setIdempotencyStore(store);
  const again = await createOnce(call);
  assert.equal(runs, 2, "beyond the window a repeat is a legitimate new create");
  assert.equal(again.id, "r-2");
});

test("a FAILED create is not recorded durably", async () => {
  const store = fakeStore();
  setIdempotencyStore(store);
  let runs = 0;
  const fn = async () => { runs += 1; return runs === 1 ? { error: "upstream exploded" } : { id: "r-1" }; };
  const call = { userId: "u1", tool: "create_referral", args: { name: "Adler" }, fn };
  await createOnce(call);
  assert.equal(store.rows.size, 0, "retrying something that did not work is a legitimate retry");
  __resetIdempotency();
  setIdempotencyStore(store);
  assert.equal((await createOnce(call)).id, "r-1");
});

test("a store OUTAGE never blocks a create", async () => {
  // The guard degrading is acceptable; a create failing because bookkeeping failed is not.
  for (const failure of [{ failRead: true }, { failWrite: true }]) {
    __resetIdempotency();
    setIdempotencyStore(fakeStore(failure));
    let runs = 0;
    const out = await createOnce({
      userId: "u1", tool: "create_campaign", args: { a: 1 },
      fn: async () => { runs += 1; return { campaign_id: "c1" }; },
    });
    assert.equal(runs, 1, JSON.stringify(failure));
    assert.equal(out.campaign_id, "c1", `a create must still succeed when the store is down (${JSON.stringify(failure)})`);
  }
});

test("the record is written BEFORE the caller can act on the result", async () => {
  // If the write were fire-and-forget, a fast repeat could read an empty store and create a second
  // entity — the exact race this layer exists to close.
  const store = fakeStore();
  setIdempotencyStore(store);
  await createOnce({ userId: "u1", tool: "create_campaign", args: { a: 1 }, fn: async () => ({ campaign_id: "c1" }) });
  assert.equal(store.rows.size, 1, "the durable record must exist by the time createOnce resolves");
});

test("with no store configured, the in-memory behaviour is unchanged", async () => {
  __resetIdempotency(); // leaves store null
  let runs = 0;
  const fn = async () => { runs += 1; return { id: `r-${runs}` }; };
  const call = { userId: "u1", tool: "create_referral", args: { name: "Adler" }, fn };
  await createOnce(call);
  await createOnce(call);
  assert.equal(runs, 1, "memory still suppresses within the process");
});

test("a durable hit is cached in memory, so a third call needs no round trip", async () => {
  const store = fakeStore();
  setIdempotencyStore(store);
  const call = { userId: "u1", tool: "create_referral", args: { name: "Adler" }, fn: async () => ({ id: "r-1" }) };
  await createOnce(call);
  __resetIdempotency();
  setIdempotencyStore(store);
  await createOnce(call);
  const readsAfterDurableHit = store.reads;
  await createOnce(call);
  assert.equal(store.reads, readsAfterDurableHit, "the second repeat should be served from memory");
});
