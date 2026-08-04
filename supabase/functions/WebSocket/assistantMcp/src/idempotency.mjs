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
// TWO LAYERS, because the first one was not enough (2026-08-04). Originally this was process memory
// with a 120-second window, and it failed in production exactly as its own caveat predicted: two
// campaigns created from identical arguments, minutes apart in one conversation. A repeat can arrive
// after the user has paused to look at what they made, and on a different instance — this service is
// stateless per request by design. So a DB-backed record now sits in front of the in-memory one:
//   durable  — catches the repeat whenever and wherever it lands (see supabaseIdempotencyStore)
//   memory   — still joins a genuinely CONCURRENT duplicate on this instance, which the DB cannot,
//              and saves a round trip on the common path
//
// WHAT THIS IS STILL NOT: a distributed transaction. Two truly simultaneous creates on two instances
// can both miss the record and both proceed. Closing that needs an insert-to-claim protocol, which is
// not built — the reported failure is sequential, and a claim protocol can refuse a create when the
// claim write fails, trading a rare duplicate for a routine outage. Recorded honestly rather than
// papered over. Deliberately NOT implemented either: "refuse anything similar in the last 60s", which
// trades a duplicate for the worse bug of refusing a genuine second referral for the same homeowner.
import { createHash } from "node:crypto";

/**
 * How long a successful create suppresses an identical repeat.
 *
 * Was 120 s, in memory only. Reported live: two campaigns from identical arguments, minutes apart, in
 * one conversation — the window could not span a user pausing to look at what they had just made, and
 * the record did not survive an instance change either.
 *
 * Hours rather than seconds is safe BECAUSE the key is the exact canonicalized arguments. Two creates
 * agreeing on every field are a repeat, not a second thing someone wants: nobody deliberately makes two
 * campaigns with the same name, template, disclaimer and QR link. And if they genuinely do want another,
 * changing anything — a different name — is a different key, which is a better conversation than
 * silently creating two.
 */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 2000;

const inflight = new Map(); // key -> Promise<result>
const recent = new Map();   // key -> { result, expiresAt }

/**
 * The durable layer. In-memory alone cannot work here: the MCP is stateless per request by design, so a
 * repeat can easily land on a different instance from the original.
 *
 * Injected rather than imported so the tests exercise the real logic against a fake store — an
 * idempotency guard whose tests need a database is a guard that goes untested.
 *
 * `null` disables it, and everything degrades to the in-memory behaviour. That is deliberate: a store
 * outage must not stop creates from working, it just narrows the window it can catch.
 */
let store = null;
export function setIdempotencyStore(s) { store = s; }

/**
 * Supabase-backed store. `read` returns the recorded result or null; `write` is BEST-EFFORT — a failure
 * to record leaves the guard weaker for that call, which is far better than failing a create that
 * already succeeded upstream.
 */
export function supabaseIdempotencyStore(client, { table = "assistant_idempotency" } = {}) {
  return {
    async read(key, ttlMs, nowMs) {
      const { data, error } = await client.from(table)
        .select("result, created_at").eq("key", key).maybeSingle();
      if (error || !data) return null;
      const age = nowMs - new Date(data.created_at).getTime();
      if (!Number.isFinite(age) || age > ttlMs) return null;
      return data.result ?? null;
    },
    async write(key, { userId, tool, result }) {
      // onConflict ignore: whoever recorded it first wins, and the loser's caller has the same result.
      const { error } = await client.from(table)
        .upsert({ key, user_id: userId, tool, result }, { onConflict: "key", ignoreDuplicates: true });
      if (error) console.warn(`[idempotency] could not record ${tool}:`, error.message);
    },
  };
}

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

  // The durable check comes before the in-flight one because it is the case memory cannot cover: the
  // repeat arriving on a different instance, or after this one restarted. A read failure is treated as
  // "no record" — never as a reason to refuse a create.
  if (store) {
    let recorded = null;
    try { recorded = await store.read(key, ttlMs, t); }
    catch (e) { console.warn(`[idempotency] store read failed for ${tool}:`, e?.message ?? e); }
    if (recorded) {
      console.log(JSON.stringify({ at: "mcp", event: "idempotent_duplicate", tool, phase: "durable" }));
      recent.set(key, { result: recorded, expiresAt: t + ttlMs }); // save the next read
      return onDuplicate ? onDuplicate(recorded) : recorded;
    }
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
    if (ok) {
      recent.set(key, { result, expiresAt: now() + ttlMs });
      if (store) {
        // Awaited, so the record exists before the caller can act on the result and a fast repeat cannot
        // race past it. Best-effort inside: a write failure warns and does not fail the create.
        try { await store.write(key, { userId, tool, result }); }
        catch (e) { console.warn(`[idempotency] store write failed for ${tool}:`, e?.message ?? e); }
      }
    }
    return result;
  } finally {
    inflight.delete(key);
  }
}

/** Test seam — the maps are module state, so a suite must be able to start clean. */
export function __resetIdempotency() {
  inflight.clear();
  recent.clear();
  store = null;
}
