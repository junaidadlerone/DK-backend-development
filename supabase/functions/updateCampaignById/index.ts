import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { logCampaignHistory } from "../_shared/campaignHistory.ts";
import { getImageUrlForReferral } from "../_shared/imageHelpers.ts";
import { createNotification, ROLES } from "../_shared/notifications.ts";

/**
 * Update Campaign By ID Edge Function
 * Updates a specific campaign by its ID with proper validation
 *
 * Business Rules:
 * - Requires campaign ID in request body
 * - Can update any field except ID and organization_id
 * - Validates nested JSON structures (status, offer_data, business_data)
 * - Supports merge_variable in business_data as JSON object for mail merge operations
 * - Updates the updated_at timestamp automatically
 * - Organization-based (user must be in organization)
 * - Logs all changes to campaign_history
 */
Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow PATCH/PUT requests
  if (req.method !== "PATCH" && req.method !== "PUT") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only PATCH or PUT methods are allowed", 405);
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

    const { id, ...updateData } = body;

    // Validate required ID
    if (!id) {
      return errorResponse(
        "INVALID_INPUT",
        "Campaign ID is required",
        400
      );
    }

    // Validate that there's something to update
    if (Object.keys(updateData).length === 0) {
      return errorResponse(
        "INVALID_INPUT",
        "No update data provided",
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

    // First, fetch the existing campaign (must be in user's organization)
    const { data: existingCampaign, error: fetchError } = await supabase
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

    // Prepare update object
    const updatedFields: any = {};
    const changes: string[] = [];

    // Handle referral_id updates
    if (updateData.referral_id !== undefined) {
      updatedFields.referral_id = updateData.referral_id;
      changes.push("changed referral");
    }

    // Handle campaign_name updates
    if (updateData.campaign_name !== undefined) {
      if (typeof updateData.campaign_name !== 'string') {
        return errorResponse(
          "INVALID_INPUT",
          "campaign_name must be a string",
          400
        );
      }
      updatedFields.campaign_name = updateData.campaign_name.trim();
      changes.push(`changed campaign name to "${updateData.campaign_name.trim()}"`);
    }

    // Handle status updates
    if (updateData.status !== undefined) {
      if (typeof updateData.status === 'string') {
        // If status is a string, fetch the status from campaign_status_types
        const { data: statusData, error: statusError } = await supabase
          .from("campaign_status_types")
          .select("id, name")
          .eq("name", updateData.status)
          .single();

        if (statusError || !statusData) {
          return errorResponse(
            "INVALID_STATUS",
            `Invalid status: ${updateData.status}`,
            400
          );
        }

        updatedFields.status = {
          id: statusData.id,
          name: statusData.name
        };
        changes.push(`changed status to ${statusData.name}`);
      } else if (typeof updateData.status === 'object' && !Array.isArray(updateData.status)) {
        // If status is an object, use it directly
        updatedFields.status = updateData.status;
        changes.push(`changed status to ${updateData.status.name || 'unknown'}`);
      } else {
        return errorResponse(
          "INVALID_INPUT",
          "Status must be a string or JSON object",
          400
        );
      }
    }

    // Handle current_step updates
    if (updateData.current_step !== undefined) {
      if (typeof updateData.current_step !== 'number') {
        return errorResponse(
          "INVALID_INPUT",
          "current_step must be a number",
          400
        );
      }
      updatedFields.current_step = updateData.current_step;
      changes.push(`changed current step to ${updateData.current_step}`);
    }

    // Handle front_template_id updates
    if (updateData.front_template_id !== undefined) {
      updatedFields.front_template_id = updateData.front_template_id;
      changes.push("changed front template");
    }

    // Handle back_template_id updates
    if (updateData.back_template_id !== undefined) {
      updatedFields.back_template_id = updateData.back_template_id;
      changes.push("changed back template");
    }

    // Handle zone_id updates
    if (updateData.zone_id !== undefined) {
      // Verify zone exists and belongs to this organization
      const { data: zone, error: zoneError } = await supabase
        .from("location_zones")
        .select("*")
        .eq("id", updateData.zone_id)
        .eq("organization_id", organizationId)
        .single();

      if (zoneError || !zone) {
        return errorResponse(
          "ZONE_NOT_FOUND",
          "Zone not found in your organization",
          404
        );
      }

      // If zone belongs to a different campaign, duplicate it for this campaign
      let finalZoneId = updateData.zone_id;
      if (zone.campaign_id !== id) {
        // Create a duplicate zone for this campaign
        const { data: newZone, error: duplicateError } = await supabase
          .from("location_zones")
          .insert({
            campaign_id: id,
            organization_id: organizationId,
            center: zone.center,
            mode: zone.mode,
            search_type: zone.search_type,
            metadata: zone.metadata,
            addresses: zone.addresses
          })
          .select("id")
          .single();

        if (duplicateError || !newZone) {
          console.error("Error duplicating zone:", duplicateError);
          return errorResponse(
            "DUPLICATE_ZONE_FAILED",
            "Failed to duplicate zone for this campaign",
            500
          );
        }

        finalZoneId = newZone.id;
        console.log(`Duplicated zone ${updateData.zone_id} to new zone ${finalZoneId} for campaign ${id}`);
      }

      updatedFields.zone_id = finalZoneId;
      changes.push("changed location zone");
    }

    // Handle offer_data updates
    if (updateData.offer_data !== undefined) {
      // Validate that offer_data is an object
      if (typeof updateData.offer_data !== 'object' || Array.isArray(updateData.offer_data)) {
        return errorResponse(
          "INVALID_INPUT",
          "offer_data must be a JSON object",
          400
        );
      }
      updatedFields.offer_data = {
        ...existingCampaign.offer_data,
        ...updateData.offer_data
      };
      changes.push("updated offer data");
    }

    // Handle business_data updates
    if (updateData.business_data !== undefined) {
      // Validate that business_data is an object
      if (typeof updateData.business_data !== 'object' || Array.isArray(updateData.business_data)) {
        return errorResponse(
          "INVALID_INPUT",
          "business_data must be a JSON object",
          400
        );
      }

      // Validate merge_variable if provided
      if (updateData.business_data.merge_variable !== undefined && updateData.business_data.merge_variable !== null) {
        if (typeof updateData.business_data.merge_variable !== 'object' || Array.isArray(updateData.business_data.merge_variable)) {
          return errorResponse(
            "INVALID_INPUT",
            "merge_variable must be a JSON object",
            400
          );
        }
      }

      updatedFields.business_data = {
        ...existingCampaign.business_data,
        ...updateData.business_data
      };
      changes.push("updated business data");
    }

    // Handle additional_data updates
    if (updateData.additional_data !== undefined) {
      // Validate that additional_data is an object
      if (typeof updateData.additional_data !== 'object' || Array.isArray(updateData.additional_data)) {
        return errorResponse(
          "INVALID_INPUT",
          "additional_data must be a JSON object",
          400
        );
      }
      updatedFields.additional_data = {
        ...existingCampaign.additional_data,
        ...updateData.additional_data
      };
      changes.push("updated additional data");
    }

    // Handle metrics updates
    if (updateData.postcards_sent !== undefined) {
      if (typeof updateData.postcards_sent !== 'number') {
        return errorResponse(
          "INVALID_INPUT",
          "postcards_sent must be a number",
          400
        );
      }
      updatedFields.postcards_sent = updateData.postcards_sent;
      changes.push("updated postcards sent");
    }

    if (updateData.scan_rate !== undefined) {
      if (typeof updateData.scan_rate !== 'number') {
        return errorResponse(
          "INVALID_INPUT",
          "scan_rate must be a number",
          400
        );
      }
      updatedFields.scan_rate = updateData.scan_rate;
      changes.push("updated scan rate");
    }

    if (updateData.leads_gen !== undefined) {
      if (typeof updateData.leads_gen !== 'number') {
        return errorResponse(
          "INVALID_INPUT",
          "leads_gen must be a number",
          400
        );
      }
      updatedFields.leads_gen = updateData.leads_gen;
      changes.push("updated leads generated");
    }

    if (updateData.total_spent !== undefined) {
      if (typeof updateData.total_spent !== 'number') {
        return errorResponse(
          "INVALID_INPUT",
          "total_spent must be a number",
          400
        );
      }
      updatedFields.total_spent = updateData.total_spent;
      changes.push("updated total spent");
    }

    if (updateData.roi !== undefined) {
      if (typeof updateData.roi !== 'number') {
        return errorResponse(
          "INVALID_INPUT",
          "roi must be a number",
          400
        );
      }
      updatedFields.roi = updateData.roi;
      changes.push("updated ROI");
    }

    // Add updated_at timestamp
    updatedFields.updated_at = new Date().toISOString();

    // Update the campaign
    const { data: updatedCampaign, error: updateError } = await supabase
      .from("campaigns")
      .update(updatedFields)
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating campaign:", updateError);
      return errorResponse(
        "UPDATE_FAILED",
        "Failed to update campaign",
        500
      );
    }

    // Log campaign history
    if (changes.length > 0) {
      const action = changes.join(", ");
      await logCampaignHistory(
        supabase,
        id,
        user.userId,
        user.userName,
        action
      );
    }

    // Create notification for status change (for MARKETER and ADMIN)
    if (updateData.status !== undefined) {
      const newStatus = typeof updateData.status === 'string' ? updateData.status : updateData.status.name;
      const campaignName = existingCampaign.campaign_name || `Campaign ${id.substring(0, 8)}`;

      await createNotification({
        supabase,
        organizationId,
        notificationType: "CAMPAIGN_STATUS_CHANGED",
        title: "Campaign Status Changed",
        description: `Campaign "${campaignName}" status changed to "${newStatus}"`,
        targetRoles: ROLES.MARKETER_AND_ADMIN,
        metadata: {
          campaign_id: id,
          campaign_name: campaignName,
          old_status: existingCampaign.status?.name || "Unknown",
          new_status: newStatus
        }
      });
    }

    // Fetch image_url from referral's gallery
    const image_url = await getImageUrlForReferral(supabase, updatedCampaign.referral_id);

    // Return the updated campaign
    return successResponse(
      {
        status: "success",
        message: "Campaign updated successfully",
        data: {
          ...updatedCampaign,
          image_url
        },
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in updateCampaignById:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
