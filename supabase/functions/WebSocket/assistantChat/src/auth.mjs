// Per-request bearer auth for the gateway — LOCAL JWKS verification (Tier 3.5, B12).
// Same module shape as assistantMcp/src/auth.mjs (kept as a sibling copy because the two
// services build/deploy independently): Supabase issues ES256 access tokens and publishes its
// public keys at /auth/v1/.well-known/jwks.json; jose fetches the key set once, caches it
// in-process, and verifies signature + expiry + issuer with zero per-request network I/O.
//
// This replaces the gateway's per-turn `adminSupabase.auth.getUser(token)` — a network round
// trip to Supabase Auth on EVERY /chat POST and resume, the exact call that intermittently
// rate-limited in the MCP and killed turns with spurious 401s. getUser is kept only as a
// fallback when the JWKS endpoint itself is unreachable; a genuine signature/expiry failure is
// never retried against it.
import { createRemoteJWKSet, jwtVerify } from "jose";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";

const JWKS = SUPABASE_URL ? createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`)) : null;
const ISSUER = `${SUPABASE_URL}/auth/v1`;

// Cheap in-process cache so a burst of turns skips re-verification. Bounded by the token's own
// exp so a just-expired token can't ride the cache window.
const cache = new Map(); // token -> { userId, expiresAt }
const CACHE_TTL_MS = 60_000;

function isKeySetOutage(err) {
  const code = err?.code ?? "";
  if (code === "ERR_JWKS_NO_MATCHING_KEY" || code === "ERR_JWKS_TIMEOUT" || code === "ERR_JWKS_MULTIPLE_MATCHING_KEYS") return true;
  return /fetch failed|jwks|failed to fetch|network|ENOTFOUND|ECONNRESET|timed out/i.test(err?.message ?? "");
}

// Best-effort read of a JWT's exp claim (UNVERIFIED — bounds the cache window only).
function tokenExpMs(token) {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof claims.exp === "number" ? claims.exp * 1000 : null;
  } catch { return null; }
}

// getUserFallback: injected by the caller (the gateway already has an admin client).
export async function authenticateToken(token, getUserFallback) {
  if (!token || !JWKS) return null;

  const hit = cache.get(token);
  if (hit && hit.expiresAt > Date.now()) return { userId: hit.userId, userJwt: token };

  let userId = null;
  try {
    const { payload } = await jwtVerify(token, JWKS, { algorithms: ["ES256"], issuer: ISSUER });
    userId = typeof payload.sub === "string" ? payload.sub : null;
  } catch (err) {
    if (!isKeySetOutage(err)) return null; // real signature/expiry failure — reject
    try {
      userId = getUserFallback ? await getUserFallback(token) : null;
    } catch {
      return null;
    }
  }

  if (!userId) return null;
  const exp = tokenExpMs(token);
  const expiresAt = exp ? Math.min(exp, Date.now() + CACHE_TTL_MS) : Date.now() + CACHE_TTL_MS;
  if (expiresAt > Date.now()) cache.set(token, { userId, expiresAt });
  if (cache.size > 5000) cache.clear(); // crude bound; tokens rotate anyway
  return { userId, userJwt: token };
}
