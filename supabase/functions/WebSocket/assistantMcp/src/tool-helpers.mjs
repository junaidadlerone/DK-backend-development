// Shared tool plumbing for the read + write registries (Tier 3.5).
// Previously asText/asError/wrap/payload/guard were copied into tools-read.mjs and
// tools-write.mjs and had already drifted (the read copy lacked the 400/422 branch, neither
// distinguished 401/409/500). One module now owns them; the two registries only differ in the
// guard's tone ("access this data" vs "do this"), picked via makeGuard(kind).
import { z } from "zod";
import { callApi } from "./helpers.mjs";

// ── Tolerant tool schemas (D7, ported from namiMcp 2026-07-31) ────────────────
// The model habitually adds a stray key to tool arguments. Zod → JSON-Schema emits
// `additionalProperties: false` for every nested object we declare (measured, not assumed:
// scripts/tolerant-schemas.test.mjs pins the emitted schema), and the consumer of that schema is
// NOT us — Flowise rebuilds a zod schema from the advertised JSON Schema on its side, where
// additionalProperties:false becomes a strict object that throws on an extra key and fails the
// WHOLE tool call before it ever reaches this service. The model then retries blind, with no idea
// which key offended.
//
// The same class of failure is already documented in-tree by a component that hit it: emit_ui
// carries a hand-written ~60-line strip-parity pass added because strict schemas "REJECTED frames
// the frontend would have rendered fine" and "the model looped retrying blind". D7 generalises the
// idea to every tool, the way namiMcp does.
//
// TWO halves, and both are needed:
//   loosenSchema   — rebuild each object as `.passthrough()`, which flips the ADVERTISED nested
//                    additionalProperties to true so nothing upstream can reject the call.
//   declaredOnly   — re-strip the accepted args against the ORIGINAL schema before the handler
//                    runs. This matters because `.passthrough()` PRESERVES unknown keys, and
//                    handlers forward sub-objects onward (e.g. `body.job_details = {...a.job_details}`
//                    in tools-write) — an unknown key reaching an edge function that rejects
//                    unknown keys would turn a working call into a 400. Advertise loose, execute
//                    exactly as strictly as before.
// Fully defensive on both sides: anything unrecognised (or that throws) is returned unchanged, so
// the worst case is behaviour identical to today — never a registration failure.
export function loosenSchema(s) {
  try {
    const def = s?._def;
    if (!def) return s;
    switch (def.typeName) {
      case "ZodObject": {
        const shape = typeof def.shape === "function" ? def.shape() : def.shape;
        const next = {};
        for (const [k, v] of Object.entries(shape)) next[k] = loosenSchema(v);
        let out = z.object(next).passthrough();
        if (def.description) out = out.describe(def.description);
        return out;
      }
      case "ZodArray": {
        let out = z.array(loosenSchema(def.type));
        if (def.minLength) out = out.min(def.minLength.value);
        if (def.maxLength) out = out.max(def.maxLength.value);
        if (def.description) out = out.describe(def.description);
        return out;
      }
      case "ZodOptional": return loosenSchema(def.innerType).optional();
      case "ZodNullable": return loosenSchema(def.innerType).nullable();
      case "ZodDefault": return loosenSchema(def.innerType).default(def.defaultValue());
      default: return s; // scalars, enums, records, unions — no strict-object problem
    }
  } catch { return s; }
}
/** Loosen every top-level field of a tool's inputSchema (a raw `{ key: ZodType }` shape). */
export function loosenInputSchema(inputSchema) {
  if (!inputSchema || typeof inputSchema !== "object") return inputSchema;
  const out = {};
  for (const [k, v] of Object.entries(inputSchema)) out[k] = loosenSchema(v);
  return out;
}
/**
 * What the registration sites actually pass to `server.registerTool`. Handing the SDK a raw
 * `{key: ZodType}` shape makes it wrap the shape in a plain `z.object()`, whose emitted schema is
 * `additionalProperties: false` at the TOP level — the likeliest place of all for the model to add a
 * stray key, and one loosenInputSchema alone cannot reach. The SDK also accepts a complete Zod
 * schema (mcp.js `getZodSchemaObject`), so we build the wrapper ourselves and mark it passthrough.
 * Measured end-to-end over InMemoryTransport in scripts/tolerant-schemas.test.mjs.
 */
