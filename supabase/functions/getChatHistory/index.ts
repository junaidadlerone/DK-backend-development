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

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) return errorResponse("Bad request", "session_id is required", 400);

  // Verify session belongs to this user
  const { data: session } = await supabase
    .from("chat_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .single();

  if (!session) return errorResponse("Not found", "Session not found or does not belong to this user", 404);

  const { data: messages, error: msgError } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (msgError) return errorResponse("DB error", "Failed to load messages", 500);

  return successResponse({ messages: messages ?? [] });
});
