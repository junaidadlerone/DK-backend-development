import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { getPreferences } from "../_shared/preferences.ts";

/**
 * Get Notifications Edge Function
 * Returns notifications for the authenticated user based on their role and organization
 *
 * Business Rules:
 * - Organization-scoped: Returns only notifications for user's organization
 * - Role-based filtering: Returns notifications based on user's access type (ADMIN, MARKETER, TECHNICIAN)
 * - Marks all returned notifications as read
 * - Returns notifications in reverse chronological order
 *
 * Response format:
 * {
 *   "data": [
 *     {
 *       "title": "Campaign linked",
 *       "description": "Campaign 'My Awesome Campaign' has been linked to your Referral 'Referral Name'",
 *       "isUnread": true
 *     }
 *   ]
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

  const startTime = Date.now();

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

    // Get user's profile to determine their role
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.userId)
      .single();

    if (profileError || !profile) {
      return errorResponse(
        "PROFILE_NOT_FOUND",
        "User profile not found",
        404
      );
    }

    const userRole = profile.role;

    // Validate role
    if (!["ADMIN", "MARKETER", "TECHNICIAN"].includes(userRole)) {
      return errorResponse(
        "INVALID_ROLE",
        "Invalid user role",
        403
      );
    }

    // Parse query parameters
    const url = new URL(req.url);
    const filter = url.searchParams.get("filter"); // 'unread', 'read', or null (all)
    const showArchivedParam = url.searchParams.get("showArchived");
    const showArchived = showArchivedParam === "true"; // Defaults to false if not present or "false"
    const pageParam = url.searchParams.get("page");
    const limitParam = url.searchParams.get("limit");

    // Pagination defaults
    let page = pageParam ? parseInt(pageParam, 10) : 1;
    let limit = limitParam ? parseInt(limitParam, 10) : 20;

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1) limit = 20;
    if (limit > 100) limit = 100; // Max limit

    const offset = (page - 1) * limit;

    // Build query
    let query = supabase
      .from("notifications")
      .select("id, title, description, is_read, is_archived, organization_id, notification_type, metadata, created_at", { count: "exact" })
      .eq("organization_id", organizationId)
      .eq("is_archived", showArchived) // Filter by archived status
      .contains("target_roles", [userRole])
      .order("created_at", { ascending: false });

    // Apply filters
    if (filter === "unread") {
      query = query.eq("is_read", false);
    } else if (filter === "read") {
      query = query.eq("is_read", true);
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    // Execute query
    const { data: notifications, count: totalCount, error: notificationsError } = await query;

    if (notificationsError) {
      console.error("Error fetching notifications:", notificationsError);
      return errorResponse(
        "FETCH_FAILED",
        "Failed to fetch notifications",
        500
      );
    }

    // Fetch user preferences for timezone
    const preferences = await getPreferences(supabase, user.userId);

    // Format response
    const formattedNotifications = (notifications || []).map(notification => ({
      id: notification.id,
      title: notification.title,
      description: notification.description,
      is_read: notification.is_read,
      isUnread: !notification.is_read, // maintain backward compatibility
      type: notification.notification_type,
      metadata: notification.metadata,
      timestamp: notification.created_at,
      timestamp_tz: enrichTimestamp(notification.created_at, preferences.timezone)
    }));

    const processingTimeMs = Date.now() - startTime;
    const totalPages = Math.ceil((totalCount || 0) / limit);

    return successResponse({
      status: "success",
      message: `Found ${formattedNotifications.length} notifications`,
      data: formattedNotifications,
      pagination: {
        page,
        limit,
        total_count: totalCount || 0,
        total_pages: totalPages,
        has_next_page: page < totalPages,
        has_previous_page: page > 1
      },
      metadata: {
        filter_applied: filter || "all",
        processingTimeMs
      }
    });

  } catch (error) {
    console.error("Unexpected error in getNotifications:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
