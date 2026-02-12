import { createSupabaseClient } from "../_shared/client.ts";
import { successResponse, errorResponse, corsResponse } from "../_shared/response.ts";

/**
 * Get All Consents Edge Function
 * Returns all campaign disclaimers/consents from the campaign_disclaimers table
 *
 * Business Rules:
 * - Public endpoint - no authentication required
 * - Returns all disclaimer texts with their IDs and values
 *
 * Response:
 * {
 *   "status": "success",
 *   "data": [
 *     {
 *       "id": "uuid",
 *       "disclaimer_text": "...",
 *       "value": true/false,
 *       "created_at": "timestamp"
 *     }
 *   ]
 * }
 */

Deno.serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow GET requests
  if (req.method !== "GET") {
    return errorResponse(
      "METHOD_NOT_ALLOWED",
      "Only GET requests are allowed",
      405
    );
  }

  try {
    // Create Supabase client (service role for public endpoint)
    const supabase = createSupabaseClient();

    // Fetch all disclaimers from the campaign_disclaimers table
    const { data: disclaimers, error } = await supabase
      .from("campaign_disclaimers")
      .select("id, disclaimer_text, value, created_at")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching disclaimers:", error);
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to fetch campaign disclaimers",
        500
      );
    }

    return successResponse(
      {
        status: "success",
        data: disclaimers || []
      },
      200
    );

  } catch (error) {
    console.error("Unexpected error in getAllConsents:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred",
      500
    );
  }
});
