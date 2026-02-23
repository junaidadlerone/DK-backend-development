import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";

/**
 * Get Industry Edge Function
 * Returns all available industry categories from the industries table
 *
 * Business Rules:
 * - Public endpoint - no authentication required
 * - Returns all rows from the industries table, sorted alphabetically
 * - Used for industry/sector selection dropdowns
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();

  if (req.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only GET method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();

    const { data, error } = await supabase
      .from("industries")
      .select("id, name")
      .order("name", { ascending: true });

    if (error) {
      console.error("Error fetching industries:", error);
      return errorResponse("DATABASE_ERROR", "Failed to fetch industries", 500);
    }

    return successResponse(
      {
        status: "success",
        data: {
          industries: data?.map((row: { name: string }) => row.name) ?? [],
          total: data?.length ?? 0,
        },
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in getIndustry:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
