// Environment for dk-assistant-mcp (Phase 2, GET-only).
// No downstream WebSocket URLs (unlike Kabuki's namiMcp) — Phase 2 reads go
// through DK+ Supabase Edge Functions via callApi; no WS bridges, no mutations.

export const PORT = process.env.PORT || 8080;
export const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
// PostGrid postcard API key (3C-3): ONLY needed by delete_template_bundle — that edge function
// requires the key in its request body (create/update read it from their own env). This is the
// same public key the frontend ships as VITE_POSTGRID_POSTCARD_API_KEY. Optional: when unset,
// the delete tool degrades to a graceful "not configured" message.
export const POSTGRID_POSTCARD_API_KEY = process.env.POSTGRID_POSTCARD_API_KEY ?? "";
