// Shared tool plumbing for the read + write registries (Tier 3.5).
// Previously asText/asError/wrap/payload/guard were copied into tools-read.mjs and
// tools-write.mjs and had already drifted (the read copy lacked the 400/422 branch, neither
// distinguished 401/409/500). One module now owns them; the two registries only differ in the
// guard's tone ("access this data" vs "do this"), picked via makeGuard(kind).
import { callApi } from "./helpers.mjs";

// A design side counts as having a QR element if its HTML references the QR image service or
// the {{qr_url}} merge token (mirrors the frontend htmlParser QR detection). Used by the
// campaign QR gate (writes) and the template detail projection (reads).
export const QR_ELEMENT_RE = /qrserver\.com|\{\{\s*qr_url\s*\}\}/i;

export const asText = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj) }] });
export const asError = (err) => ({ isError: true, content: [{ type: "text", text: `Error: ${err.message ?? err}` }] });
export const wrap = (fn, tag = "tool") => async (args) => {
  try { return asText(await fn(args)); }
  catch (e) { console.error(`${tag} error:`, e.message); return asError(e); }
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
      const msg = sanitizeUpstream(body);
      return { error: msg ? `That didn't pass validation: ${msg}.` : "That didn't pass validation — check the details and try again." };
    }
    if (res.status === 0) return { error: "I couldn't reach the app's server just now — try again in a moment." };
    // 2xx response whose body carried an error envelope (see callApi) — the request "succeeded"
    // at the HTTP layer but the app reported a failure. Without this, tools would report
    // success on a failed mutation.
    if (res.__envelope) {
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