export function loosenToolSchema(inputSchema) {
  if (!inputSchema || typeof inputSchema !== "object") return inputSchema;
  // Mirror the SDK's own raw-shape guard (isZodRawShapeCompat): a shape is valid when it is empty or
  // has at least one Zod-typed field. Anything else is a coding error that the SDK rejects at
  // registration with a clear message — hand it straight through so it still fails loudly here
  // rather than registering a tool with a broken field.
  const values = Object.values(inputSchema);
  if (values.length && !values.some((v) => v?._def)) return inputSchema;
  try { return z.object(loosenInputSchema(inputSchema)).passthrough(); } catch { return inputSchema; }
}
/**
 * The execute-side half of loosenToolSchema: returns `(args) => args-with-only-declared-keys`,
 * built from the ORIGINAL (un-loosened) shape. zod objects default to strip mode, so this drops
 * unknown keys at every level without ever rejecting — the exact behaviour handlers saw before D7.
 * Falls back to the args untouched if the shape can't be compiled or the parse fails, so this can
 * only ever remove keys, never fail a call.
 */
export function declaredOnly(inputSchema) {
  let strict = null;
  try { strict = z.object(inputSchema); } catch { return (a) => a; }
  return (a) => {
    try { const r = strict.safeParse(a); return r.success ? r.data : a; } catch { return a; }
  };
}

// ── Write verification (D1) ───────────────────────────────────────────────────
// THE INVARIANT: a tool may only assert a mutation it OBSERVED in post-write state.
//
// The reported bug that proves why: `update_referral` sent a nested shape, `updateReferralById`
// reads only flat keys so its branch never fired, and it still answered 200 {status:"success"} —
// which the tool relayed as `updated: true`. The referral's own history shows five agent writes with
// zero field changes, each reported as a success, so the model kept "correcting" a value that had
// never been stored. A 2xx from these endpoints means "your request parsed", never "your data
// changed"; only a re-read proves the latter.
//
// This was prototyped twice (diffReferralWrite, and the row check in update_organization) before
// being generalised here. Every write whose success the model NARRATES should read back and compare.
export const writeNorm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
export const writeEmpty = (v) => v === undefined || v === null || (typeof v === "string" && !v.trim());
/** Phone equality that ignores formatting: compare the last 10 digits (US-style local part). */
export const phoneEq = (a, b) => {
  const digits = (v) => String(v ?? "").replace(/\D/g, "");
  const da = digits(a);
  const db = digits(b);
  if (!da || !db) return false;
  return da === db || da.slice(-10) === db.slice(-10);
};
export const numberEq = (a, b) => Number(a) === Number(b);
/**
 * Hex colour equality: case-insensitive and shorthand-aware, so "#E17019" vs "#e17019" and
 * "#FFF" vs "#ffffff" are the same colour rather than a reported difference.
 */
