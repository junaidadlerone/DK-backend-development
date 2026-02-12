import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { getImageUrlForReferral } from "../_shared/imageHelpers.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { getPreferences } from "../_shared/preferences.ts";

/**
 * Get Campaign By ID Edge Function
 * Returns complete campaign information by campaign ID
 *
 * Business Rules:
 * - Requires campaign ID in request body
 * - Organization-based (user must be in organization)
 * - Returns full campaign data
 */
Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow POST requests
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed", 405);
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

    // Parse request body
    let body: any;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      return errorResponse(
        "INVALID_INPUT",
        "Invalid JSON format in request body",
        400
      );
    }

    const { id } = body;

    // Validate campaign ID
    if (!id) {
      return errorResponse(
        "INVALID_INPUT",
        "id is required",
        400
      );
    }

    // Fetch campaign
    const { data: campaign, error: fetchError } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .single();

    if (fetchError) {
      if (fetchError.code === "PGRST116") {
        return errorResponse(
          "CAMPAIGN_NOT_FOUND",
          "Campaign not found in your organization",
          404
        );
      }
      console.error("Error fetching campaign:", fetchError);
      return errorResponse(
        "FETCH_FAILED",
        "Failed to fetch campaign",
        500
      );
    }

    // Fetch image_url from referral's gallery
    const image_url = await getImageUrlForReferral(supabase, campaign.referral_id);

    // Fetch user preferences
    const preferences = await getPreferences(supabase, user.userId);

    return successResponse(
      {
        status: "success",
        message: "Campaign fetched successfully",
        data: {
          ...campaign,
          image_url,
          created_at_tz: enrichTimestamp(campaign.created_at, preferences.timezone),
          updated_at_tz: enrichTimestamp(campaign.updated_at, preferences.timezone)
        },
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in getCampaignById:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
