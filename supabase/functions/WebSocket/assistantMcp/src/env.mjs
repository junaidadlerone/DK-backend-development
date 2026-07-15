// Environment for dk-assistant-mcp (Phase 2, GET-only).
// No downstream WebSocket URLs (unlike Kabuki's namiMcp) — Phase 2 reads go
// through DK+ Supabase Edge Functions via callApi; no WS bridges, no mutations.

export const PORT = process.env.PORT || 8080;
export const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
