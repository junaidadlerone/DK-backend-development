import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";

/**
 * Get All States Edge Function
 * Returns a list of all US states with their abbreviations and cities
 *
 * Business Rules:
 * - Public endpoint - no authentication required
 * - Returns all US states with their cities array from the us_states table
 * - Used for dropdown/selection in address forms
 * - Cities are returned as an array of strings for each state
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

    // Fetch all US states with their cities from us_cities table
    const { data: states, error: fetchError } = await supabase
      .from("us_states")
      .select(`
        id,
        name,
        abbreviation,
        cities:us_cities(id, name)
      `)
      .order("name", { ascending: true });

    if (fetchError) {
      console.error("Error fetching US states:", fetchError);
      return errorResponse(
        "FETCH_FAILED",
        "Failed to fetch US states",
        500
      );
    }

    // Return the list of states with cities
    return successResponse(
      {
        data: states || [],
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in getAllStates:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
