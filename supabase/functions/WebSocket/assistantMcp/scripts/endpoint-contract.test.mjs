// Tool → edge-function contract, checked against a CODE-DERIVED oracle (F4, 2026-08-03).
// Run with: node --test scripts/endpoint-contract.test.mjs
//
// THE BUG THIS CLASS OF TEST EXISTS FOR: `update_referral` posted a nested `home_owner_info` object.
// `updateReferralById` reads only FLAT keys, so its branch never fired — and it still answered
// 200 {status:"success"}. Five agent writes landed with zero field changes, each reported as a success.
// Nothing anywhere in the codebase would have failed. The tool's own comment even claimed it
// "mirrors updateReferralById exactly", which was false when it was written.
//
// WHY THE ORACLE IS THE EDGE FUNCTIONS' SOURCE, NOT A SPEC: a hand-maintained contract file (an
// openapi.yaml, a docs table) goes green while drifting — it is another copy of the truth, and copies
// drift. These tests read the ACTUAL handler source and check two things that cannot be faked:
//
//   1. every endpoint the MCP calls EXISTS (a typo'd name is a 404 the model can only guess at);
//   2. every body key the MCP sends is a key the handler actually READS.
//
// (2) is the check that would have caught the referral bug: `home_owner_info` appears nowhere in
// updateReferralById's source.
//
// Deliberately one-directional. It does NOT require that the MCP send every key a handler accepts —
// tools are meant to expose a subset — and it does not verify types or semantics. It answers exactly
// one question: does this key reach anything?
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const FUNCTIONS = join(HERE, "..", "..", "..");

const readSrc = (name) => readFileSync(join(SRC, name), "utf8");
const TOOL_SOURCES = ["tools-write.mjs", "tools-read.mjs", "context.mjs"];

/** Every endpoint name the MCP calls, from the callApi("<name>") literals. */
function calledEndpoints() {
  const found = new Map(); // endpoint -> the files that call it
  for (const file of TOOL_SOURCES) {
    for (const m of readSrc(file).matchAll(/callApi\("([A-Za-z0-9_]+)"/g)) {
      if (!found.has(m[1])) found.set(m[1], new Set());
      found.get(m[1]).add(file);
    }
  }
  return found;
}

/** An edge function's handler source (index.ts plus anything it shares in the same folder). */
function handlerSource(endpoint) {
  const dir = join(FUNCTIONS, endpoint);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;
  let src = "";
  for (const entry of readdirSync(dir)) {
    if (!/\.ts$/.test(entry)) continue;
    src += readFileSync(join(dir, entry), "utf8") + "\n";
  }
  return src || null;
}

const ENDPOINTS = calledEndpoints();

test("the scan found the calls (guards the guard)", () => {
  assert.ok(ENDPOINTS.size >= 40, `expected many endpoints, found ${ENDPOINTS.size}`);
  assert.ok(ENDPOINTS.has("updateReferralById"), "the parser must pick up write endpoints");
});

test("every endpoint the MCP calls exists as an edge function", () => {
  const missing = [...ENDPOINTS.keys()].filter((e) => handlerSource(e) === null);
  assert.deepEqual(missing, [],
    "these names have no supabase/functions/<name>/*.ts — a typo here is a 404 the model can only guess at");
});

// ── (2) the key check ────────────────────────────────────────────────────────
// Body keys are taken from the literal object properties in each `callApi(..., body)` argument. This
// is a syntactic scan, so it is scoped to the cases it can read correctly: a body built as an object
// literal at the call site. Bodies assembled conditionally into a `body` variable (update_referral's
// flattening, create_campaign's steps) are covered by their own dedicated suites
// (referral-update-shape.test.mjs, write-verification.test.mjs) where the shape is asserted directly.
const BODY_CALL = /callApi\(\s*"([A-Za-z0-9_]+)"\s*,\s*"[A-Z]+"\s*,\s*(?:null|\{[^}]*\})\s*,\s*[A-Za-z.]+\s*,\s*\{([^{}]*)\}\s*\)/g;

function inlineBodies() {
  const out = []; // { endpoint, keys[], file }
  for (const file of TOOL_SOURCES) {
    for (const m of readSrc(file).matchAll(BODY_CALL)) {
      const keys = [];
      for (const km of m[2].matchAll(/(?:^|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?::|,|$)/g)) keys.push(km[1]);
      if (keys.length) out.push({ endpoint: m[1], keys, file });
    }
  }
  return out;
}

const INLINE = inlineBodies();

test("the body scan found real call sites (guards the guard)", () => {
  assert.ok(INLINE.length >= 10, `expected several inline bodies, found ${INLINE.length}`);
});

/**
 * Does `src` read `key` OFF THE REQUEST PAYLOAD?
 *
 * The distinction is the whole test. A naive `\bkey\b` search is worthless here: `home_owner_info`
 * appears all over updateReferralById as the field it WRITES
 * (`updatedFields.home_owner_info.name = updateData.name`), so a mention-anywhere check would have
 * declared the original bug fine. Only reads off the parsed request body count.
 *
 * Returns "read" | "unread" | "unknown" — "unknown" when the handler doesn't parse its body in a shape
 * this scan recognises, so an unreadable handler is never silently reported as passing.
 */
