import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { getPreferences } from "../_shared/preferences.ts";

/**
 * Get CSV Address List By ID Edge Function
 * Retrieves a specific CSV address list by ID
 *
 * Business Rules:
 * - Requires csv_address_list_id (passed as 'id') in request body
 * - Organization-based (user must be in same organization as list)
 * - Returns complete list data including addresses
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

    const { csv_address_list_id: id } = body;

    // Validate required ID
    if (!id) {
      return errorResponse(
        "INVALID_INPUT",
        "csv_address_list_id is required",
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

    // Fetch address list from database and verify it belongs to user's organization
    const { data: list, error: fetchError } = await supabase
      .from("campaign_csv_address_lists")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .single();

    if (fetchError) {
      if (fetchError.code === "PGRST116") {
        return errorResponse(
          "LIST_NOT_FOUND",
          "Address list not found in your organization",
          404
        );
      }
      console.error("Error fetching address list:", fetchError);
      return errorResponse(
        "FETCH_FAILED",
        "Failed to fetch address list",
        500
      );
    }

    // Fetch user preferences
    const preferences = await getPreferences(supabase, user.userId);

    // Determine if geocoding is needed
    const needsGeocoding = (!list.validated_address_list || list.validated_address_list.length === 0) && !list.center;
    const message = needsGeocoding ? "Addresses need to be geocoded" : "Address list retrieved successfully";

    // Return the list
    return successResponse(
      {
        status: "success",
        message: message,
        data: {
          ...list,
          csv_address_list_id: list.id,
          addresses: list.validated_address_list || [],
          created_at_tz: enrichTimestamp(list.created_at, preferences.timezone),
          updated_at_tz: enrichTimestamp(list.updated_at, preferences.timezone)
        }
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in getCSVAddressListById:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
