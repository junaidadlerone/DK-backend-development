// Create-once (D6, 2026-08-03).
//
// THE PROBLEM. A create is the one mutation whose failure mode is unbounded: an update applied twice
// is the same update, but a create applied twice is two referrals. And the agent has several reasons
// to repeat one — the gateway's error retry re-runs a turn, an upstream timeout leaves the tool
// unsure whether the write landed, and the model itself re-calls a tool when a reply looks
// incomplete. Nothing stopped any of that from minting a duplicate.
//
// THE FIX. A key derived from (user, tool, canonicalized arguments): the same user asking for the
// same thing twice in quick succession is one creation, not two.
//   * a call already IN FLIGHT is joined, not duplicated — the second caller awaits the first's
//     promise, so two concurrent identical creates make exactly one upstream request;
//   * a call that already SUCCEEDED inside the window returns the first result, annotated so the
//     model narrates "that already exists" instead of "created" a second time.
// Failures are deliberately NOT recorded: retrying something that did not work is a legitimate
// retry, and suppressing it would strand the user.
//
// WHAT THIS IS NOT. It is per-process, so it does not survive a restart and does not coordinate
// across instances (the MCP runs pinned to one instance; jobs.mjs carries the same caveat and its own
// DB fallback). It is a duplicate-suppression window, not a distributed transaction — which is why
// the window is short and the key is exact. Deliberately NOT implemented: "refuse anything similar in
// the last 60s", which trades a duplicate for the worse bug of refusing a genuine second referral for
// the same homeowner.
import { createHash } from "node:crypto";

/** How long a successful create suppresses an identical repeat. */
export const IDEMPOTENCY_TTL_MS = 120_000;
const MAX_ENTRIES = 2000;

const inflight = new Map(); // key -> Promise<result>
const recent = new Map();   // key -> { result, expiresAt }

/**
 * Stable JSON: object keys sorted at every depth, so `{a:1,b:2}` and `{b:2,a:1}` hash the same. The
 * model does not emit its arguments in a stable order, and a key that depended on that order would
 * suppress nothing.
 */
export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/** Normalize a value for keying: trim and case-fold strings so "Adler One" and "adler one " match. */
function canonical(value) {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim().toLowerCase();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) {
      if (value[k] === undefined) continue;
      out[k] = canonical(value[k]);
    }
    return out;
  }
  return value ?? null;
}

export function idempotencyKey(userId, tool, args) {
  return createHash("sha256")
    .update(`${userId ?? "anon"}|${tool}|${stableStringify(canonical(args))}`)
    .digest("hex");
}

function prune(now) {
  for (const [k, v] of recent) if (v.expiresAt <= now) recent.delete(k);
  if (recent.size > MAX_ENTRIES) {
    // Oldest-first: Map preserves insertion order, and entries are inserted on completion.
    const excess = recent.size - MAX_ENTRIES;
    let i = 0;
    for (const k of recent.keys()) { if (i++ >= excess) break; recent.delete(k); }
  }
}

/**
 * Run `fn` unless an identical call is in flight or recently succeeded.
 *
 * `isSuccess(result)` decides what counts as "created" — default: a result with no `error` and no
 * `blocked`. `onDuplicate(result)` shapes what the repeat caller gets back, and MUST make the repeat
 * distinguishable: returning the original verbatim is how the model ends up announcing a second
 * creation that never happened.
 */
export async function createOnce({ userId, tool, args, fn, isSuccess, onDuplicate, ttlMs = IDEMPOTENCY_TTL_MS, now = () => Date.now() }) {
  const key = idempotencyKey(userId, tool, args);
  const t = now();
  prune(t);

  const hit = recent.get(key);
  if (hit && hit.expiresAt > t) {
    console.log(JSON.stringify({ at: "mcp", event: "idempotent_duplicate", tool, phase: "recent" }));
    return onDuplicate ? onDuplicate(hit.result) : hit.result;
  }

  const running = inflight.get(key);
  if (running) {
    console.log(JSON.stringify({ at: "mcp", event: "idempotent_duplicate", tool, phase: "inflight" }));
    const result = await running;
    return onDuplicate ? onDuplicate(result) : result;
  }

  const promise = (async () => fn())();
  inflight.set(key, promise);
  try {
    const result = await promise;
    const ok = isSuccess ? isSuccess(result) : !!(result && typeof result === "object" && !result.error && !result.blocked);
    // Only a SUCCESS is remembered. A failed create must stay retryable.
    if (ok) recent.set(key, { result, expiresAt: now() + ttlMs });
    return result;
  } finally {
    inflight.delete(key);
  }
}

/** Test seam — the maps are module state, so a suite must be able to start clean. */
export function __resetIdempotency() {
  inflight.clear();
  recent.clear();
}
