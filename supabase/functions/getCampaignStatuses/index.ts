import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";

/**
 * Get Campaign Statuses Edge Function
 * Returns all available campaign status types
 *
 * Business Rules:
 * - Any authenticated user can access this
 * - Returns all rows from campaign_status_types table
 */
Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow GET requests
  if (req.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only GET method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();

    // Authenticate user
    const user = getUserFromRequest(req);
    if (!user) {
      return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);
    }

    // Fetch all campaign status types
    const { data, error } = await supabase
      .from("campaign_status_types")
      .select("id, name")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching campaign statuses:", error);
      return errorResponse("DATABASE_ERROR", "Failed to fetch campaign statuses", 500);
    }

    return successResponse({ data }, 200);

  } catch (error) {
    console.error("Unexpected error in getCampaignStatuses:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error instanceof Error ? error.message : "Unknown error"}`,
      500,
    );
  }
});
