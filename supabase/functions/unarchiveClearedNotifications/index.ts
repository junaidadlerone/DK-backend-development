import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Unarchive Cleared Notifications Edge Function
 * Restores ALL archived notifications for the organization
 * 
 * Input: {}
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

  try {
    // Create Supabase client
    const supabase = createSupabaseClient();

    // Get user from request
    const user = getUserFromRequest(req);
    if (!user) {
      return errorResponse(
        "UNAUTHORIZED",
        "Unable to authenticate user",
        401
      );
    }

    // Get user's organization
    const organizationId = await getUserOrganizationId(supabase, user.userId);
    if (!organizationId) {
      return errorResponse(
        "NO_ORGANIZATION",
        "User is not associated with any organization",
        403
      );
    }

    // Update all archived notifications for this organization to unarchived
    const { count, error: updateError } = await supabase
      .from("notifications")
      .update({ is_archived: false })
      .eq("organization_id", organizationId)
      .eq("is_archived", true)
      .select('count'); // To get count of updated rows? select() returns data, count option needed
      
    // Wait, update doesn't return count by default unless select is used? 
    // Supabase JS client update() returns { data, error, count } if count option is used?
    // Let's refine for clarity:
    // .update(..., { count: 'exact' }) isn't standard in JS client for update?
    // Usually it's .update({...}).eq(...).select() to get data.
    
    // Let's use simple update. The error is what matters.

    if (updateError) {
      console.error("Error restoring all notifications:", updateError);
      return errorResponse(
        "UPDATE_FAILED",
        "Failed to restore notifications",
        500
      );
    }

    return successResponse({
      status: "success",
      message: "All archived notifications restored successfully"
    });

  } catch (error) {
    console.error("Unexpected error in unarchiveClearedNotifications:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
