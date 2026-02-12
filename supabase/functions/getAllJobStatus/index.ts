import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";

/**
 * Get All Job Status Edge Function
 * Returns a list of all available job status types
 *
 * Business Rules:
 * - Public endpoint - no authentication required
 * - Returns all job status types from the job_status_types table
 * - Used for dropdown/selection in job management forms
 * - Three status types: Draft, In Use, Ready
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

    // Fetch all job status types from the database
    const { data: jobStatusTypes, error: fetchError } = await supabase
      .from("job_status_types")
      .select("id, name")
      .order("name", { ascending: true });

    if (fetchError) {
      console.error("Error fetching job status types:", fetchError);
      return errorResponse(
        "FETCH_FAILED",
        "Failed to fetch job status types",
        500
      );
    }

    // Return the list of job status types
    return successResponse(
      {
        data: jobStatusTypes || [],
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in getAllJobStatus:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
