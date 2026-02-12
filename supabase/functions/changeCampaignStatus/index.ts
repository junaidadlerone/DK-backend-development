import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";

/**
 * Change Campaign Status Edge Function
 * Changes campaign status to Active and associated referral status to "In Use"
 *
 * Business Rules:
 * - Public access (no JWT auth required)
 * - Changes campaign status to Active
 * - Changes associated referral status to "In Use" (if referral exists)
 *
 * Request body:
 * {
 *   "campaign_id": "uuid"
 * }
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
    const supabase = createSupabaseClient();

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

    const { campaign_id } = body;

    // Validate campaign_id
    if (!campaign_id) {
      return errorResponse(
        "INVALID_INPUT",
        "campaign_id is required",
        400
      );
    }

    // Verify campaign exists and get referral_id
    const { data: campaign, error: fetchError } = await supabase
      .from("campaigns")
      .select("id, referral_id")
      .eq("id", campaign_id)
      .single();

    if (fetchError || !campaign) {
      return errorResponse(
        "CAMPAIGN_NOT_FOUND",
        "Campaign not found",
        404
      );
    }

    // Update campaign status to Active
    const { error: updateError } = await supabase
      .from("campaigns")
      .update({
        status: { id: "e5ec5c13-8194-4d1b-8765-e6be3734954c", name: "Active" },
        updated_at: new Date().toISOString()
      })
      .eq("id", campaign_id);

    if (updateError) {
      console.error("Error updating campaign status:", updateError);
      return errorResponse(
        "UPDATE_FAILED",
        "Failed to update campaign status",
        500
      );
    }

    // Update referral status to "In Use" if referral_id exists
    if (campaign.referral_id) {
      const { error: referralUpdateError } = await supabase
        .from("referrals")
        .update({
          status: { id: "cabe17d8-a7c8-4730-986f-bd0d87e44758", name: "In Use" }
        })
        .eq("id", campaign.referral_id);

      if (referralUpdateError) {
        console.error("Error updating referral status to In Use:", referralUpdateError);
        // Don't fail the request, just log the error
      }
    }

    return successResponse({
      status: "success",
      message: "Campaign status changed to Active successfully",
      campaign_id
    });

  } catch (error) {
    console.error("Unexpected error in changeCampaignStatus:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500
    );
  }
});
