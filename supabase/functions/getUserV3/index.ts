import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient, getUserProfile, isAdmin } from "../_shared/client.ts";
import { getUserPreferences } from "../_shared/preferences.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { isAgencyUser } from "../_shared/agencyGate.ts";

/**
 * getUserV3 — agency-gated user read with FULL organization details per accessible org.
 *
 * Differs from V1 `getUser`:
 *   - Caller must be an agency user (OWNER/ADMIN of an is_agency=true org).
 *   - Each entry in `organizations` includes ALL columns from the organizations table
 *     (business_name, industry, business_address, phone_number, website_url, is_agency,
 *      branding_settings, deletion_scheduled_at, created_at, updated_at, etc.)
 *     plus augmented `role`, `is_active`, `onboarding_step`.
 *   - `organization_members` is stripped from each entry (security).
 *
 * V1 getUser is preserved unchanged.
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only GET method is allowed", 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse("UNAUTHORIZED", "Authorization header is required", 401);
    }
    const token = authHeader.replace("Bearer ", "");
    if (!token) return errorResponse("INVALID_TOKEN", "Invalid authorization token", 401);

    const supabase = createSupabaseClient();
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authUser) {
      return errorResponse("INVALID_TOKEN", "Invalid or expired token", 401);
    }

    // Gate: caller must be an agency user.
    if (!(await isAgencyUser(supabase, authUser.id))) {
      return errorResponse(
        "NOT_AGENCY_USER",
        "Only agency users can call V3 endpoints. Use V1 getUser otherwise.",
        403,
      );
    }

    // Resolve target user (admin can request another user's data).
    const url = new URL(req.url);
    const requestedUserId = url.searchParams.get("user_id");
    let targetUserId = authUser.id;
    if (requestedUserId && requestedUserId !== authUser.id) {
      const userIsAdmin = await isAdmin(authUser.id);
      if (!userIsAdmin) {
        return errorResponse("FORBIDDEN", "Only ADMIN users can view other users' profiles", 403);
      }
      targetUserId = requestedUserId;
    }

    const { data: { user: targetAuthUser }, error: targetAuthError } =
      await supabase.auth.admin.getUserById(targetUserId);
    if (targetAuthError || !targetAuthUser) {
      return errorResponse("USER_NOT_FOUND", "User not found", 404);
    }

    const profile = await getUserProfile(targetUserId);
    if (!profile) {
      return errorResponse(
        "PROFILE_NOT_FOUND",
        "User profile not found. Please contact support.",
        404,
      );
    }

    const preferences = await getUserPreferences(supabase, authUser.id);

    // Fetch every org the target user belongs to (owner OR member) with FULL columns.
    // We pull all orgs and filter in JS because contains() against a JSONB array
    // requires more complex querying and the org table is small.
    const { data: allOrgs, error: orgsErr } = await supabase
      .from("organizations")
      .select("*");
    if (orgsErr) {
      console.error("getUserV3: org fetch error", orgsErr);
      return errorResponse("FETCH_FAILED", "Failed to load organizations", 500);
    }

    // Onboarding data for onboarding_step derivation (one batched query).
    const { data: onboardingRows } = await supabase
      .from("onboarding")
      .select("organization_id, business_name, street_address, company_logo, team_onboarding_completed");
    const onboardingMap = new Map<string, any>();
    for (const row of onboardingRows ?? []) onboardingMap.set(row.organization_id, row);

    const activeOrgId = profile.active_organization_id ?? null;

    const organizations = [];
    for (const org of allOrgs || []) {
      let role: "OWNER" | "ADMIN" | "MARKETER" | "TECHNICIAN" | null = null;
      if (org.owner_id === targetUserId) {
        role = "OWNER";
      } else {
        const members = Array.isArray(org.organization_members) ? org.organization_members : [];
        const m = members.find((x: any) => x?.member_uid === targetUserId);
        if (m) role = m.member_role;
      }
      if (!role) continue;

      // Non-owners can't see orgs pending deletion.
      if (org.deletion_scheduled_at && role !== "OWNER") continue;

      // Derive onboarding_step from the onboarding row.
      const ob = onboardingMap.get(org.id);
      let onboarding_step = 0;
      if (ob) {
        if (ob.team_onboarding_completed) onboarding_step = 4;
        else if (ob.company_logo) onboarding_step = 3;
        else if (ob.street_address) onboarding_step = 2;
        else if (ob.business_name) onboarding_step = 1;
      }

      // Strip organization_members (other users' UIDs) before returning.
      const { organization_members: _omit, ...orgRest } = org;
      organizations.push({
        ...orgRest,
        role,
        is_active: org.id === activeOrgId,
        onboarding_step,
      });
    }

    return successResponse({
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
        auth_type: targetAuthUser.app_metadata?.provider,
        is_super_admin: profile.is_super_admin || false,
        multi_org_enabled: profile.multi_org_enabled || false,
        active_organization_id: activeOrgId,
        // Snapshot of the admin profile that invited this user (stored by createUser/createUserV3).
        // Null for users created before created_by tracking existed.
        created_by: (profile as any).created_by ?? null,
        organizations,
      },
    }, 200);
  } catch (error) {
    console.error("Unexpected error in getUserV3:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500,
    );
  }
});