function payloadRead(src, key) {
  // Every identifier that holds the parsed body. Covers all the shapes these handlers actually use:
  //   const x = await req.json()      let x; … x = await req.json()      const { a, b } = await req.json()
  // plus the rest-spread rename that updateReferralById uses: const { id, ...updateData } = body.
  const vars = new Set();
  let destructured = "";
  const declare = /(?:(?:const|let|var)\s+)?(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*await\s+req\.json\(\)/g;
  for (const m of src.matchAll(declare)) {
    if (m[1].startsWith("{")) destructured += m[1];
    else vars.add(m[1]);
  }
  // Follow renames one level, both plain and rest-spread.
  for (const v of [...vars]) {
    for (const m of src.matchAll(new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${v}\\b`, "g"))) vars.add(m[1]);
    for (const m of src.matchAll(new RegExp(`(?:const|let|var)\\s+\\{([^}]*)\\}\\s*=\\s*${v}\\b`, "g"))) {
      destructured += m[1];
      const rest = m[1].match(/\.\.\.\s*([A-Za-z_$][\w$]*)/);
      if (rest) vars.add(rest[1]);
    }
  }
  if (!vars.size && !destructured) return "unknown";

  if (destructured && new RegExp(`(?:^|[{,\\s])${key}\\s*(?:[,:}]|=)`).test(destructured)) return "read";
  for (const v of vars) {
    const reads = [
      new RegExp(`\\b${v}\\s*\\??\\.\\s*${key}\\b`),          // updateData.key
      new RegExp(`\\b${v}\\s*\\??\\[\\s*["']${key}["']\\s*\\]`), // updateData["key"]
      new RegExp(`["']${key}["']\\s*in\\s+${v}\\b`),          // "key" in updateData
      new RegExp(`\\{[^}]*\\b${key}\\b[^}]*\\}\\s*=\\s*${v}\\b`), // const { key } = updateData
    ];
    if (reads.some((re) => re.test(src))) return "read";
  }
  return "unread";
}

test("payloadRead distinguishes a READ key from one the handler merely writes", () => {
  // Self-check, because this predicate is the oracle: if it can't tell those apart, the test below is
  // decoration. `home_owner_info` is written by updateReferralById and read from nowhere — the bug.
  const src = handlerSource("updateReferralById");
  assert.equal(payloadRead(src, "name"), "read", "flat keys ARE read off the request body");
  assert.equal(payloadRead(src, "home_owner_info"), "unread",
    "the nested key is only ever WRITTEN — this is the distinction the original bug turned on");
  assert.equal(payloadRead(src, "definitely_not_a_field"), "unread");
});

test("every body key the MCP sends is READ by the endpoint it is sent to", () => {
  const orphans = [];
  let unknown = 0;
  let checked = 0;
  for (const { endpoint, keys, file } of INLINE) {
    const src = handlerSource(endpoint);
    if (!src) continue; // covered by the existence test above
    for (const key of keys) {
      const verdict = payloadRead(src, key);
      if (verdict === "unknown") { unknown += 1; continue; }
      checked += 1;
      if (verdict === "unread") orphans.push(`${file}: ${endpoint} is sent "${key}", which its handler never reads off the request body`);
    }
  }
  // Reported, not hidden: a scan that could judge nothing would otherwise pass silently.
  assert.ok(checked >= 15, `only ${checked} key(s) could be judged (${unknown} unknown) — the oracle has stopped working`);
  assert.deepEqual(orphans, [],
    "each of these keys is silently discarded by the endpoint — the exact shape of the update_referral bug, "
    + "where a nested body was dropped and the call still returned 200 success");
});

// ── The specific regression, pinned by name ──────────────────────────────────

test("updateReferralById still reads a FLAT body, so the flattening stays load-bearing", () => {
  const src = handlerSource("updateReferralById");
  assert.ok(src, "the endpoint must be readable for this test to mean anything");

  // The distinction that matters, and the one the original bug turned on: `home_owner_info` is what
  // this endpoint WRITES (`updatedFields.home_owner_info.name = updateData.name`), never what it
  // READS. So merely finding the string proves nothing — the check has to be on the INPUT side.
  assert.ok(!/updateData\??\.\s*home_owner_info\b/.test(src) && !/\bhome_owner_info\b[^=\n]*\bin\s+updateData\b/.test(src),
    "updateReferralById now accepts a nested home_owner_info — if so, flattenReferralUpdate can be "
    + "simplified; until then the flat contract is required, not a preference");

  // The flat input keys the tool sends must each be read off updateData.
  for (const key of ["name", "phone", "email", "address", "job_details"]) {
    assert.match(src, new RegExp(`updateData\\??\\.\\s*${key}\\b|["']${key}["']\\s*in\\s+updateData`),
      `updateReferralById should read updateData.${key} — update_referral sends it flat`);
  }
});

test("no tool claims to 'mirror' an endpoint in a comment", () => {
  // tools-write.mjs used to assert "mirror updateReferralById exactly" — a claim that was false when
  // written and that nothing could check. Descriptions of behaviour belong in tests, not in prose.
  for (const file of TOOL_SOURCES) {
    const src = readSrc(file);
    const claims = src.split("\n").filter((l) => /\/\/.*mirrors? \w+ exactly/i.test(l));
    assert.deepEqual(claims, [], `${file} makes an unverifiable mirroring claim`);
  }
});
