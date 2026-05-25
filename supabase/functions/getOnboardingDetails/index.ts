import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId, validateOrganizationAccess } from "../_shared/organization.ts";

/**
 * Get Onboarding Details
 * Returns all information filled out by the user during onboarding steps.
 */

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST or GET method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();
    const user = getUserFromRequest(req);

    if (!user) {
      return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);
    }

    // Honor optional ?organization_id=... query param (frontend passes this to read
    // a specific org's onboarding state when editing a non-active org). Falls back
    // to the caller's active org when not provided.
    const url = new URL(req.url);
    const requestedOrgId = url.searchParams.get("organization_id");
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
      return errorResponse("NO_ORGANIZATION", "User is not associated with any organization", 403);
    }

    // Fetch onboarding details + the organization row (the org row holds
    // business_email, which completeOnboarding step 1 writes there but the
    // onboarding table has no column for).
    const [
      { data: onboardingData, error: onboardingError },
      { data: orgData, error: orgError },
    ] = await Promise.all([
      supabase
        .from("onboarding")
        .select("*")
        .eq("organization_id", organizationId)
        .single(),
      supabase
        .from("organizations")
        .select("business_email")
        .eq("id", organizationId)
        .single(),
    ]);

    // It's possible onboarding entry doesn't exist if they haven't started step 1
    // But usually created at signup or step 1.
    // If error, we might return empty or partial.
    if (onboardingError && onboardingError.code !== "PGRST116") {
       console.error("Error fetching onboarding:", onboardingError);
       return errorResponse("DATABASE_ERROR", "Failed to fetch onboarding details", 500);
    }

    // orgError is non-fatal — business_email is optional. Just log it.
    if (orgError && orgError.code !== "PGRST116") {
      console.error("Error fetching organization for business_email:", orgError);
    }

    // Fetch profile for theme settings
    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("branding_settings")
      .eq("id", user.userId)
      .single();

    if (profileError) {
      console.error("Error fetching profile:", profileError);
      return errorResponse("DATABASE_ERROR", "Failed to fetch profile details", 500);
    }

    // Construct response
    const response: any = {
      step_1: {},
      step_2: {},
      step_3: {}
    };

    if (onboardingData) {
      response.step_1 = {
        business_name: onboardingData.business_name,
        industry: onboardingData.business_industry,
        business_phone_number: onboardingData.business_phone_number,
        business_email: orgData?.business_email ?? null,
        website_url: onboardingData.website_url
      };

      response.step_2 = {
        country: onboardingData.country,
        street_address: onboardingData.street_address,
        city: onboardingData.city,
        state: onboardingData.state,
        zip: onboardingData.zip
      };

      // Logo is technically part of step 3
      response.step_3.company_logo = onboardingData.company_logo;
    }

    if (profileData && profileData.branding_settings && profileData.branding_settings.theme) {
      response.step_3.theme = profileData.branding_settings.theme;
    }

    // Also flatten structure to match completeOnboarding input if desired?
    // User said "return all information user fills out".
    // A structured response by step is clearer, but flattened is closer to input.
    // I will return a flattened object that matches 'completeOnboarding' input keys, 
    // but maybe grouped or just all keys?
    // "this will basically return all the information user fills out using the three steps"
    // The input to completeOnboarding is one object per step.
    // I'll return a single object with all keys.

    const flatResponse: any = {
      // Step 1
      business_name: onboardingData?.business_name || null,
      industry: onboardingData?.business_industry || null,
      business_phone_number: onboardingData?.business_phone_number || null,
      business_email: orgData?.business_email ?? null,
      website_url: onboardingData?.website_url || null,

      // Step 2
      country: onboardingData?.country || null,
      street_address: onboardingData?.street_address || null,
      city: onboardingData?.city || null,
      state: onboardingData?.state || null,
      zip: onboardingData?.zip || null,

      // Step 3
      company_logo: onboardingData?.company_logo || null,
      theme: profileData?.branding_settings?.theme || null
    };

    return successResponse({
      status: "success",
      data: flatResponse
    }, 200);

  } catch (error: any) {
    console.error("Unexpected error in getOnboardingDetails:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message || String(error)}`,
      500
    );
  }
});
