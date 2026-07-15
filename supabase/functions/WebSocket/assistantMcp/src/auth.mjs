import { adminSupabase } from "./supabase.mjs";

// Per-request bearer auth. The token is the END USER's Supabase JWT (threaded
// frontend → dk-assistant-chat gateway → Flowise vars.userJwt → MCP config
// Authorization header). Returns { userId, userJwt } or null. A small in-memory
// cache keeps repeated tool calls in one conversation from hammering auth.getUser.
//
// This verified auth.getUser is the REAL authentication gate in front of DK+
// edge functions (many run verify_jwt=false + unsigned decode). Never forward
// a token we haven't validated here.
//
// NOTE (vs Kabuki namiMcp): the users.is_active deactivation check is dropped —
// DK+ has no equivalent column. Add one here if that changes.

const cache = new Map(); // token -> { userId, expiresAt }
const CACHE_TTL_MS = 60_000;

export async function authenticate(req) {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const hit = cache.get(token);
  if (hit && hit.expiresAt > Date.now()) {
    return { userId: hit.userId, userJwt: token };
  }

  const { data, error } = await adminSupabase.auth.getUser(token);
  if (error || !data?.user) return null;

  cache.set(token, { userId: data.user.id, expiresAt: Date.now() + CACHE_TTL_MS });
  if (cache.size > 5000) cache.clear(); // crude bound; tokens rotate anyway
  return { userId: data.user.id, userJwt: token };
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
