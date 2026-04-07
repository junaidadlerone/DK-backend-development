import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient, getUserRole } from "../_shared/client.ts";
import { type GetOrganizationResponse } from "../_shared/types.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { getPreferences } from "../_shared/preferences.ts";

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

    // Fetch all organizations - check owner_id first, then organization_members
    const { data: allOrgs, error: fetchError } = await supabase
      .from("organizations")
      .select("*");

    if (fetchError) {
      console.error("Organization fetch error:", fetchError);
      return errorResponse(
        "FETCH_FAILED",
        "Failed to fetch organization",
        500
      );
    }

    if (!allOrgs || allOrgs.length === 0) {
      return errorResponse(
        "ORGANIZATION_NOT_FOUND",
        "Organization not found",
        404
      );
    }

    // First try: user is the org owner
    let organization = allOrgs.find((org) => org.owner_id === user.id) || null;

    // Second try: user is a member (covers ADMIN, MARKETER, TECHNICIAN members)
    if (!organization) {
      organization = allOrgs.find((org) => {
        const members = org.organization_members || [];
        return Array.isArray(members) && members.some((member: any) =>
          member && typeof member === "object" && member.member_uid === user.id
        );
      }) || null;
    }

    if (!organization) {
      return errorResponse(
        "ORGANIZATION_NOT_FOUND",
        "You are not associated with any organization",
        404
      );
    }

    // Fetch user preferences
    const preferences = await getPreferences(supabase, user.id);

    // Enrich organization with timezone info and agency flag
    if (organization) {
      organization = {
        ...organization,
        created_at_tz: enrichTimestamp(organization.created_at, preferences.timezone),
        isAgencyAccount: organization.is_agency ?? true,
      };
    }

    // Return success response
    const response: GetOrganizationResponse = {
      status: "success",
      data: organization,
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
