import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient, getUserRole } from "../_shared/client.ts";
import { type GetOrganizationResponse } from "../_shared/types.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { getPreferences } from "../_shared/preferences.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Get Organization Edge Function
 * Returns organization information based on logged-in user
 *
 * Business Rules:
 * - ADMIN users: Returns organization where owner_id matches their UID
 * - MARKETER/TECHNICIAN users: Returns organization where organization_members contains their UID
 * - Requires valid JWT token
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

    // Get the authorization header
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return errorResponse(
        "UNAUTHORIZED",
        "Authorization header is required",
        401
      );
    }

    // Extract the JWT token
    const token = authHeader.replace("Bearer ", "");

    // Verify the token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return errorResponse(
        "INVALID_TOKEN",
        "Invalid or expired token",
        401
      );
    }

    // Get user's role
    const userRole = await getUserRole(user.id);

    if (!userRole) {
      return errorResponse(
        "USER_NOT_FOUND",
        "User profile not found",
        404
      );
    }

    // Resolve the user's active organization (respects active_organization_id and all roles)
    const organizationId = await getUserOrganizationId(supabase, user.id);

    if (!organizationId) {
      return errorResponse(
        "ORGANIZATION_NOT_FOUND",
        "You are not associated with any organization",
        404
      );
    }

    const { data: organization, error: fetchError } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", organizationId)
      .single();

    if (fetchError || !organization) {
      console.error("Organization fetch error:", fetchError);
      return errorResponse(
        "FETCH_FAILED",
        "Failed to fetch organization",
        500
      );
    }

    // Fetch user preferences
    const preferences = await getPreferences(supabase, user.id);

    // Enrich organization with timezone info and agency flag
    const enrichedOrganization = {
      ...organization,
      created_at_tz: enrichTimestamp(organization.created_at, preferences.timezone),
      isAgencyAccount: organization.is_agency ?? true,
    };

    // Return success response
    const response: GetOrganizationResponse = {
      status: "success",
      data: enrichedOrganization,
    };

    return successResponse(response, 200);

  } catch (error) {
    console.error("Unexpected error in getOrganization:", error);

    // Don't leak internal error details to the client
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
