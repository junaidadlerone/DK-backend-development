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

  const { data: sessions, error } = await supabase.rpc("get_user_chat_sessions", {
    p_user_id: user.id,
  });

  if (error) return errorResponse("DB error", "Failed to load sessions", 500);

  return successResponse({ sessions: sessions ?? [] });
});
