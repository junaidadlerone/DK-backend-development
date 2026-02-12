import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseAnonClient } from "../_shared/client.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  try {
    const url = new URL(req.url);
    const countryName = url.searchParams.get("country_name");

    if (!countryName) {
      return errorResponse("INVALID_INPUT", "country_name parameter is required", 400);
    }

    const supabase = createSupabaseAnonClient();

    // First find the country ID
    const { data: country, error: countryError } = await supabase
      .from("countries")
      .select("id")
      .ilike("name", countryName) // Case-insensitive match
      .single();

    if (countryError || !country) {
      return errorResponse("NOT_FOUND", "Country not found", 404);
    }

    // Fetch states for the country
    const { data: states, error: statesError } = await supabase
      .from("world_states")
      .select("name, code")
      .eq("country_id", country.id)
      .order("name", { ascending: true });

    if (statesError) {
      console.error("Error fetching states:", statesError);
      return errorResponse("DB_ERROR", "Failed to fetch states", 500);
    }

    return successResponse({
      status: "success",
      data: states,
    });

  } catch (error) {
    console.error("Unexpected error:", error);
    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
});
