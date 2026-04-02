import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId, validateOrganizationAccess } from "../_shared/organization.ts";
import { logCampaignHistory } from "../_shared/campaignHistory.ts";

/**
 * Link QR Code to Campaign
 * 
 * Optional endpoint to add QR code tracking to a campaign via Linkly API.
 * Creates a shortened URL and saves it to the campaign's business_data.
 * 
 * Required Headers:
 * - x-linkly-api-key: Linkly API key
 * - x-linkly-workspace-id: Linkly workspace ID
 * 
 * Request Body:
 * - campaign_id: UUID of campaign
 * - qr_url: URL to shorten and use in QR code
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

    // Validation: Strict Role Check (Owner, ADMIN, MARKETER)
    const hasAccess = await validateOrganizationAccess(supabase, organizationId, user.userId);
    if (!hasAccess) {
      return errorResponse(
        "FORBIDDEN",
        "You do not have permission to link QR codes (requires ADMIN or MARKETER role)",
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

    const { campaign_id, qr_url } = body;

    // Validate required fields
    if (!campaign_id) {
      return errorResponse(
        "INVALID_INPUT",
        "campaign_id is required",
        400
      );
    }

    if (!qr_url || typeof qr_url !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "qr_url is required and must be a valid URL string",
        400
      );
    }

    // Verify campaign exists and belongs to organization
    const { data: existingCampaign, error: fetchError } = await supabase
      .from("campaigns")
      .select("id, campaign_name, business_data")
      .eq("id", campaign_id)
      .eq("organization_id", organizationId)
      .single();

    if (fetchError || !existingCampaign) {
      return errorResponse(
        "CAMPAIGN_NOT_FOUND",
        "Campaign not found in your organization",
        404
      );
    }

    const linklyApiKey = Deno.env.get("LINKLY_API_KEY");
    const linklyWorkspaceId = Deno.env.get("LINKLY_WORKSPACE_ID");

    if (!linklyApiKey) {
      return errorResponse(
        "MISSING_LINKLY_API_KEY",
        "LINKLY_API_KEY environment variable is not set",
        500
      );
    }

    if (!linklyWorkspaceId) {
      return errorResponse(
        "MISSING_LINKLY_WORKSPACE_ID",
        "LINKLY_WORKSPACE_ID environment variable is not set",
        500
      );
    }

    // Call Linkly API to create short link
    let shortenedUrl: string;
    let trackerId: number;

    try {
      const linklyResponse = await fetch(
        `https://app.linklyhq.com/api/v1/link?api_key=${encodeURIComponent(linklyApiKey)}`,
        {
          method: "POST",
          headers: {
            "accept": "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: qr_url,
            workspace_id: parseInt(linklyWorkspaceId),
          }),
        }
      );

      if (!linklyResponse.ok) {
        const errorText = await linklyResponse.text();
        console.error("Linkly API error:", errorText);
        return errorResponse(
          "LINKLY_API_ERROR",
          `Failed to create short link: ${errorText}`,
          500
        );
      }

      const linklyData = await linklyResponse.json();
      shortenedUrl = linklyData.full_url;
      trackerId = linklyData.id;

      console.log(`Created Linkly short link: ${shortenedUrl} (tracker ID: ${trackerId}) for QR URL: ${qr_url}`);
    } catch (error: unknown) {
      console.error("Error calling Linkly API:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return errorResponse(
        "LINKLY_API_ERROR",
        `Failed to create short link: ${errorMessage}`,
        500
      );
    }

    // Update campaign's business_data with shortened QR URL
    const businessData = existingCampaign.business_data || {};
    businessData.qr_url = shortenedUrl;

    const { data: updatedCampaign, error: updateError } = await supabase
      .from("campaigns")
      .update({
        business_data: businessData,
        postgrid_tracker_id: trackerId,
        updated_at: new Date().toISOString()
      })
      .eq("id", campaign_id)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating campaign:", updateError);
      return errorResponse(
        "UPDATE_FAILED",
        "Failed to update campaign with QR code",
        500
      );
    }

    // Log campaign history
    await logCampaignHistory(
      supabase,
      campaign_id,
      user.userId,
      user.userName,
      `linked QR code (shortened: ${shortenedUrl})`
    );

    return successResponse(
      {
        status: "success",
        message: "QR code linked to campaign successfully",
        data: {
          campaign_id: updatedCampaign.id,
          campaign_name: updatedCampaign.campaign_name,
          original_url: qr_url,
          shortened_url: shortenedUrl,
          tracker_id: trackerId,
          business_data: updatedCampaign.business_data
        },
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in linkQRCodeToCampaign:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
