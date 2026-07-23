// Shared tool plumbing for the read + write registries (Tier 3.5).
// Previously asText/asError/wrap/payload/guard were copied into tools-read.mjs and
// tools-write.mjs and had already drifted (the read copy lacked the 400/422 branch, neither
// distinguished 401/409/500). One module now owns them; the two registries only differ in the
// guard's tone ("access this data" vs "do this"), picked via makeGuard(kind).

export const asText = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj) }] });
export const asError = (err) => ({ isError: true, content: [{ type: "text", text: `Error: ${err.message ?? err}` }] });
export const wrap = (fn, tag = "tool") => async (args) => {
  try { return asText(await fn(args)); }
  catch (e) { console.error(`${tag} error:`, e.message); return asError(e); }
};

// Edge functions wrap payloads as { status, message, data, ... } or { success, data }.
export const payload = (res) => res?.data ?? res;

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
