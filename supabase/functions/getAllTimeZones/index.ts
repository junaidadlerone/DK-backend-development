import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";

/**
 * Get All TimeZones Edge Function
 * Returns all available timezones
 *
 * Business Rules:
 * - Public access (no authentication required)
 * - Returns list of all timezones with id, symbol, and name
 */

Deno.serve(async (req) => {
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
    // Create Supabase client
    const supabase = createSupabaseClient();

    // Fetch all timezones
    const { data: timezones, error } = await supabase
      .from("timezones")
      .select("id, symbol, name")
      .order("symbol");

    if (error) {
      console.error("Error fetching timezones:", error);
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to fetch timezones",
        500
      );
    }

    return successResponse(timezones, 200);

  } catch (error) {
    console.error("Unexpected error in getAllTimeZones:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
