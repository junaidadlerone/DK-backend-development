import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Clear Notification By ID Edge Function
 * Archives a single notification by setting is_archived = true
 * 
 * Input:
 * {
 *   "notification_id": "uuid"
 * }
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

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const { notification_id } = body;

    if (!notification_id) {
      return errorResponse(
        "INVALID_INPUT",
        "notification_id is required",
        400
      );
    }

    // Update notification to archived
    // Ensure it belongs to the user's organization
    const { error: updateError } = await supabase
      .from("notifications")
      .update({ is_archived: true })
      .eq("id", notification_id)
      .eq("organization_id", organizationId);

    if (updateError) {
      console.error("Error archiving notification:", updateError);
      return errorResponse(
        "UPDATE_FAILED",
        "Failed to archive notification",
        500
      );
    }

    return successResponse({
      status: "success",
      message: "Notification archived successfully"
    });

  } catch (error) {
    console.error("Unexpected error in clearNotificationById:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