export const hexEq = (a, b) => {
  const norm = (v) => {
    const h = String(v ?? "").trim().replace(/^#/, "").toLowerCase();
    return h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  };
  const x = norm(a);
  return !!x && x === norm(b);
};
/**
 * Date equality on the DATE PART only. A tool sends "2026-08-15" and Postgres hands back
 * "2026-08-15T00:00:00+00:00"; a plain string compare would report that as a dropped write.
 */
export const dateEq = (a, b) => {
  const day = (v) => String(v ?? "").trim().slice(0, 10);
  const x = day(a);
  const y = day(b);
  return !!x && x === y;
};

/**
 * Compare what a tool SENT against the row it read back.
 *
 * `expect` is a list of { field, sent, get(row), eq? }: the field's reportable name, the
 * CANONICALIZED value the tool actually sent (never the model's raw argument — a tool that resolves
 * "United States" to "US" must verify against "US"), and where to find it in the post-write row.
 *
 * Three outcomes, kept distinct because they call for different words to the user:
 *   unverified     — no row came back at all; we know nothing, so claim nothing
 *   not_applied    — a field we sent is EMPTY in the stored row: the write was dropped
 *   stored_differs — the field is set but to something else: usually a server canonicalization
 *                    (title-cased city, reformatted phone), so it is reported, not treated as failure
 *
 * `{ field, get, absent: true }` inverts the check for a REMOVAL: the value must now be gone. A
 * delete that reports success while the thing is still there is the same defect wearing a different
 * hat (`remove_company_logo` and `delete_referral_image` both did exactly that).
 */
export function diffWrite(expect, row) {
  const not_applied = [];
  const stored_differs = [];
  if (!row || typeof row !== "object") return { ok: false, unverified: true, not_applied, stored_differs };
  for (const e of expect ?? []) {
    if (!e) continue;
    let stored;
    try { stored = e.get(row); } catch { stored = undefined; }
    if (e.absent) {
      if (!writeEmpty(stored)) not_applied.push({ field: e.field, sent: null, stored });
      continue;
    }
    if (writeEmpty(e.sent)) continue;
    if (writeEmpty(stored)) { not_applied.push({ field: e.field, sent: e.sent, stored: stored ?? null }); continue; }
    const eq = e.eq ?? ((x, y) => writeNorm(x) === writeNorm(y));
    if (!eq(e.sent, stored)) stored_differs.push({ field: e.field, sent: e.sent, stored });
  }
  return { ok: not_applied.length === 0, not_applied, stored_differs };
}

/**
 * The refusal a failed verification returns. One shape for every write tool, so the model learns a
 * single contract: `blocked` (a decision, not transient noise) + `retry:false` + a ready-made
 * user-facing sentence, and machine keys it must never echo.
 */
export function unappliedWrite(verdict, { tool, id, plain, unverifiedPlain, subject = "change" } = {}) {
  const fields = verdict.not_applied.map((f) => f.field);
  console.error(`[${tool ?? "write"}] write not applied`,
    JSON.stringify({ id: id ?? null, unverified: !!verdict.unverified, fields }));
  return {
    blocked: verdict.unverified ? "write_unverified" : "write_not_applied",
    ...(id ? { id } : {}),
    verified: false,
    ...(fields.length ? { fields_not_applied: fields } : {}),
    retry: false,
    plain: verdict.unverified
      ? (unverifiedPlain ?? "I couldn't confirm whether that saved, so I'm not going to tell you it did.")
      : (plain ?? `That didn't save — the ${subject} still shows its previous details.`),
    note: "NOTHING was applied for the listed fields. Do NOT repeat this call — it will behave identically. Tell the user plainly that the change did not save, name what didn't save in plain words, and do NOT claim any of those fields were updated. This is a system fault, not the user's mistake.",
  };
}

/**
 * Read back and compare in one step. `read` is an async thunk returning the post-write row (or null
 * / throwing — both are treated as "unverified", never as success).
 *
 * Returns { verdict, refusal }: `refusal` is the ready-to-return envelope when verification failed,
 * and null when it passed — so a call site reads
 *     const { verdict, refusal } = await readBackAndCompare({...});
 *     if (refusal) return refusal;
 * and may still report `verdict.stored_differs` alongside its own success fields.
 */
export async function readBackAndCompare({ tool, id, expect, read, plain, unverifiedPlain, subject }) {
  let row = null;
  try { row = await read(); } catch (e) { console.error(`[${tool}] read-back failed:`, e?.message ?? e); }
  const verdict = diffWrite(expect, row);
  return {
    row,
    verdict,
    refusal: verdict.ok ? null : unappliedWrite(verdict, { tool, id, plain, unverifiedPlain, subject }),
  };
}

/**
 * Verify a DELETE. This needs its own function because readBackAndCompare has the polarity exactly
 * wrong for a deletion: there, "no row came back" means unverified, whereas for a delete a 404 is
 * the PROOF of success.
 *
 * `read` must return the RAW callApi result (not payload-extracted) so its status is visible:
 *   404              → confirmed gone
 *   2xx, no payload  → confirmed gone (some endpoints answer empty rather than 404)
 *   2xx with the row → still there: the delete did not take, so refuse to claim it did
 *   anything else    → unverified (status 0 is a transport failure; a 5xx tells us nothing)
 *
 * `stillThere(row)` overrides how "the row came back" is judged (default: any truthy object).
 */
export async function verifyGone({ tool, id, read, stillThere, plain, unverifiedPlain, subject = "item" }) {
  let res = null;
  try { res = await read(); } catch (e) { console.error(`[${tool}] delete read-back failed:`, e?.message ?? e); }
  const refuse = (blocked, plainText, note) => {
    console.error(`[${tool}] delete not verified`, JSON.stringify({ id: id ?? null, blocked, status: res?.status ?? null }));
    return { blocked, ...(id ? { id } : {}), verified: false, retry: false, plain: plainText, note };
  };
  if (res?.__error) {
    if (res.status === 404) return null;
    return refuse("delete_unverified",
      unverifiedPlain ?? `I couldn't confirm that ${subject} was deleted, so I won't tell you it was.`,
      "Do NOT repeat this call — a delete that DID go through would not be undone by repeating it. Tell the user you could not confirm it and suggest they check in the app.");
  }
  const row = payload(res);
  const present = stillThere ? stillThere(row) : !!(row && typeof row === "object" && Object.keys(row).length > 0);
  if (!present) return null;
  return refuse("delete_not_applied",
    plain ?? `That ${subject} is still there, so the delete didn't take effect.`,
    "NOTHING was deleted. Do NOT repeat this call — it will behave identically. Tell the user plainly that it was not deleted. This is a system fault, not the user's mistake.");
}

// A design side counts as having a QR element if its HTML references the QR image service or
// the {{qr_url}} merge token (mirrors the frontend htmlParser QR detection). Used by the
// campaign QR gate (writes) and the template detail projection (reads).
export const QR_ELEMENT_RE = /qrserver\.com|\{\{\s*qr_url\s*\}\}/i;

export const asText = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj) }] });
export const asError = (err) => ({ isError: true, content: [{ type: "text", text: `Error: ${err.message ?? err}` }] });

