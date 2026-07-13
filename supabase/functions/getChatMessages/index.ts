/**
 * getChatMessages
 *
 * GET ?session_id=<uuid>  → all user/assistant messages in a session, oldest first,
 *                           plus the session header (id, title, timestamps).
 *
 * Returns 404 if the session doesn't exist or doesn't belong to the authenticated user.
 *
 * Consumed by the DoorKnocker+ AI assistant (Tier 1) for conversation resume — the
 * richer sibling of getChatHistory (which returns bare {role, content} and stays
 * untouched for the legacy widget path). Ported from Kabuki's getChatMessages, with
 * a role filter: DK+'s chat_messages may contain role='tool' rows from the legacy
 * chatbot, which the chat UI must never render.
 */

import { createSupabaseClient } from "../_shared/client.ts";
import { errorResponse, successResponse, corsResponse } from "../_shared/response.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "GET") return errorResponse("Method not allowed", "Use GET", 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return errorResponse("Unauthorized", "Missing Authorization header", 401);
  const token = authHeader.replace("Bearer ", "");

  const supabase = createSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return errorResponse("Unauthorized", "Invalid token", 401);

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) return errorResponse("Bad request", "session_id query param is required", 400);

  // Verify this session belongs to the authenticated user
  const { data: session } = await supabase
    .from("chat_sessions")
    .select("id, title, created_at, updated_at")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .single();

  if (!session) return errorResponse("Not found", "Session not found", 404);

  const { data: messages, error: msgError } = await supabase
    .from("chat_messages")
    .select("id, role, content, created_at")
    .eq("session_id", sessionId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: true });

  if (msgError) return errorResponse("DB error", "Failed to load messages", 500);

  return successResponse({
    session: {
      id: session.id,
      title: session.title ?? "New conversation",
      created_at: session.created_at,
      updated_at: session.updated_at,
    },
    messages: messages ?? [],
  });
});
