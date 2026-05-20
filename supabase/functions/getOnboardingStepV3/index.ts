import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Get Onboarding Step V3
 *
 * Returns the user's current onboarding progress in the V3 branched flow.
 * organization_type is inferred from `organizations.is_agency` on the primary org.
 *
 *   Business (4 steps):
 *     step 1 done — is_agency flag set (org_type chosen)
 *     step 2 done — primary org has business_name
 *     step 3 done — primary org has business_address
 *     step 4 done — primary org has branding_settings.logo  (FINAL)
 *
 *   Agency (5 steps):
 *     step 1 done — is_agency = true on primary org
 *     step 2 done — agency org has business_name (and optionally branding_settings.logo)
 *     step 3 done — onboarding.first_client_org_id is set
 *     step 4 done — client sub-org has business_address
 *     step 5 done — client sub-org has branding_settings.logo  (FINAL)
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
      .select("onboarding")
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
      .select("first_client_org_id")
      .eq("organization_id", primaryOrgId)
      .maybeSingle();

    const isAgency = primaryOrg.is_agency === true;
    const organization_type: "business" | "agency" = isAgency ? "agency" : "business";

    // If onboarding is fully complete, short-circuit.
    if (profile?.onboarding === true) {
      const finalStep = isAgency ? 5 : 4;
      return successResponse({
        organization_type,
        completed_step: finalStep,
        next_step: null,
      }, 200);
    }

    // Step 1 is implicitly done once an onboarding row exists. We assume yes
    // because getUserOrganizationId returned an org. For a stricter signal we
    // could check if is_agency was explicitly set by a step 1 call, but the
    // primary org always has is_agency (default TRUE on signup), so step 1
    // counts as done as soon as the user calls anything past it.
    let completed_step = 0;
    let next_step: number | null = 1;

    const hasOrgType = primaryOrg.business_name !== null && primaryOrg.business_name !== undefined
      ? true
      : false;

    if (isAgency) {
      const agencyHasName = !!primaryOrg.business_name;
      const agencyHasLogo = !!primaryOrg.branding_settings?.logo;
      const clientOrgId = primaryOnb?.first_client_org_id;

      // Step 1 — choosing organization_type. Done if is_agency was explicitly true
      // (default at signup is also TRUE so we can't strictly distinguish; treat as done).
      completed_step = 1;
      next_step = 2;

      if (agencyHasName) {
        completed_step = 2;
        next_step = 3;
      }
      if (clientOrgId) {
        completed_step = 3;
        next_step = 4;

        // Fetch client sub-org to check step 4 and 5.
        const { data: clientOrg } = await supabase
          .from("organizations")
          .select("business_address, branding_settings")
          .eq("id", clientOrgId)
          .single();

        if (clientOrg?.business_address) {
          completed_step = 4;
          next_step = 5;
        }
        if (clientOrg?.branding_settings?.logo) {
          completed_step = 5;
          next_step = null;
        }
      }

      return successResponse({
        organization_type,
        completed_step,
        next_step,
      }, 200);
    }

    // Business flow
    completed_step = 1;
    next_step = 2;

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
      organization_type,
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