// ── D5: one structured line per tool call ──────────────────────────────────────
// Two problems with what this used to log. First, the tag was the generic "read tool" / "write tool",
// so a failing call produced `write tool error: …` with no way to tell WHICH of 30 tools failed.
// Second, only throws were logged at all: a tool that returned a `blocked` refusal or a
// `missing_required` bounce — the two most common outcomes when the agent misbehaves — left no trace,
// so the shape of a bad turn had to be reconstructed from the model's prose.
//
// NEVER logs arguments or payloads. Tool name, outcome class, duration and (for refusals) the machine
// code only: arguments carry customer PII, which is why the frame tracer is env-gated.
const outcomeOf = (out) => {
  if (!out || typeof out !== "object") return { outcome: "ok" };
  if (out.blocked) return { outcome: "blocked", code: String(out.blocked).slice(0, 60) };
  if (out.error) return { outcome: "refused" };
  if (out.missing_required) return { outcome: "missing_required", fields: out.missing_required.slice(0, 8) };
  if (out.verified === false) return { outcome: "unverified" };
  if (out.verified === true) return { outcome: "verified" };
  return { outcome: "ok" };
};
/**
 * Correlation id for the current turn, read per request from the X-DK-Turn header.
 *
 * Accepts a UUID and nothing else. That is deliberate: Flowise substitutes `{{$vars.turnId}}` in the
 * header, and if the var is absent — the flow edited before the gateway deploy, or a header added to a
 * flow whose gateway does not send it — the LITERAL "{{$vars.turnId}}" arrives instead. Logging that
 * as a turn id would be worse than logging nothing, because it looks like a real correlation.
 */
