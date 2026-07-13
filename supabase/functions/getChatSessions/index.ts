/**
 * getChatSessions
 *
 * GET    → list the authenticated user's chat sessions, most recently active first,
 *          with last-message preview and message count.
 * DELETE → body {"session_id": "<uuid>"} — delete an owned session (messages CASCADE).
 *
 * Upgraded 2026-07-13 for the DoorKnocker+ AI assistant (Tier 1), replacing the
 * legacy version that called get_user_chat_sessions (created_at ordering, LIMIT 20,
 * no delete). The response is a BACKWARD-COMPATIBLE SUPERSET: the legacy widget reads
 * {id, created_at, title, message_count}, all still present; {last_message, last_role,
 * updated_at} are new. Titles now come from chat_sessions.title (written by the
 * dk-assistant-chat service; backfilled for pre-existing sessions by migration
 * 20260713000000). Ordering is by updated_at (true recency — the touch trigger from
 * the same migration keeps it current).
 */

import { createSupabaseClient } from "../_shared/client.ts";
import { errorResponse, successResponse, corsResponse } from "../_shared/response.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return errorResponse("Unauthorized", "Missing Authorization header", 401);
  const token = authHeader.replace("Bearer ", "");

  const supabase = createSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return errorResponse("Unauthorized", "Invalid token", 401);

  // ── GET: list sessions ──────────────────────────────────────────────────────
  if (req.method === "GET") {
    const { data, error } = await supabase.rpc("get_chat_sessions", { p_user_id: user.id });

    if (error) return errorResponse("DB error", "Failed to load sessions", 500);

    return successResponse({
      sessions: (data ?? []).map((s: {
        id: string; title: string | null; last_message: string | null;
        last_role: string | null; message_count: number | string;
        created_at: string; updated_at: string;
      }) => ({
        id: s.id,
        title: s.title ?? "New conversation",
        last_message: s.last_message ?? null,
        last_role: s.last_role ?? null,
        message_count: Number(s.message_count ?? 0),
        created_at: s.created_at,
        updated_at: s.updated_at,
      })),
    });
  }

  // ── DELETE: remove an owned session (CASCADE deletes its messages) ──────────
  if (req.method === "DELETE") {
    const body = await req.json().catch(() => ({}));
    const { session_id } = body;

    if (!session_id) return errorResponse("Bad request", "session_id is required", 400);

    // Verify ownership before deleting
    const { data: session } = await supabase
      .from("chat_sessions")
      .select("id")
      .eq("id", session_id)
      .eq("user_id", user.id)
      .single();

    if (!session) return errorResponse("Not found", "Session not found", 404);

    const { error } = await supabase
      .from("chat_sessions")
      .delete()
      .eq("id", session_id);

    if (error) return errorResponse("DB error", "Failed to delete session", 500);

    return successResponse({ deleted: true, session_id });
  }

  return errorResponse("Method not allowed", "Use GET or DELETE", 405);
});
