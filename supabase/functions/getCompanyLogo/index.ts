
import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  if (req.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only GET method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();
    const user = getUserFromRequest(req);
    
    if (!user) {
      return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);
    }

    const organizationId = await getUserOrganizationId(supabase, user.userId);
    if (!organizationId) {
      return errorResponse("NO_ORGANIZATION", "User is not associated with any organization", 403);
    }

    const { data: onboardingData, error } = await supabase
      .from("onboarding")
      .select("company_logo")
      .eq("organization_id", organizationId)
      .single();

    if (error) {
      // If no onboarding record, return null logo
      if (error.code === 'PGRST116') {
         return successResponse({ company_logo: null });
      }
      return errorResponse("FETCH_FAILED", "Failed to fetch company logo", 500);
    }

    return successResponse({
      company_logo: onboardingData.company_logo || null
    });

  } catch (error) {
    console.error("Unexpected error:", error);
    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
});
