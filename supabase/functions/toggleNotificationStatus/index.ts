import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Toggle Notification Status Edge Function
 * Marks a notification as read or unread
 * 
 * Input:
 * {
 *   "notification_id": "uuid",
 *   "status": "read" | "unread"
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
    const { notification_id, status } = body;

    if (!notification_id) {
      return errorResponse(
        "INVALID_INPUT",
        "notification_id is required",
        400
      );
    }

    if (!status || !["read", "unread"].includes(status)) {
      return errorResponse(
        "INVALID_INPUT",
        "status must be 'read' or 'unread'",
        400
      );
    }

    const isRead = status === "read";

    // Update notification status
    // Security check: Ensure notification belongs to user's organization
    // And target_roles includes user's role (optional, but good practice)
    
    // First verify ownership/access
    const { data: notification, error: fetchError } = await supabase
      .from("notifications")
      .select("id")
      .eq("id", notification_id)
      .eq("organization_id", organizationId)
      .single();

    if (fetchError || !notification) {
      return errorResponse(
        "NOTIFICATION_NOT_FOUND",
        "Notification not found or access denied",
        404
      );
    }

    // Perform update
    const { error: updateError } = await supabase
      .from("notifications")
      .update({ is_read: isRead })
      .eq("id", notification_id);

    if (updateError) {
      console.error("Error updating notification status:", updateError);
      return errorResponse(
        "UPDATE_FAILED",
        "Failed to update notification status",
        500
      );
    }

    return successResponse({
      status: "success",
      message: `Notification marked as ${status}`,
      data: {
        id: notification_id,
        is_read: isRead
      }
    });

  } catch (error) {
    console.error("Unexpected error in toggleNotificationStatus:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
