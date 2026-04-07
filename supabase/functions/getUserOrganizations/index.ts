import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient, getUserProfile } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizations } from "../_shared/organization.ts";

/**
 * Get User Organizations Edge Function
 * Returns all organizations the authenticated user can access.
 * Powers the org dropdown in the top bar.
 * Target: < 300ms (single DB query via shared helper).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();

  if (req.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only GET method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();
    const user = getUserFromRequest(req);

    if (!user) {
      return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);
    }

    const profile = await getUserProfile(user.userId);

    if (!profile) {
      return errorResponse("PROFILE_NOT_FOUND", "User profile not found", 404);
    }

    const organizations = await getUserOrganizations(
      supabase,
      user.userId,
      profile.active_organization_id
    );

    return successResponse({
      status: "success",
      organizations,
    });

  } catch (error) {
    console.error("Unexpected error in getUserOrganizations:", error);
    return errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});
