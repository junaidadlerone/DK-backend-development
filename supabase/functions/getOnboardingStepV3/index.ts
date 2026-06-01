import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { deriveOnboardingStepCount, getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Get Onboarding Step V3
 *
 * Returns the user's current onboarding progress in the V3 branched flow.
 * organization_type is inferred from `organizations.is_agency` on the primary org.
 *
 * `completed_step` is derived ONLY from the `onboarding` row via
 * `deriveOnboardingStepCount` so this endpoint always agrees with
 * `getUser.organizations[].onboarding_step` for the same org.
 *
 * V3 step 1 (choose org_type) intentionally does NOT bump the counter — it
 * leaves no field on the `onboarding` row, and `organizations.is_agency`
 * defaults to TRUE at signup so it can't distinguish "user explicitly picked
 * agency" from a fresh untouched account. The frontend should infer "type
 * already chosen" from `organizations.is_agency` directly when it needs to
 * skip the type-picker after a step-1 call.
 *
 *   Business (max 4):
 *     0 — onboarding row empty
 *     1 — onboarding.business_name set (V3 step 2 done)
 *     2 — onboarding.street_address set (V3 step 3 done)
 *     3 — onboarding.company_logo set (V3 step 4 in progress)
 *     4 — profiles.onboarding = true, or onboarding.team_onboarding_completed (V1 final)
 *
 *   Agency (max 3 — derived count is capped):
 *     0 — onboarding row empty
 *     1 — onboarding.business_name set (V3 agency step 2 done)
 *     3 — onboarding.team_members_invited = true (V3 agency step 3 FINAL)
 *         (the agency flow skips 2 because the V3 agency form doesn't have a
 *          street_address or company_logo step)
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
      .select("business_name, street_address, company_logo, team_onboarding_completed, team_members_invited")
      .eq("organization_id", primaryOrgId)
      .maybeSingle();

    const isAgency = primaryOrg.is_agency === true;
    const organization_type: "business" | "agency" = isAgency ? "agency" : "business";
    const finalStep = isAgency ? 3 : 4;

    // If onboarding is fully complete, short-circuit.
    if (profile?.onboarding === true) {
      return successResponse({
        organization_type,
        completed_step: finalStep,
        next_step: null,
      }, 200);
    }

    // Derive completed_step from the onboarding row using the shared helper,
    // capped at the flow's final step number. This guarantees this endpoint
    // and getUser.organizations[].onboarding_step always agree on the count.
    const rawStep = deriveOnboardingStepCount(primaryOnb);
    const completed_step = Math.min(rawStep, finalStep);
    const next_step: number | null = completed_step >= finalStep ? null : completed_step + 1;

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
