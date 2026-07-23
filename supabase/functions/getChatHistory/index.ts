import { createSupabaseClient } from "../_shared/client.ts";
import { errorResponse, successResponse, corsResponse } from "../_shared/response.ts";

/**
 * getChatHistory — one session's full renderable transcript (Tier 3.5).
 *
 * Response shape:
 *   {
 *     messages: [ { id, role, content, created_at, thinking, attachment, my_rating } ],
 *     surfaces: [ { surface_id, message_id, frame, interaction, seq, created_at } ]
 *   }
 *
 * - `thinking`   — ordered progress labels persisted for that assistant turn (null when none).
 * - `attachment` — [{ name, kind, size }] marker metadata from the user's turn (null when none).
 * - `my_rating`  — the caller's per-message feedback ("up" | "down" | null) for assistant rows.
 * - `surfaces`   — GenUI cards as a SIBLING array (not nested): the client attaches each to its
 *                  message_id, and interleaves orphans (message_id null — pause-turn approval
 *                  cards) by created_at. `interaction` null → render live; set → render locked.
 * Rows from before the persistence migration simply have null extras and no surfaces —
 * they render as plain text (forward-only compatibility, matching the Nami reference).
 */
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

  const [msgRes, surfaceRes, feedbackRes] = await Promise.all([
    supabase
      .from("chat_messages")
      .select("id, role, content, created_at, thinking, attachment")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true }),
    supabase
      .from("chat_surfaces")
      .select("surface_id, message_id, frame, interaction, seq, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true }),
    supabase
      .from("chat_message_feedback")
      .select("message_id, rating")
      .eq("session_id", sessionId)
      .eq("user_id", user.id),
  ]);

  if (msgRes.error) return errorResponse("DB error", "Failed to load messages", 500);
  // Surfaces/feedback are enrichments — never fail the transcript over them (they also error
  // harmlessly if this function deploys ahead of the Tier-3.5 migration).
  if (surfaceRes.error) console.error("getChatHistory surfaces query failed:", surfaceRes.error.message);
  if (feedbackRes.error) console.error("getChatHistory feedback query failed:", feedbackRes.error.message);

  const ratingByMessage = new Map<string, string>(
    (feedbackRes.data ?? []).map((f: { message_id: string; rating: string }) => [f.message_id, f.rating]),
  );
  const messages = (msgRes.data ?? []).map((m: Record<string, unknown>) => ({
    ...m,
    my_rating: m.role === "assistant" ? (ratingByMessage.get(m.id as string) ?? null) : null,
  }));

  return successResponse({ messages, surfaces: surfaceRes.data ?? [] });
});
