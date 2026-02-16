import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId, validateOrganizationAccess } from "../_shared/organization.ts";
import { logCampaignHistory } from "../_shared/campaignHistory.ts";

/**
 * Edit Campaign V2 Edge Function
 * Allows editing campaign details after creation.
 * Supports updating: campaign_name, referral_id, disclaimer_text, start_date.
 *
 * Request body:
 * {
 *   "campaign_id": "uuid",
 *   "campaign_name": "New Name",
 *   "referral_id": "uuid" | null,
 *   "disclaimer_text": "text",
 *   "start_date": "ISO8601 date string"
 * }
 */

interface RequestBody {
  campaign_id: string;
  campaign_name?: string;
  referral_id?: string | null;
  disclaimer_text?: string;
  start_date?: string;
}

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
        "You do not have permission to edit campaigns (requires ADMIN or MARKETER role)",
        403
      );
    }

    // Parse request body
    let body: RequestBody;
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

    const { campaign_id, campaign_name, referral_id, disclaimer_text, start_date } = body;

    // Validate campaign_id
    if (!campaign_id) {
      return errorResponse(
        "INVALID_INPUT",
        "campaign_id is required",
        400
      );
    }

    // Fetch existing campaign to verify ownership and get current state
    const { data: existingCampaign, error: fetchError } = await supabase
      .from("campaigns")
      .select("id, campaign_name, referral_id, offer_data")
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

    // Prepare update object
    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    const historyLogs: string[] = [];

    // Handle Campaign Name Update
    if (campaign_name !== undefined) {
      if (typeof campaign_name !== 'string' || campaign_name.trim() === '') {
        return errorResponse("INVALID_INPUT", "campaign_name must be a valid string", 400);
      }
      if (campaign_name !== existingCampaign.campaign_name) {
        updateData.campaign_name = campaign_name.trim();
        historyLogs.push(`changed name to "${campaign_name}"`);
      }
    }

    // Handle Start Date Update (inside offer_data)
    if (start_date !== undefined) {
      const currentOfferData = updateData.offer_data || existingCampaign.offer_data || {};
      const newOfferData = {
        ...currentOfferData,
        start_date: start_date
      };
      
      // Check if actually changed
      if (currentOfferData.start_date !== start_date) {
        updateData.offer_data = newOfferData;
        historyLogs.push(`changed start date to ${start_date}`);
      }
    }

    // Handle Disclaimer Text Update (inside offer_data)
    if (disclaimer_text !== undefined) {
      const currentOfferData = updateData.offer_data || existingCampaign.offer_data || {};
      const newOfferData = {
        ...currentOfferData,
        disclaimer_text: disclaimer_text
      };
      
      // Check if actually changed
      if (currentOfferData.disclaimer_text !== disclaimer_text) {
        updateData.offer_data = newOfferData;
        historyLogs.push("updated disclaimer text");
      }
    }

    // Handle Referral logic
    // We only perform referral logic if referral_id is explicitly provided (including null)
    let referralChanged = false;
    if (referral_id !== undefined) {
      // Check if changed
      if (referral_id !== existingCampaign.referral_id) {
        
        // 1. If linking a new referral (referral_id is a UUID)
        if (referral_id) {
          // Verify new referral exists and belongs to org
          const { data: newReferral, error: referralError } = await supabase
            .from("referrals")
            .select("id, status")
            .eq("id", referral_id)
            .eq("organization_id", organizationId)
            .single();

          if (referralError || !newReferral) {
            return errorResponse(
              "REFERRAL_NOT_FOUND",
              "New referral not found in your organization",
              404
            );
          }

          // Unlink CURRENT referral if exists
          if (existingCampaign.referral_id) {
            await supabase
              .from("referrals")
              .update({ campaign_id: null, status: { id: "draft_status_id", name: "Draft" } }) // Resetting status to Draft? Or keeping it?
              // Logic: If referral is unlinked from campaign, it goes back to Draft? Or stays as is?
              // The create logic sets status to "Ready".
              // Let's assume decoupling might need status update? Or just campaign_id=null.
              // Safest: set campaign_id = null. Status might vary. Let's just unlink.
              .update({ campaign_id: null })
              .eq("id", existingCampaign.referral_id);
          }

          // Link NEW referral
          const { error: linkError } = await supabase
            .from("referrals")
            .update({
              campaign_id: campaign_id,
              status: { id: "4d1ca79a-1a0a-4c9f-a183-6c5bebd13336", name: "Ready" } // Set to Ready as per create logic
            })
            .eq("id", referral_id);

          if (linkError) {
             console.error("Error linking new referral:", linkError);
             return errorResponse("UPDATE_FAILED", "Failed to link new referral", 500);
          }
          
          updateData.referral_id = referral_id;
          historyLogs.push(`linked referral ${referral_id}`);
          referralChanged = true;

        } else {
          // 2. Unlinking (referral_id is null)
           if (existingCampaign.referral_id) {
             // Unlink updated referral
             await supabase
               .from("referrals")
               .update({ campaign_id: null })
               .eq("id", existingCampaign.referral_id);
               
             updateData.referral_id = null;
             historyLogs.push("unlinked referral");
             referralChanged = true;
           }
        }
      }
    }

    // Perform Update on Campaign if changes exist
    let updatedCampaign = existingCampaign;
    if (Object.keys(updateData).length > 1 || referralChanged) { // >1 because updated_at is always there
       const { data: updated, error: updateError } = await supabase
         .from("campaigns")
         .update(updateData)
         .eq("id", campaign_id)
         .select()
         .single();
         
       if (updateError) {
         console.error("Error updating campaign:", updateError);
         return errorResponse("UPDATE_FAILED", "Failed to update campaign", 500);
       }
       updatedCampaign = updated;
       
       // Log history
       if (historyLogs.length > 0) {
         await logCampaignHistory(
           supabase,
           campaign_id,
           user.userId,
           user.userName,
           `updated campaign: ${historyLogs.join(", ")}`
         );
       }
    }

    // Return updated campaign
    return successResponse({
      status: "success",
      message: "Campaign updated successfully",
      data: updatedCampaign
    });

  } catch (error) {
    console.error("Unexpected error in editCampaignV2:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
