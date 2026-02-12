import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { logCampaignHistory } from "../_shared/campaignHistory.ts";

/**
 * Delete Campaign Edge Function
 * Deletes a specific campaign by its ID
 *
 * Business Rules:
 * - Requires campaign ID in request body
 * - Organization-based (user must be in organization)
 * - Cascades deletion to campaign_history (due to ON DELETE CASCADE)
 * - Logs deletion action before removing campaign
 * - Removes campaign_id from campaigns_used array in all templates belonging to the organization
 * - Sets campaign_id to NULL in associated referrals (due to ON DELETE SET NULL)
 * - Returns success message after deletion
 */
Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow DELETE requests
  if (req.method !== "DELETE") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only DELETE method is allowed", 405);
  }

  try {
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

    // Validate required ID
    if (!id) {
      return errorResponse(
        "INVALID_INPUT",
        "Campaign ID is required",
        400
      );
    }

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

    // Check if campaign exists in user's organization
    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("id, referral_id")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .single();

    if (campaignError) {
      if (campaignError.code === "PGRST116") {
        return errorResponse(
          "CAMPAIGN_NOT_FOUND",
          "Campaign not found in your organization",
          404
        );
      }
      console.error("Error fetching campaign:", campaignError);
      return errorResponse(
        "CAMPAIGN_FETCH_FAILED",
        "Failed to fetch campaign",
        500
      );
    }

    // Log campaign history before deletion
    await logCampaignHistory(
      supabase,
      id,
      user.userId,
      user.userName,
      "deleted this campaign"
    );

    // Remove campaign ID from all templates' campaigns_used arrays in this organization
    // First, fetch all templates that have this campaign_id in their campaigns_used array
    const { data: templates, error: templatesError } = await supabase
      .from("templates")
      .select("id, campaigns_used")
      .eq("organization_id", organizationId)
      .contains("campaigns_used", [id]);

    if (templatesError) {
      console.error("Error fetching templates:", templatesError);
      // Don't fail the deletion, just log the error
      console.warn("Could not fetch templates for cleanup, continuing with deletion");
    }

    // Update each template to remove the campaign_id from campaigns_used
    if (templates && templates.length > 0) {
      for (const template of templates) {
        // Filter out the campaign_id from campaigns_used array
        const updatedCampaignsUsed = (template.campaigns_used as string[]).filter(
          (campaignId: string) => campaignId !== id
        );

        const { error: updateError } = await supabase
          .from("templates")
          .update({ campaigns_used: updatedCampaignsUsed })
          .eq("id", template.id);

        if (updateError) {
          console.error(`Error updating template ${template.id}:`, updateError);
          // Don't fail the deletion, just log the error
        }
      }
    }

    // Delete the campaign (campaign_history will be cascade deleted due to foreign key)
    // campaign_id in referrals will be set to NULL due to ON DELETE SET NULL
    const { error: deleteError } = await supabase
      .from("campaigns")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("Error deleting campaign:", deleteError);
      return errorResponse(
        "DELETE_FAILED",
        "Failed to delete campaign",
        500
      );
    }

    // Return success response
    return successResponse(
      {
        status: "success",
        message: "Campaign deleted successfully",
        data: {
          deleted_campaign_id: id
        }
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in deleteCampaign:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
