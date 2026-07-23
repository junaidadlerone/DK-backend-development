import { createRemoteJWKSet, jwtVerify } from "jose";
import { adminSupabase } from "./supabase.mjs";
import { SUPABASE_URL } from "./env.mjs";

// Per-request bearer auth. The token is the END USER's Supabase JWT (threaded
// frontend → dk-assistant-chat gateway → Flowise vars.userJwt → MCP config
// Authorization header). Returns { userId, userJwt } or null.
//
// This is the REAL authentication gate in front of DK+ edge functions (many run
// verify_jwt=false + unsigned decode). Never forward a token we haven't validated.
//
// Verification is LOCAL. Supabase issues asymmetric (ES256) access tokens and
// publishes its public keys at /auth/v1/.well-known/jwks.json; jose fetches that
// key set once, caches it in-process (auto-refreshing on rotation), and verifies
// each token's signature + expiry + issuer with zero per-request network I/O.
//
// This replaced a per-call `adminSupabase.auth.getUser(token)`, a network round
// trip to Supabase Auth (GoTrue) on every cache miss. Under multi-tool load with
// cold/multiple Cloud Run instances (per-instance cache), those calls intermittently
// rate-limited/failed, and any failure surfaced as a spurious `-32001 Unauthorized`
// that killed the whole turn. Local verification removes that dependency entirely.
//
// getUser is kept ONLY as a fallback for the rare case where the JWKS endpoint
// itself is unreachable (e.g. cold start + a transient network blip) — so a brief
// key-set outage degrades to the old behaviour instead of rejecting valid tokens.
// A genuine signature/expiry failure is NEVER retried against getUser.

const JWKS = createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
const ISSUER = `${SUPABASE_URL}/auth/v1`;

// Cheap in-process cache so a burst of tool calls in one turn skips re-verification.
const cache = new Map(); // token -> { userId, expiresAt }
const CACHE_TTL_MS = 60_000;

// jose error codes that mean "couldn't reach/read the key set" (infrastructure),
// as opposed to "the token is invalid" (a real rejection we must honour).
function isKeySetOutage(err) {
  const code = err?.code ?? "";
  if (code === "ERR_JWKS_NO_MATCHING_KEY" || code === "ERR_JWKS_TIMEOUT" || code === "ERR_JWKS_MULTIPLE_MATCHING_KEYS") return true;
  // createRemoteJWKSet surfaces fetch failures as a generic JOSEError; match by message.
  return /fetch failed|jwks|failed to fetch|network|ENOTFOUND|ECONNRESET|timed out/i.test(err?.message ?? "");
}

// Best-effort read of a JWT's exp claim (UNVERIFIED — used only to bound the cache window,
// never to grant access; verification happened before anything is cached).
function tokenExpMs(token) {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof claims.exp === "number" ? claims.exp * 1000 : null;
  } catch { return null; }
}

export async function authenticate(req) {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const hit = cache.get(token);
  if (hit && hit.expiresAt > Date.now()) {
    return { userId: hit.userId, userJwt: token };
  }

  let userId = null;
  try {
    const { payload } = await jwtVerify(token, JWKS, { algorithms: ["ES256"], issuer: ISSUER });
    userId = typeof payload.sub === "string" ? payload.sub : null;
  } catch (err) {
    if (!isKeySetOutage(err)) return null; // real signature/expiry failure — reject
    // Key set unreachable: fall back to the auth server this one time.
    try {
      const { data, error } = await adminSupabase.auth.getUser(token);
      if (error || !data?.user) return null;
      userId = data.user.id;
    } catch {
      return null;
    }
  }

  if (!userId) return null;
  // Cache until the TTL or the token's own expiry, whichever comes first — a fixed TTL alone
  // would keep accepting a token for up to a minute past its exp.
  const exp = tokenExpMs(token);
  const expiresAt = exp ? Math.min(exp, Date.now() + CACHE_TTL_MS) : Date.now() + CACHE_TTL_MS;
  if (expiresAt > Date.now()) cache.set(token, { userId, expiresAt });
  if (cache.size > 5000) cache.clear(); // crude bound; tokens rotate anyway
  return { userId, userJwt: token };
}

// Express middleware wrapper
export function requireAuth(handler) {
  return async (req, res) => {
    const auth = await authenticate(req);
    if (!auth) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.auth = auth;
    return handler(req, res);
  };
}
