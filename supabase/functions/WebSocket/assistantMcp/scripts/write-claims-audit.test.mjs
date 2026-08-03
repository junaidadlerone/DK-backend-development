// Standing guard: no write tool may claim success it did not observe (D1, 2026-07-31).
// Run with: node --test scripts/write-claims-audit.test.mjs
//
// The class-1 defect — "a tool asserts a mutation it never observed" — cannot be caught by testing
// each tool, because the failure is the ABSENCE of a check. So this reads the registry's SOURCE and
// requires that every tool returning a success flag also carries verification, with an explicit,
// reasoned exemption list for the ones that legitimately cannot.
//
// This is deliberately a source scan rather than a runtime assertion: the point is that adding a new
// write tool with a bare `updated: true` FAILS, forcing the author to either verify it or write down
// why it can't be verified. That is the artifact the whole effort was missing — every earlier fix of
// this class regressed because nothing failed when it did.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "src", "tools-write.mjs"), "utf8");

/** Split the registry into one source block per tool, keyed by name. */
function toolBlocks(src) {
  const blocks = new Map();
  const parts = src.split(/\n  t\("/).slice(1);
  for (const part of parts) {
    const name = part.slice(0, part.indexOf('"'));
    blocks.set(name, part);
  }
  return blocks;
}

const SUCCESS_FLAG = /\b(?:updated|created|deleted|removed|shared|unshared|revoked|invited|switched|saved): true/;
/** Any of the three verification mechanisms in tool-helpers, or a same-request identity check. */
const VERIFIES = /readBackAndCompare|diffWrite|diffReferralWrite|verifyGone/;

const blocks = toolBlocks(SRC);

/**
 * Tools that return a success flag WITHOUT reading back, each with the reason. Every entry is a
 * deliberate decision, not a backlog: if a tool here gains a read path, verify it and delete the row.
 */
const EXEMPT = {
  // The endpoint returns explicit per-organisation outcomes (AS3 made it report real results rather
  // than membership-before-the-write), and the tool reports those counts. That IS an observation of
  // what happened — there is no single row to re-read.
  revoke_user_access: "endpoint reports per-org outcomes; tool relays them and refuses on partial",
};

test("the source scan actually found the registry (guards the guard)", () => {
  assert.ok(blocks.size >= 25, `expected many write tools, parsed ${blocks.size}`);
  assert.ok(blocks.has("update_referral"), "the parser must key blocks by tool name");
});

test("every write tool claiming success either verifies it or is exempted with a reason", () => {
  const offenders = [];
  for (const [name, body] of blocks) {
    if (!SUCCESS_FLAG.test(body)) continue;      // no success claim → nothing to verify
    if (VERIFIES.test(body)) continue;           // reads back
    if (EXEMPT[name]) continue;
    offenders.push(name);
  }
  assert.deepEqual(offenders, [],
    "these return a success flag on the strength of a 2xx alone. Read back with readBackAndCompare "
    + "(writes), verifyGone (deletes), or diffWrite (when the endpoint returns the saved row) — or add "
    + "an entry to EXEMPT explaining why the mutation cannot be observed.");
});

test("the exemption list has no stale entries", () => {
  // An entry earns its place only while the tool exists, makes SOME success claim (a success flag or
  // a bare `verified: true`), and still has no read-back.
  const stale = Object.keys(EXEMPT).filter((name) => {
    const body = blocks.get(name);
    if (!body) return true;
    if (VERIFIES.test(body)) return true;
    return !SUCCESS_FLAG.test(body) && !/verified: true/.test(body);
  });
  assert.deepEqual(stale, [], "remove these — the tool now verifies, no longer claims success, or is gone");
});

test("a verified tool reports `verified: true`, so the model can tell the difference", () => {
  // The model's contract is the reply shape: `verified: true` is what tells it the claim is safe to
  // repeat to the user. A tool that reads back but never says so leaves the model guessing again.
  const missing = [];
  for (const [name, body] of blocks) {
    if (!VERIFIES.test(body)) continue;
    // Tools whose verification only produces a REFUSAL (gates before the write) don't report a
    // verified flag; require the flag only where a success flag is also returned.
    if (!SUCCESS_FLAG.test(body)) continue;
    if (!/verified: true/.test(body)) missing.push(name);
  }
  assert.deepEqual(missing, [], "add `verified: true` to the success return of these tools");
});

test("no tool reports `verified: true` without a verification mechanism", () => {
  // The inverse, and the more dangerous direction: update_branding_theme used to claim
  // `verified: true` while echoing its own arguments back.
  const lying = [];
  for (const [name, body] of blocks) {
    if (!/verified: true/.test(body)) continue;
    if (VERIFIES.test(body)) continue;
    if (EXEMPT[name]) continue;
    lying.push(name);
  }
  assert.deepEqual(lying, [], "`verified: true` must be backed by a read-back, not by a 2xx");
});
