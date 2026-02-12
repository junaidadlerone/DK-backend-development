import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";

/**
 * Get All Currencies Edge Function
 * Returns all available currencies
 *
 * Business Rules:
 * - Public access (no authentication required)
 * - Returns list of all currencies with id, symbol, name, and abbreviation
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

    // Fetch all currencies
    const { data: currencies, error } = await supabase
      .from("currencies")
      .select("id, symbol, name, abbreviation")
      .order("name");

    if (error) {
      console.error("Error fetching currencies:", error);
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to fetch currencies",
        500
      );
    }

    return successResponse(currencies, 200);

  } catch (error) {
    console.error("Unexpected error in getAllCurrencies:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
