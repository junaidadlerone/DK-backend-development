import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId, validateOrganizationAccess } from "../_shared/organization.ts";
import { logCampaignHistory } from "../_shared/campaignHistory.ts";
import { createPostGridTracker } from "../_shared/postgrid.ts";

 /**
 * Link QR Code to Campaign
 * 
 * Optional endpoint to add QR code tracking to a campaign via PostGrid Tracker API.
 * Creates a tracker and saves it to the campaign's business_data.
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

    // Call Postgrid API to create short link
    let trackerId: string;

    try {
      const tracker = await createPostGridTracker(qr_url);
      trackerId = tracker.id;
      
      // PostGrid PURLs are generated per-order, but we can store the tracker ID
      // The systems will use this tracker ID to resolve the QR in templates.
      // For digital emails, we'll use the pattern we verified: https://pgtrack.com/t/<tracker_id>/<order_id>
      // For now, we'll store the tracker ID. 
      // Linkly provided a static shortened URL, but PostGrid's is dynamic.
      // We'll set qr_url to a placeholder or the tracker ID to signify it's a PostGrid tracker.

      console.log(`Created PostGrid tracker: ${trackerId} for QR URL template: ${qr_url}`);
    } catch (error: unknown) {
      console.error("Error calling PostGrid API:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return errorResponse(
        "POSTGRID_API_ERROR",
        `Failed to create tracker: ${errorMessage}`,
        500
      );
    }

    // Update campaign's business_data with shortened QR URL
    const businessData = existingCampaign.business_data || {};
    businessData.qr_url = `${trackerId}.qrcode`;

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
      `linked QR code (tracker: ${trackerId})`
    );

    return successResponse(
      {
        status: "success",
        message: "QR code linked to campaign successfully",
        data: {
          campaign_id: updatedCampaign.id,
          campaign_name: updatedCampaign.campaign_name,
          original_url: qr_url,
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
