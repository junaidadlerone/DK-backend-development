import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { getPreferences } from "../_shared/preferences.ts";

/**
 * Get All Address Zones Edge Function
 * Retrieves all location zones for the user's organization
 *
 * Business Rules:
 * - Organization-based (returns only zones from user's organization)
 * - Ordered by most recent first
 * - Includes all zone data and addresses
 * - Query parameter `showAll=true` returns all zones (including those without campaign_id)
 * - Without `showAll` parameter, returns:
 *   - Zones with campaign_id (linked to campaigns) OR
 *   - Zones with manual_search = true (manually created zones)
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
    // Parse query parameters
    const url = new URL(req.url);
    const showAll = url.searchParams.get("showAll") === "true";

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

    // Build query based on showAll parameter
    let query = supabase
      .from("location_zones")
      .select("*")
      .eq("organization_id", organizationId);

    // If showAll is NOT true, filter to zones with campaign_id OR manual_search = true
    if (!showAll) {
      query = query.or("campaign_id.not.is.null,manual_search.eq.true");
    }

    // Execute query with ordering
    const { data: zones, error: zonesError } = await query
      .order("created_at", { ascending: false });

    if (zonesError) {
      console.error("Error fetching zones:", zonesError);
      return errorResponse(
        "ZONES_FETCH_FAILED",
        "Failed to fetch zones",
        500
      );
    }

    // Fetch user preferences
    const preferences = await getPreferences(supabase, user.userId);

    // Enrich zones with timezone info
    const enrichedZones = (zones || []).map((zone) => ({
      ...zone,
      created_at_tz: enrichTimestamp(zone.created_at, preferences.timezone),
    }));

    // Return the zones
    return successResponse(
      {
        status: "success",
        message: `Retrieved ${zones?.length || 0} zones`,
        data: enrichedZones,
        count: zones?.length || 0
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in getAllAddressZones:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
