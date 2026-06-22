import { createSupabaseClient } from "../_shared/client.ts";
import { successResponse, errorResponse, corsResponse } from "../_shared/response.ts";

const NOTION_TOKEN = Deno.env.get("NOTION_TOKEN");
const NOTION_DATABASE_ID = Deno.env.get("NOTION_DATABASE_ID");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") return errorResponse("Method not allowed", "Use POST", 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return errorResponse("Unauthorized", "Missing Authorization header", 401);
  const token = authHeader.replace("Bearer ", "");

  const supabase = createSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return errorResponse("Unauthorized", "Invalid token", 401);

  const body = await req.json().catch(() => ({}));
  const { rating, comment, page_url } = body as {
    rating?: number;
    comment?: string;
    page_url?: string;
  };

  if (!rating || rating < 1 || rating > 5) {
    return errorResponse("Bad request", "rating must be an integer between 1 and 5", 400);
  }

  const { error: dbError } = await supabase.from("reviews").insert({
    user_id: user.id,
    rating,
    comment: comment?.trim() || null,
    page_url: page_url || null,
  });

  if (dbError) return errorResponse("DB error", dbError.message, 500);

  // Optional Notion sync — only runs if both env vars are configured
  if (NOTION_TOKEN && NOTION_DATABASE_ID) {
    try {
      await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify({
          parent: { database_id: NOTION_DATABASE_ID },
          properties: {
            Rating: { number: rating },
            Comment: {
              rich_text: [{ text: { content: comment?.trim() ?? "" } }],
            },
            "Page URL": { url: page_url || null },
            "User ID": {
              rich_text: [{ text: { content: user.id } }],
            },
          },
        }),
      });
    } catch (err) {
      // Notion sync failure is non-fatal — review is already saved in Supabase
      console.error("Notion sync failed:", err);
    }
  }

  return successResponse({ success: true });
});
