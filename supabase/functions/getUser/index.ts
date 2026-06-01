import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import {
  createSupabaseClient,
  getUserProfile,
  isAdmin,
} from "../_shared/client.ts";
import { getUserPreferences } from "../_shared/preferences.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { getUserOrganizations } from "../_shared/organization.ts";

/**
 * Get User Edge Function
 * Fetches the authenticated user's profile and role information
 *
 * Features:
 * - Returns current user's profile data by default
 * - ADMINs can fetch any user's data by passing user_id query parameter
 * - Requires valid JWT authentication
 * - Enforces role-based access control
 * - Returns enriched timezone information
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

    if (!token) {
      return errorResponse(
        "INVALID_TOKEN",
        "Invalid authorization token",
        401
      );
    }

    // Create Supabase client with service role
    const supabase = createSupabaseClient();

    // Verify the token and get authenticated user
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !authUser) {
      return errorResponse(
        "INVALID_TOKEN",
        "Invalid or expired token",
        401
      );
    }

    // Parse query parameters to check if requesting another user's data
    const url = new URL(req.url);
    const requestedUserId = url.searchParams.get("user_id");

    let targetUserId = authUser.id; // Default to authenticated user

    // If requesting another user's profile
    if (requestedUserId && requestedUserId !== authUser.id) {
      // Check if the authenticated user is an admin
      const userIsAdmin = await isAdmin(authUser.id);

      if (!userIsAdmin) {
        return errorResponse(
          "FORBIDDEN",
          "Only ADMIN users can view other users' profiles",
          403
        );
      }

      // ADMIN is allowed to view the requested user
      targetUserId = requestedUserId;
    }

    // Fetch the target user's auth data
    const { data: { user: targetAuthUser }, error: targetAuthError } =
      await supabase.auth.admin.getUserById(targetUserId);

    if (targetAuthError || !targetAuthUser) {
      return errorResponse(
        "USER_NOT_FOUND",
        "User not found",
        404
      );
    }

    // Fetch the target user's profile from profiles table
    const profile = await getUserProfile(targetUserId);

    if (!profile) {
      return errorResponse(
        "PROFILE_NOT_FOUND",
        "User profile not found. Please contact support.",
        404
      );
    }

    // Fetch preferences for timezone enrichment (viewer's timezone)
    const preferences = await getUserPreferences(supabase, authUser.id);

    // Fetch orgs the target user can access (for multi-tenant dropdown)
    const orgsFromHelper = await getUserOrganizations(
      supabase,
      targetUserId,
      profile.active_organization_id ?? undefined
    );

    // V1 backwards-compatibility: override each org's onboarding_step with the
    // ORIGINAL formula so this endpoint's response shape never changes for
    // existing callers. The shared `getUserOrganizations` helper was recently
    // updated to (a) recognize `onboarding.team_members_invited` as a "step 4"
    // signal and (b) cap agency orgs at 3. Those are correct improvements
    // exposed by V3 endpoints (getUserV3, getOrganizationV3, getOnboardingStepV3),
    // but V1 `getUser` must keep returning what it always returned.
    //
    // Original formula: 0 → business_name → street_address → company_logo →
    // team_onboarding_completed. No agency cap, no team_members_invited check.
    let organizations = orgsFromHelper;
    if (orgsFromHelper.length > 0) {
      const orgIds = orgsFromHelper.map((o) => o.id);
      const { data: legacyOnboardingRows } = await supabase
        .from("onboarding")
        .select("organization_id, business_name, street_address, company_logo, team_onboarding_completed")
        .in("organization_id", orgIds);
      const legacyMap = new Map<string, any>();
      for (const row of legacyOnboardingRows ?? []) legacyMap.set(row.organization_id, row);

      organizations = orgsFromHelper.map((o) => {
        const ob = legacyMap.get(o.id);
        let onboarding_step = 0;
        if (ob) {
          if (ob.team_onboarding_completed) onboarding_step = 4;
          else if (ob.company_logo) onboarding_step = 3;
          else if (ob.street_address) onboarding_step = 2;
          else if (ob.business_name) onboarding_step = 1;
        }
        return { ...o, onboarding_step };
      });
    }

    // Prepare success response with user data
    const response = {
      status: "success",
      data: {
        id: targetAuthUser.id,
        email: targetAuthUser.email!,
        role: profile.role,
        full_name: profile.full_name,
        created_at: targetAuthUser.created_at,
        created_at_tz: enrichTimestamp(targetAuthUser.created_at, preferences.timezone),
        is_verified: !!targetAuthUser.email_confirmed_at,
        onboarding: profile.onboarding,
        auth_type: targetAuthUser.app_metadata.provider,
        is_super_admin: profile.is_super_admin || false,
        multi_org_enabled: profile.multi_org_enabled || false,
        active_organization_id: profile.active_organization_id || null,
        organizations,
      },
    };

    return successResponse(response, 200);

  } catch (error) {
    console.error("Unexpected error in getUser:", error);

    // Don't leak internal error details to the client
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
