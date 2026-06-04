
import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId, validateOrganizationAccess } from "../_shared/organization.ts";

/**
 * Get Onboarding Step Edge Function
 * Returns the current progress of the user's onboarding
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

    // Get user from request
    const user = getUserFromRequest(req);
    if (!user) {
      return errorResponse(
        "UNAUTHORIZED",
        "Unable to authenticate user",
        401
      );
    }

    // Honor optional ?organization_id=... query param (frontend passes this to
    // read a specific org's onboarding step, e.g. a client sub-org rather than
    // the caller's active org). Falls back to the caller's active org.
    const url = new URL(req.url);
    const requestedOrgId = url.searchParams.get("organization_id");
    console.log("Request Org Id: "+requestedOrgId);
    let organizationId: string | null = null;
    if (requestedOrgId) {
      const hasAccess = await validateOrganizationAccess(supabase, requestedOrgId, user.userId);
      if (!hasAccess) {
        return errorResponse("FORBIDDEN", "You do not have access to this organization", 403);
      }
      organizationId = requestedOrgId;
    } else {
      organizationId = await getUserOrganizationId(supabase, user.userId);
    }
    if (!organizationId) {
      return errorResponse(
        "NO_ORGANIZATION",
        "User is not associated with any organization",
        403
      );
    }

    // Fetch the org + onboarding rows. Step logic mirrors
    // getAgencyOverview.computeStatus exactly — derived purely from these table
    // fields (NOT profiles.onboarding), so both endpoints agree for the same org.
    const [{ data: org, error: orgError }, { data: onb, error: onbError }] =
      await Promise.all([
        supabase
          .from("organizations")
          .select("business_name, business_address, branding_settings")
          .eq("id", organizationId)
          .maybeSingle(),
        supabase
          .from("onboarding")
          .select(
            "business_name, street_address, company_logo, team_onboarding_completed, team_members_invited",
          )
          .eq("organization_id", organizationId)
          .maybeSingle(),
      ]);

    if (orgError) {
      console.error("Error fetching organization:", orgError);
      return errorResponse("FETCH_FAILED", "Failed to fetch organization", 500);
    }
    if (onbError) {
      console.error("Error fetching onboarding data:", onbError);
      return errorResponse("FETCH_FAILED", "Failed to fetch onboarding data", 500);
    }

    // Onboarding is a 4-step procedure:
    //   1. Business info (business_name)
    //   2. Address info  (business_address / street_address)
    //   3. Branding      (company_logo)
    //   4. Team setup    (branding_settings.logo / team_onboarding_completed / team_members_invited)
    // completed_step = highest completed step (0–4); next_step = the next one, or null when done.
    const TOTAL = 4;
    let completed_step = 0;
    let next_step: number | null = 1;

    // Step 4 ("complete") — same "Active" condition as getAgencyOverview.
    const hasBranding = !!(org.branding_settings && org.branding_settings.logo);
    const teamDone = onb?.team_onboarding_completed === true;
    const teamInvited = onb?.team_members_invited === true;

    let isComplete = false
    if (hasBranding || teamDone || teamInvited) {
      isComplete = true;
    };

    if (isComplete) {
      completed_step = TOTAL;
      next_step = null;
    } else {
      if (org?.business_name || onb?.business_name) completed_step = 1;
      if (org?.business_address || onb?.street_address) completed_step = 2;
      if (onb?.company_logo) completed_step = 3;
      next_step = completed_step < TOTAL ? completed_step + 1 : null;
    }

    return successResponse({
      completed_step,
      next_step
    }, 200);

  } catch (error) {
    console.error("Unexpected error in getOnboardingStep:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