let currentTurnId = null;
const TURN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const setTurnId = (id) => { currentTurnId = (typeof id === "string" && TURN_ID_RE.test(id)) ? id : null; };
/** The accepted turn id, or null. Exported so a test can assert what was accepted. */
export const getTurnId = () => currentTurnId;
export const wrap = (fn, tag = "tool") => async (args) => {
  const startedAt = Date.now();
  const line = (fields) => console.log(JSON.stringify({ at: "mcp", event: "tool", tool: tag, turn_id: currentTurnId, ms: Date.now() - startedAt, ...fields }));
  try {
    const out = await fn(args);
    line(outcomeOf(out));
    return asText(out);
  } catch (e) {
    line({ outcome: "threw", error: String(e?.message ?? e).slice(0, 200) });
    return asError(e);
  }
};

// Edge functions wrap payloads as { status, message, data, ... } or { success, data }.
export const payload = (res) => res?.data ?? res;

// Normalize a user-supplied phone number to E.164 (bug-bash follow-up 2026-07-28). The frontend's
// normalizePhoneNumber just prepends "+" to whatever digits it's given, which mints WRONG numbers
// for anything that isn't already 11 digits starting with 1 — do not copy that behavior here.
// - Starting with "+": strip spaces/dashes/parens/dots after the +, then it must be a plausible
//   E.164 number (no leading 0 after the country code digit).
// - Otherwise: strip ALL non-digits. Exactly 10 digits is assumed US (prepend "+1"). Exactly 11
//   digits starting with "1" is US with the country code already included. Anything else fails —
//   NEVER guess a country code for an ambiguous digit string.
// Returns { ok: true, phone } in E.164, or { ok: false }.
export function normalizePhone(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { ok: false };
  if (trimmed.startsWith("+")) {
    const cleaned = "+" + trimmed.slice(1).replace(/[\s\-().]/g, "");
    return /^\+[1-9]\d{1,14}$/.test(cleaned) ? { ok: true, phone: cleaned } : { ok: false };
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) {
    // First digit must be 2-9 (no valid NANP area code starts with 0 or 1)
    return /^[2-9]/.test(digits) ? { ok: true, phone: `+1${digits}` } : { ok: false };
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    // Second digit must be 2-9 (after the leading 1, area code first digit)
    return /^1[2-9]/.test(digits) ? { ok: true, phone: `+${digits}` } : { ok: false };
  }
  return { ok: false };
}

// Make an upstream error body safe + useful for the model/user: prefer the envelope's human
// `message`, then strip anything that reads as internals — ids, URLs, SCREAMING_ERROR_CODES,
// JSON punctuation. Returns "" when nothing human survives (callers fall back to a generic
// line). NEVER interpolate a raw upstream body into user-facing text (it can carry internal
// codes, field ids, or URLs) — route it through here first.
export function sanitizeUpstream(raw) {
  let msg = String(raw ?? "");
  try {
    const j = JSON.parse(msg);
    const candidate = j?.message ?? j?.error_description ?? j?.error ?? j?.msg ?? "";
    msg = typeof candidate === "string" ? candidate : "";
  } catch { /* not JSON — sanitize the raw text */ }
  msg = msg
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, "")
    .replace(/[{}[\]"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[:,.\-\s]+|[:,\-\s]+$/g, "");
  if (msg.length < 4) return "";
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
}

// ── Structured upstream refusals (2026-07-31) ────────────────────────────────
// sanitizeUpstream above is correct for PROSE and wrong for a REFUSAL. It deletes
// SCREAMING_SNAKE codes and JSON punctuation because its output gets interpolated into a
// sentence — but in a refusal the code and the named missing fields are the only ACTIONABLE
// parts. A server-side gate answering `400 {"error":"REFERRAL_NOT_READY","missing":["zip"]}`
// therefore reached the model as "That didn't pass validation: ." — which reads as transient
// noise and invites exactly the blind retry the gate exists to stop.
//
// This returns the structure when the body carries one, so guard() can hand the model a code and
// a field list instead of an empty sentence. Machine parts are for the MODEL's reasoning only;
// the note tells it not to echo them, and the system prompt's hard rules forbid it independently.
const MACHINE_CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
// Strip only genuine leak risks (ids, URLs) — NOT codes or punctuation, which callers need.
const humanish = (s) => String(s ?? "")
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "")
  .replace(/https?:\/\/\S+/gi, "")
  .replace(/\s+/g, " ")
  .trim();
