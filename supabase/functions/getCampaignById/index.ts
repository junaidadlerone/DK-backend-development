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

    // Compute total_spent from payment_history (reflects coupons)
    const { data: paymentRows } = await supabase
      .from("payment_history")
      .select("amount_paid")
      .eq("campaign_id", id);
    const total_spent = paymentRows && paymentRows.length > 0
      ? paymentRows.reduce((sum: number, r: any) => sum + Number(r.amount_paid), 0)
      : (campaign.postcards_sent || 0) * 3;

    // Fetch user preferences
    const preferences = await getPreferences(supabase, user.userId);

    // Derive template_bundle_id from front + back template PostGrid IDs
    let template_bundle_id: string | null = null;
    if (campaign.front_template_id && campaign.back_template_id) {
      // Resolve PostGrid template IDs → internal template UUIDs
      const { data: templateRows } = await supabase
        .from("templates")
        .select("id, postgrid_template_id")
        .in("postgrid_template_id", [campaign.front_template_id, campaign.back_template_id]);

      if (templateRows && templateRows.length === 2) {
        const frontRow = templateRows.find((t: any) => t.postgrid_template_id === campaign.front_template_id);
        const backRow  = templateRows.find((t: any) => t.postgrid_template_id === campaign.back_template_id);

        if (frontRow && backRow) {
          const { data: bundle } = await supabase
            .from("template_bundles")
            .select("id")
            .eq("template_front_id", frontRow.id)
            .eq("template_back_id", backRow.id)
            .maybeSingle();

          template_bundle_id = bundle?.id ?? null;
        }
      }
    }

    return successResponse(
      {
        status: "success",
        message: "Campaign fetched successfully",
        data: {
          ...campaign,
          total_spent,
          image_url,
          template_bundle_id,
          start_date: campaign.offer_data?.start_date || null,
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
