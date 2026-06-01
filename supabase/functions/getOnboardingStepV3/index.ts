import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Get Onboarding Step V3
 *
 * Returns the user's current onboarding progress in the V3 branched flow.
 *
 * Step 1 (choose org_type) detection uses real signals, not the `is_agency`
 * default. A fresh signup has `is_agency = true` (default) and
 * `multi_org_enabled = false`, indistinguishable from "agency-type but no
 * step 1 yet" if we look at is_agency alone. Real signals:
 *
 *   - Agency step 1 done — `profiles.multi_org_enabled = true`
 *       (V3 step 1 for agency flips this from false; default false)
 *   - Business step 1 done — `organizations.is_agency = false`
 *       (default is TRUE; V3 step 1 for business flips it to false)
 *   - Neither — step 0, `organization_type: null`, frontend shows type-picker
 *
 *   Business (4 steps):
 *     step 1 done — `is_agency = false` on primary org (explicitly set by step 1)
 *     step 2 done — primary org has business_name
 *     step 3 done — primary org has business_address
 *     step 4 done — primary org has branding_settings.logo  (FINAL)
 *
 *   Agency (3 steps):
 *     step 1 done — profile.multi_org_enabled = true
 *     step 2 done — agency org has business_name
 *     step 3 done — onboarding.team_members_invited = true  (FINAL)
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only GET method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();
    const user = getUserFromRequest(req);
    if (!user) return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);

    const primaryOrgId = await getUserOrganizationId(supabase, user.userId);
    if (!primaryOrgId) {
      return errorResponse(
        "NO_ORGANIZATION",
        "User is not associated with any organization",
        403,
      );
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarding, multi_org_enabled")
      .eq("id", user.userId)
      .single();

    const { data: primaryOrg } = await supabase
      .from("organizations")
      .select("id, is_agency, business_name, business_address, branding_settings")
      .eq("id", primaryOrgId)
      .single();

    if (!primaryOrg) {
      return errorResponse("FETCH_FAILED", "Failed to fetch organization", 500);
    }

    const { data: primaryOnb } = await supabase
      .from("onboarding")
      .select("team_members_invited")
      .eq("organization_id", primaryOrgId)
      .maybeSingle();

    // Step 1 — choose org type — completion detection using real signals.
    // `is_agency` defaults to TRUE at signup so it alone can't tell us if
    // step 1 was actually called. multi_org_enabled (agency signal) and
    // explicit is_agency=false (business signal) are the positive proofs.
    const isBusinessConfirmed = primaryOrg.is_agency === false;
    const isAgencyConfirmed = primaryOrg.is_agency === true && profile?.multi_org_enabled === true;
    const step1Done = isBusinessConfirmed || isAgencyConfirmed;

    // organization_type is null until step 1 is actually completed. Frontend
    // uses null as "show the type-picker".
    const organization_type: "business" | "agency" | null = isBusinessConfirmed
      ? "business"
      : isAgencyConfirmed
      ? "agency"
      : null;

    // If onboarding is fully complete, short-circuit. (At this point we know
    // step 1 was done because profile.onboarding only flips at the FINAL step.)
    if (profile?.onboarding === true) {
      const finalStep = isAgencyConfirmed ? 3 : 4;
      return successResponse({
        organization_type: organization_type ?? (isAgencyConfirmed ? "agency" : "business"),
        completed_step: finalStep,
        next_step: null,
      }, 200);
    }

    // Step 1 not yet done → show type-picker.
    if (!step1Done) {
      return successResponse({
        organization_type: null,
        completed_step: 0,
        next_step: 1,
      }, 200);
    }

    // From here on, step 1 IS done; derive step 2+ from the usual fields.
    let completed_step = 1;
    let next_step: number | null = 2;

    if (isAgencyConfirmed) {
      const agencyHasName = !!primaryOrg.business_name;
      const teamInvited = primaryOnb?.team_members_invited === true;

      if (agencyHasName) {
        completed_step = 2;
        next_step = 3;
      }
      if (teamInvited) {
        completed_step = 3;
        next_step = null;
      }

      return successResponse({
        organization_type: "agency",
        completed_step,
        next_step,
      }, 200);
    }

    // Business flow
    if (primaryOrg.business_name) {
      completed_step = 2;
      next_step = 3;
    }
    if (primaryOrg.business_address) {
      completed_step = 3;
      next_step = 4;
    }
    if (primaryOrg.branding_settings?.logo) {
      completed_step = 4;
      next_step = null;
    }

    return successResponse({
      organization_type: "business",
      completed_step,
      next_step,
    }, 200);
  } catch (error: any) {
    console.error("Unexpected error in getOnboardingStepV3:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error?.message || String(error)}`,
      500,
    );
  }
});