const firstStringArray = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (Array.isArray(v)) {
      const items = v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
      if (items.length) return items;
    }
  }
  return [];
};
/** `{ code?, plain?, missing_required? }` when the body is a structured refusal, else null. */
export function upstreamRefusal(raw) {
  let j;
  try { j = JSON.parse(String(raw ?? "")); } catch { return null; }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;

  let code = null;
  for (const k of ["error", "code", "error_code"]) {
    const v = j[k];
    if (typeof v === "string" && MACHINE_CODE.test(v.trim())) { code = v.trim(); break; }
  }

  let plain = null;
  for (const k of ["message", "error_description", "details", "detail", "msg"]) {
    const v = j[k];
    if (typeof v !== "string") continue;
    const t = humanish(v);
    // A message that IS just the machine code carries no extra meaning as a sentence.
    if (!t || MACHINE_CODE.test(t)) continue;
    plain = t.length > 240 ? `${t.slice(0, 240)}…` : t;
    break;
  }

  const missing_required = firstStringArray(j, ["missing_required", "missing", "missing_fields", "required"]);
  if (!code && !plain && !missing_required.length) return null;
  return { ...(code ? { code } : {}), ...(plain ? { plain } : {}), ...(missing_required.length ? { missing_required } : {}) };
}

// Translate a callApi failure envelope into a graceful, model-friendly object.
// 403s are disambiguated from the response body: DK+ uses 403 both for role gates
// ("Only ADMIN users…") and for org-membership problems (NO_ORGANIZATION).
// Tools that need a more specific line for a given status/code keep layering their own
// checks on top (they test res.status / res.body BEFORE returning the guard result).
export function makeGuard(kind /* "read" | "write" */) {
  const noPermission = kind === "read"
    ? "You don't have access to this data with your current role."
    : "You don't have permission to do this with your current role.";
  const fallback = kind === "read"
    ? "That data is unavailable right now."
    : "That action couldn't be completed right now.";
  return function guard(res) {
    if (!(res && res.__error)) return null;
    const body = String(res.body ?? "");
    if (res.status === 401) return { error: "The user's session has expired — ask them to sign in again and retry." };
    if (res.status === 403) {
      if (/ADMIN/i.test(body)) return { error: "This requires an admin role on your account." };
      if (/NO_ORGANIZATION/i.test(body)) return { error: "This account isn't associated with an organization yet." };
      return { error: noPermission };
    }
    if (res.status === 404) return { error: "Not found." };
    if (res.status === 409) return { error: "That conflicts with the current state — it may already exist or have changed since I last looked. Re-check before retrying." };
    if (res.status === 400 || res.status === 422) {
      // Prefer the structured refusal when the server sent one — a code and/or a named field list
      // is actionable, whereas the sanitized sentence for `{"error":"SOME_CODE"}` is empty.
      const refusal = upstreamRefusal(body);
      if (refusal) {
        return {
          error: refusal.plain
            ? `That didn't pass validation: ${refusal.plain}.`
            : "That didn't pass validation — see what's missing below.",
          ...refusal,
          retry: false,
          note: "The server REFUSED this — it is not a transient failure, so repeating the identical call will fail identically. Fix what it named or ask the user for it. Never show the user a code or a field name: describe what's needed in plain product language.",
        };
      }
      const msg = sanitizeUpstream(body);
      return { error: msg ? `That didn't pass validation: ${msg}.` : "That didn't pass validation — check the details and try again." };
    }
    // status 0 is a transport failure: the request may or may not have reached the server. For a READ
    // that is simply "try again". For a WRITE it is genuinely unknown, and "try again in a moment" is
    // an instruction to possibly perform the mutation twice — which for a create means a duplicate
    // (D6). Say what is actually true instead.
    if (res.status === 0) {
      return kind === "read"
        ? { error: "I couldn't reach the app's server just now — try again in a moment." }
        : {
          error: "I couldn't reach the app's server, so I don't know whether that went through.",
          retry: false,
          note: "The request may or may not have been applied. Do NOT repeat it blindly — READ the current state back first (a list or get-by-id call) and tell the user what you actually find.",
        };
    }
    // 2xx response whose body carried an error envelope (see callApi) — the request "succeeded"
    // at the HTTP layer but the app reported a failure. Without this, tools would report
    // success on a failed mutation.
    if (res.__envelope) {
      // Same reasoning as the 400/422 branch: a 200 carrying {success:false, error:"SOME_CODE"} is
      // still a refusal, and stripping the code left the model with nothing to act on.
      const refusal = upstreamRefusal(body);
      if (refusal) {
        return {
          error: refusal.plain ? `The app reported a problem with that: ${refusal.plain}.` : fallback,
          ...refusal,
          retry: false,
          note: "The app REFUSED this despite a 200 response — nothing was changed. Do not repeat the identical call. Never show the user a code or a field name.",
        };
      }
      const msg = sanitizeUpstream(body);
      return { error: msg ? `The app reported a problem with that: ${msg}.` : fallback };
    }
    if (res.status >= 500) return { error: "The app hit a server error on that one — try again in a moment." };
    return { error: fallback };
  };
}

