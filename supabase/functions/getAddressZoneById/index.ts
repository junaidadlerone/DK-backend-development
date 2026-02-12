import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { getPreferences } from "../_shared/preferences.ts";

/**
 * Get Address Zone By ID Edge Function
 * Retrieves a specific location zone by ID
 *
 * Business Rules:
 * - Requires zone ID in request body
 * - Organization-based (user must be in same organization as zone)
 * - Returns complete zone data including addresses
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
        "Zone ID is required",
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

    // Fetch zone from database and verify it belongs to user's organization
    const { data: zone, error: zoneError } = await supabase
      .from("location_zones")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .single();

    if (zoneError) {
      if (zoneError.code === "PGRST116") {
        return errorResponse(
          "ZONE_NOT_FOUND",
          "Zone not found in your organization",
          404
        );
      }
      console.error("Error fetching zone:", zoneError);
      return errorResponse(
        "ZONE_FETCH_FAILED",
        "Failed to fetch zone",
        500
      );
    }



    // Fetch user preferences
    const preferences = await getPreferences(supabase, user.userId);

    // Return the zone
    return successResponse(
      {
        status: "success",
        message: "Zone retrieved successfully",
        data: {
          ...zone,
          created_at_tz: enrichTimestamp(zone.created_at, preferences.timezone)
        }
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in getAddressZoneById:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
