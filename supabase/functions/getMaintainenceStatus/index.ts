import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";

/**
 * Get Maintainence Status Edge Function
 * Returns the current maintenance status and estimated time.
 * Public endpoint — no authentication required.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();

  if (req.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only GET method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();

    const { data, error } = await supabase
      .from("maintainence")
      .select("isUnderMaintainence, estimated_time, updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (error) {
      console.error("Error fetching maintainence status:", error);
      return errorResponse("FETCH_FAILED", "Failed to fetch maintenance status", 500);
    }

    return successResponse({
      status: "success",
      data: {
        isUnderMaintainence: data?.isUnderMaintainence ?? false,
        estimated_time: data?.estimated_time ?? "9:00AM EST",
        updated_at: data?.updated_at ?? null,
      },
    }, 200);

  } catch (error) {
    console.error("Unexpected error in getMaintainenceStatus:", error);
    return errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});