// ── Role gating (bug-bash 2026-07-24) ─────────────────────────────────────────
// The app hides whole areas by role (menu-driven): TECHNICIAN sees no campaigns / templates /
// targeting / analytics; MARKETER sees no templates. Server-side, most edge fns check org
// MEMBERSHIP only — so without this gate the assistant happily walked a technician through
// templates and campaign creation. The authoritative signal is the PER-ORG role from getUser's
// organizations[] (matched on active_organization_id; values OWNER/ADMIN/MARKETER/TECHNICIAN) —
// NOT the global profiles.role. Fail-open on lookup failure (this mirrors the app's UX gating;
// the server's own auth still applies) but log it.
const AREA_LABEL = {
  campaigns: "campaigns",
  templates: "postcard designs (templates)",
  template_management: "managing postcard designs (templates)",
  targeting: "targeting",
  analytics: "analytics",
};
// MARKETER keeps template BROWSING (the campaign wizard shows designs to marketers — only the
// Templates management page is hidden for them), so only template_management is denied.
const ROLE_DENIED_AREAS = {
  TECHNICIAN: new Set(["campaigns", "templates", "template_management", "targeting", "analytics"]),
  MARKETER: new Set(["template_management"]),
};
const roleCache = new Map(); // userJwt -> { role, expiresAt }
export async function activeOrgRole(userJwt) {
  const hit = roleCache.get(userJwt);
  if (hit && hit.expiresAt > Date.now()) return hit.role;
  let role = null;
  try {
    const res = await callApi("getUser", "GET", null, userJwt);
    if (res && !res.__error) {
      const u = payload(res);
      const orgs = Array.isArray(u?.organizations) ? u.organizations : [];
      const active = orgs.find((o) => o?.id === u?.active_organization_id);
      role = (active?.role ?? u?.role ?? null)?.toUpperCase?.() ?? null;
    }
  } catch (e) {
    console.warn("[role-gate] getUser lookup failed (failing open):", e.message);
  }
  roleCache.set(userJwt, { role, expiresAt: Date.now() + 60_000 });
  if (roleCache.size > 5000) roleCache.clear();
  return role;
}
/** Null when allowed; a friendly {error} when the caller's role lacks the area. */
export async function roleAreaDenial(userJwt, area) {
  if (!area) return null;
  const role = await activeOrgRole(userJwt);
  if (!role || !ROLE_DENIED_AREAS[role]?.has(area)) return null;
  const roleName = role.charAt(0) + role.slice(1).toLowerCase();
  const whoCanHelp = area === "template_management"
    ? "An admin or the owner can help with this."
    : "An admin, marketer, or the owner can help with this.";
  return {
    error: `Your role in this organization (${roleName}) doesn't include ${AREA_LABEL[area] ?? area}. ${whoCanHelp}`,
    role_restricted: true,
  };
}
