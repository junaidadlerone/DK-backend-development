import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Get Notification Status Edge Function
 * Returns whether the user has unread notifications
 *
 * Business Rules:
 * - Organization-based (returns status for user's organization)
 * - Only checks notifications targeted to user's role or all roles
 * - Returns isUnread: true if any unread notifications exist, false otherwise
 *
 * Response Format:
 * {
 *   "status": "success",
 *   "data": {
 *     "isUnread": true/false
 *   }
 * }
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

    // Get user's role from profiles table
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.userId)
      .single();

    if (profileError || !profile) {
      console.error("Error fetching user profile:", profileError);
      return errorResponse(
        "PROFILE_NOT_FOUND",
        "User profile not found",
        404
      );
    }

    const userRole = profile.role;

    // Check if there are any unread notifications for this user's role in their organization
    // Exclude archived (cleared) notifications
    const { count: unreadCount, error: countError } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("is_read", false)
      .eq("is_archived", false)
      .contains("target_roles", [userRole]);

    if (countError) {
      console.error("Error counting unread notifications:", countError);
      return errorResponse(
        "NOTIFICATIONS_FETCH_FAILED",
        "Failed to fetch notifications status",
        500
      );
    }

    // If any unread notifications exist, isUnread is true
    const isUnread = (unreadCount || 0) > 0;

    return successResponse({
      status: "success",
      data: {
        isUnread,
        unreadCount: unreadCount || 0
      }
    }, 200);

  } catch (error) {
    console.error("Unexpected error in getNotificationStatus:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
