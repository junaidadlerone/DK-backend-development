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

    let organization;

    if (userRole === "ADMIN") {
      // For ADMIN: Get organization where they are the owner
      const { data, error } = await supabase
        .from("organizations")
        .select("*")
        .eq("owner_id", user.id)
        .single();

      if (error || !data) {
        return errorResponse(
          "ORGANIZATION_NOT_FOUND",
          "Organization not found",
          404
        );
      }

      organization = data;
    } else {
      // For MARKETER/TECHNICIAN: Get organization where they are a member
      // We need to get all organizations and filter in-memory since JSONB contains
      // doesn't work well with partial object matching
      const { data, error } = await supabase
        .from("organizations")
        .select("*")
        .not("organization_members", "is", null);

      if (error) {
        console.error("Organization fetch error:", error);
        return errorResponse(
          "FETCH_FAILED",
          "Failed to fetch organization",
          500
        );
      }

      if (!data || data.length === 0) {
        return errorResponse(
          "ORGANIZATION_NOT_FOUND",
          "No organizations found",
          404
        );
      }

      // Find organization where user is a member
      let foundOrganization = null;
      for (const org of data) {
        const members = org.organization_members || [];
        if (Array.isArray(members)) {
          const isMember = members.some((member: any) => 
            member && typeof member === 'object' && member.member_uid === user.id
          );
          if (isMember) {
            foundOrganization = org;
            break;
          }
        }
      }

      if (!foundOrganization) {
        return errorResponse(
          "ORGANIZATION_NOT_FOUND",
          "You are not associated with any organization",
          404
        );
      }

      organization = foundOrganization;
    }

    // Fetch user preferences
    const preferences = await getPreferences(supabase, user.id);

    // Enrich organization with timezone info
    if (organization) {
      organization = {
        ...organization,
        created_at_tz: enrichTimestamp(organization.created_at, preferences.timezone),
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
