import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { getPreferences } from "../_shared/preferences.ts";

/**
 * Get Template History Edge Function
 * Retrieves the complete history log for a specific template
 *
 * Business Rules:
 * - Requires template ID in request body (database UUID or PostGrid template ID)
 * - Returns all logged actions for the template
 * - Ordered by most recent first
 * - Includes user information for each action
 * - Organization-based (user must be in organization)
 *
 * Request body:
 * {
 *   "id": string (required) - database UUID or PostGrid template ID
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
    // Parse request body
    let body: any;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      return errorResponse(
        "INVALID_INPUT",
        "Invalid JSON format in request body",
        400
      );
    }

    const { id } = body;

    // Validate required ID
    if (!id) {
      return errorResponse(
        "INVALID_INPUT",
        "Template ID is required",
        400
      );
    }

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

    // Helper function to check if string is a valid UUID
    function isUUID(str: string): boolean {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      return uuidRegex.test(str);
    }

    // Determine if id is a UUID (database ID) or PostGrid template ID
    const isDbId = isUUID(id);

    let query = supabase
      .from("templates")
      .select("id")
      .eq("organization_id", organizationId);

    // Query by appropriate field
    if (isDbId) {
      query = query.eq("id", id);
    } else {
      query = query.eq("postgrid_template_id", id);
    }

    const { data: template, error: templateError } = await query.single();

    if (templateError) {
      if (templateError.code === "PGRST116") {
        return errorResponse(
          "TEMPLATE_NOT_FOUND",
          "Template not found in your organization",
          404
        );
      }
      console.error("Error fetching template:", templateError);
      return errorResponse(
        "TEMPLATE_FETCH_FAILED",
        "Failed to fetch template",
        500
      );
    }

    // Fetch template history using database ID
    const { data: history, error: historyError } = await supabase
      .from("template_history")
      .select("*")
      .eq("template_id", template.id)
      .order("created_at", { ascending: false });

    if (historyError) {
      console.error("Error fetching template history:", historyError);
      return errorResponse(
        "HISTORY_FETCH_FAILED",
        "Failed to fetch template history",
        500
      );
    }

    // Fetch user preferences
    const preferences = await getPreferences(supabase, user.userId);

    // Enrich history with timezone info
    const enrichedHistory = (history || []).map((item) => ({
      ...item,
      created_at_tz: enrichTimestamp(item.created_at, preferences.timezone),
    }));

    // Return the history
    return successResponse(
      {
        status: "success",
        message: "Template history retrieved successfully",
        data: {
          template_id: template.id,
          history: enrichedHistory,
          count: enrichedHistory.length
        }
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in getTemplateHistory:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
