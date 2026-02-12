import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseAnonClient } from "../_shared/client.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  try {
    const supabase = createSupabaseAnonClient();

    const { data: countries, error } = await supabase
      .from("countries")
      .select("name, code")
      .order("name", { ascending: true });

    if (error) {
      console.error("Error fetching countries:", error);
      return errorResponse("DB_ERROR", "Failed to fetch countries", 500);
    }

    return successResponse({
      status: "success",
      data: countries,
    });

  } catch (error) {
    console.error("Unexpected error:", error);
    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
});
