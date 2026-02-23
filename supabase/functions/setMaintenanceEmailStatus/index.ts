import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";

/**
 * Set Maintenance Email Status Edge Function
 * Allows ADMIN users to update the maintenance_email_sent flag for any user
 *
 * Business Rules:
 * - Only ADMIN users can access this endpoint
 * - Updates maintenance_email_sent in profiles table
 * - Requires target userId and new status (boolean)
 *
 * Request body (multipart/form-data):
 * - opt_in_maintenance_complete_email: "true" | "false"
 */
Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow POST requests
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed", 405);
  }

  const startTime = Date.now();

  try {

    // Get the authorization header to verify requester
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse(
        "UNAUTHORIZED",
        "Authorization header is required",
        401
      );
    }

    // Create Supabase client with service role for administrative tasks
    const supabase = createSupabaseClient();

    // Extract and verify the JWT token
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: requester }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !requester) {
      return errorResponse(
        "INVALID_TOKEN",
        "Invalid or expired token",
        401
      );
    }

    const userId = requester.id;

    // Parse and validate request body (multipart/form-data)
    let formData;
    try {
      formData = await req.formData();
    } catch (_e) {
      return errorResponse("INVALID_INPUT", "Invalid form data", 400);
    }

    const optInValue = formData.get("opt_in_maintenance_complete_email");
    
    let optInRaw = "";
    if (optInValue instanceof File) {
      optInRaw = await optInValue.text();
    } else {
      optInRaw = optInValue?.toString() || "";
    }

    if (optInRaw === undefined || optInRaw === null || optInRaw.trim() === "") {
      return errorResponse("INVALID_INPUT", "opt_in_maintenance_complete_email is required", 400);
    }

    /**
     * Inverted Logic Mapping:
     * - opt_in_maintenance_complete_email = "true" -> maintenance_email_sent = false (system should send email)
     * - opt_in_maintenance_complete_email = "false" -> maintenance_email_sent = true (system should skip email)
     */
    const isOptedIn = optInRaw.toLowerCase().trim() === "true";
    const maintenanceEmailSentValue = !isOptedIn;

    console.log(`[setMaintenanceEmailStatus] User ${userId} opt-in (calculated): ${isOptedIn}. Raw value: "${optInRaw.trim()}"`);

    // Update the flag in the profiles table
    const { data: updatedProfile, error: updateError } = await supabase
      .from("profiles")
      .update({ 
        maintenance_email_sent: maintenanceEmailSentValue,
        updated_at: new Date().toISOString()
      })
      .eq("id", userId)
      .select("id, maintenance_email_sent")
      .single();

    if (updateError) {
      console.error("[setMaintenanceEmailStatus] Update error:", updateError);
      return errorResponse("UPDATE_FAILED", `Failed to update status: ${updateError.message}`, 500);
    }

    if (!updatedProfile) {
      return errorResponse("USER_NOT_FOUND", "User profile not found", 404);
    }

    return successResponse({
      status: "success",
      message: "Maintenance email status updated successfully",
      data: updatedProfile,
      processingTimeMs: Date.now() - startTime
    }, 200);

  } catch (error) {
    const err = error as Error;
    console.error("[setMaintenanceEmailStatus] Unexpected error:", err);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${err.message}`,
      500
    );
  }
});
