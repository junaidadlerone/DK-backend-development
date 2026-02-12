import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";

/**
 * Get All Jobs Edge Function
 * Returns a list of all available job types
 *
 * Business Rules:
 * - Public endpoint - no authentication required
 * - Returns all job types from the job_types table
 * - Used for dropdown/selection in job creation forms
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

    // Fetch all job types from the database
    const { data: jobTypes, error: fetchError } = await supabase
      .from("job_types")
      .select("id, name")
      .order("name", { ascending: true });

    if (fetchError) {
      console.error("Error fetching job types:", fetchError);
      return errorResponse(
        "FETCH_FAILED",
        "Failed to fetch job types",
        500
      );
    }

    // Return the list of job types
    return successResponse(
      {
        data: jobTypes || [],
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in getAllJobs:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
