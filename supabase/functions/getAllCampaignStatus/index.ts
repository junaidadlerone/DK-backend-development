import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";

/**
 * Get All Campaign Status Edge Function
 * Returns all campaign status types
 *
 * Business Rules:
 * - Returns all available campaign status types (Draft, Active, In Active)
 * - No authentication required (public endpoint)
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
    // Create Supabase client
    const supabase = createSupabaseClient();

    // Fetch all campaign status types
    const { data: statusTypes, error: fetchError } = await supabase
      .from("campaign_status_types")
      .select("*")
      .order("name", { ascending: true });

    if (fetchError) {
      console.error("Error fetching campaign status types:", fetchError);
      return errorResponse(
        "FETCH_FAILED",
        "Failed to fetch campaign status types",
        500
      );
    }

    // Return the list of status types
    return successResponse(
      {
        status: "success",
        data: statusTypes || [],
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in getAllCampaignStatus:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
