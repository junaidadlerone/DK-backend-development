
import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

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

    // Get user's organization
    const organizationId = await getUserOrganizationId(supabase, user.userId);
    if (!organizationId) {
      return errorResponse(
        "NO_ORGANIZATION",
        "User is not associated with any organization",
        403
      );
    }

    // Check profile onboarding status first (Step 3 completion marker)
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("onboarding")
      .eq("id", user.userId)
      .single();

    if (profileError) {
      console.error("Error fetching profile:", profileError);
      return errorResponse("FETCH_FAILED", "Failed to fetch profile", 500);
    }

    // If profile.onboarding is true, Step 3 is complete
    if (profile.onboarding === true) {
      return successResponse({
        completed_step: 3,
        next_step: null
      }, 200);
    }

    // Fetch onboarding details for Steps 1, 2, and 3
    const { data: onboardingData, error: onboardingError } = await supabase
      .from("onboarding")
      .select("business_name, street_address, company_logo")
      .eq("organization_id", organizationId)
      .single();

    if (onboardingError && onboardingError.code !== 'PGRST116') { // Ignore not found error
      console.error("Error fetching onboarding data:", onboardingError);
      return errorResponse("FETCH_FAILED", "Failed to fetch onboarding data", 500);
    }

    let completed_step = 0;
    let next_step: number | null = 1;

    if (onboardingData) {
      // Check Step 3 (Branding)
      if (onboardingData.company_logo) {
        completed_step = 3;
        next_step = null;
      }
      // Check Step 2 (Address Info)
      else if (onboardingData.street_address) {
        completed_step = 2;
        next_step = 3;
      } 
      // Check Step 1 (Business Info)
      else if (onboardingData.business_name) {
        completed_step = 1;
        next_step = 2;
      }
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
