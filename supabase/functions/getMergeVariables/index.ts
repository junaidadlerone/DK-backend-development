import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Get Merge Variables Edge Function
 * Returns merge variables for a campaign (business info + disclaimer)
 *
 * GET /getMergeVariables?campaign_id=...
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

    // Parse query params
    const url = new URL(req.url);
    const campaign_id = url.searchParams.get("campaign_id");

    if (!campaign_id) {
      return errorResponse(
        "INVALID_INPUT",
        "campaign_id is required",
        400
      );
    }

    // Fetch Campaign to get disclaimer (and verify ownership)
    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("offer_data")
      .eq("id", campaign_id)
      .eq("organization_id", organizationId) // Ensure ownership
      .single();

    if (campaignError || !campaign) {
      return errorResponse(
        "CAMPAIGN_NOT_FOUND",
        "Campaign not found in your organization",
        404
      );
    }

    // Fetch Organization details
    const { data: organization, error: orgError } = await supabase
      .from("organizations")
      .select("business_name, phone_number, website_url")
      .eq("id", organizationId)
      .single();

    if (orgError || !organization) {
      console.error("Error fetching organization:", orgError);
       return errorResponse("FETCH_FAILED", "Failed to fetch organization details", 500);
    }

    // Construct response
    const responseData = {
      business_name: organization.business_name || "",
      business_phone_number: organization.phone_number || "", // Map phone_number to business_phone_number
      website_url: organization.website_url || "",
      disclaimer_text: campaign.offer_data?.disclaimer_text || ""
    };

    return successResponse(
      {
        status: "success",
        message: "Merge variables fetched successfully",
        data: responseData
      },
      200
    );

  } catch (error) {
    console.error("Unexpected error in getMergeVariables:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
