import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId, validateOrganizationAccess } from "../_shared/organization.ts";
import { logCampaignHistory } from "../_shared/campaignHistory.ts";
import { getImageUrlForReferral } from "../_shared/imageHelpers.ts";
import { createNotification, ROLES } from "../_shared/notifications.ts";

/**
 * Create Campaign Edge Function
 * Multi-step campaign creation process
 *
 * Steps:
 * 1. Optionally link referral to campaign and set campaign name (creates draft campaign)
 * 2. Select PostGrid templates (front and back)
 * 3. Add offer details (headline, description, dates, CTA, disclaimer)
 * 4. Add business details (name, phone, website, QR URL, up to 6 optional images)
 * 5. Link location zone
 * 6. Campaign consents and disclaimers
 *
 * Business Rules:
 * - Organization-based (user must be in organization)
 * - Each step updates the campaign and advances current_step
 * - Campaign starts in Draft status
 * - referral_id is optional in Step 1 (campaign can exist without a referral)
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
        "You do not have permission to create campaigns (requires ADMIN or MARKETER role)",
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

    const { step, campaign_id } = body;

    // Validate step
    if (!step || typeof step !== "number" || step < 1 || step > 6) {
      return errorResponse(
        "INVALID_INPUT",
        "Valid step (1-6) is required",
        400
      );
    }

    // Handle each step
    switch (step) {
      case 1:
        return await handleStep1(supabase, body, organizationId, user);
      case 2:
        return await handleStep2(supabase, body, campaign_id, organizationId, user);
      case 3:
        return await handleStep3(supabase, body, campaign_id, organizationId, user);
      case 4:
        return await handleStep4(supabase, req, body, campaign_id, organizationId, user);
      case 5:
        return await handleStep5(supabase, body, campaign_id, organizationId, user);
      case 6:
        return await handleStep6(supabase, body, campaign_id, organizationId, user);
      default:
        return errorResponse(
          "NOT_IMPLEMENTED",
          `Step ${step} is not yet implemented`,
          501
        );
    }
  } catch (error) {
    console.error("Unexpected error in createCampaign:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});

/**
 * Step 1: Create or update campaign with optional referral link and campaign name
 * If campaign_id is provided, updates the existing campaign
 * If campaign_id is not provided, creates a new campaign
 * referral_id can be provided to link a referral, omitted/null to unlink
 */
async function handleStep1(supabase: any, body: any, organizationId: string, user: any) {
  const { referral_id, campaign_name, campaign_id } = body;

  if (!campaign_name || typeof campaign_name !== 'string' || campaign_name.trim() === '') {
    return errorResponse(
      "INVALID_INPUT",
      "campaign_name is required for step 1",
      400
    );
  }

  // Only verify referral if referral_id is provided
  let referral = null;
  let referralName = null;
  if (referral_id) {
    // Verify referral exists and belongs to organization
    const { data: referralData, error: referralError } = await supabase
      .from("referrals")
      .select("id, job_details")
      .eq("id", referral_id)
      .eq("organization_id", organizationId)
      .single();

    if (referralError || !referralData) {
      return errorResponse(
        "REFERRAL_NOT_FOUND",
        "Referral not found in your organization",
        404
      );
    }

    referral = referralData;
    // Extract referral name from job_details
    referralName = referral.job_details?.name || `Referral ${referral.id.substring(0, 8)}`;
  }

  let campaign;
  let isUpdate = false;
  let oldReferralId = null;

  // Check if this is an update or create
  if (campaign_id) {
    // UPDATE MODE: Verify campaign exists and belongs to organization
    const { data: existingCampaign, error: fetchError } = await supabase
      .from("campaigns")
      .select("id, referral_id")
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

    oldReferralId = existingCampaign.referral_id;
    isUpdate = true;

    // Update existing campaign
    const { data: updatedCampaign, error: updateError } = await supabase
      .from("campaigns")
      .update({
        referral_id: referral_id || null,
        campaign_name: campaign_name.trim(),
        updated_at: new Date().toISOString()
      })
      .eq("id", campaign_id)
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

    campaign = updatedCampaign;
  } else {
    // CREATE MODE: Get Draft status and create new campaign
    const { data: draftStatus, error: statusError } = await supabase
      .from("campaign_status_types")
      .select("id, name")
      .eq("name", "Draft")
      .single();

    if (statusError) {
      console.error("Error fetching Draft status:", statusError);
      return errorResponse(
        "STATUS_FETCH_FAILED",
        "Failed to fetch Draft status",
        500
      );
    }

    // Create campaign
    const { data: newCampaign, error: createError } = await supabase
      .from("campaigns")
      .insert({
        organization_id: organizationId,
        referral_id: referral_id || null,
        campaign_name: campaign_name.trim(),
        status: {
          id: draftStatus.id,
          name: draftStatus.name
        },
        current_step: 1
      })
      .select()
      .single();

    if (createError) {
      console.error("Error creating campaign:", createError);
      return errorResponse(
        "CREATE_FAILED",
        "Failed to create campaign",
        500
      );
    }

    campaign = newCampaign;
  }

  // Handle referral linking/unlinking logic
  if (isUpdate && oldReferralId && oldReferralId !== referral_id) {
    // Unlink old referral: set campaign_id to null and status back to Draft
    const { error: unlinkError } = await supabase
      .from("referrals")
      .update({
        campaign_id: null,
        status: { id: "d7db3360-6d15-4379-989c-560ae96bfa28", name: "Draft" }
      })
      .eq("id", oldReferralId);

    if (unlinkError) {
      console.error("Error unlinking old referral:", unlinkError);
      // Don't fail the request, just log the error
    }
  }

  // Link new referral with campaign_id and set status to "Ready" only if referral_id was provided
  if (referral_id) {
    const { error: updateReferralError } = await supabase
      .from("referrals")
      .update({
        campaign_id: campaign.id,
        status: { id: "4d1ca79a-1a0a-4c9f-a183-6c5bebd13336", name: "Ready" }
      })
      .eq("id", referral_id);

    if (updateReferralError) {
      console.error("Error updating referral with campaign_id and status:", updateReferralError);
      // Don't fail the request, just log the error
    }
  }

  // Log campaign history
  const historyAction = isUpdate
    ? (oldReferralId && !referral_id
        ? "unlinked referral from this campaign"
        : oldReferralId !== referral_id
          ? "updated campaign referral link"
          : "updated this campaign")
    : "created this campaign";

  await logCampaignHistory(
    supabase,
    campaign.id,
    user.userId,
    user.userName,
    historyAction
  );

  // Fetch image_url from referral's gallery only if referral_id was provided
  let image_url = null;
  if (referral_id) {
    image_url = await getImageUrlForReferral(supabase, referral_id);
  }

  // Create notification for all roles only if referral_id was provided
  if (referral_id && referralName) {
    await createNotification({
      supabase,
      organizationId,
      notificationType: "CAMPAIGN_LINKED_TO_REFERRAL",
      title: "Campaign Linked",
      description: `Campaign "${campaign_name}" has been linked to your Referral "${referralName}"`,
      targetRoles: ROLES.ALL,
      metadata: {
        campaign_id: campaign.id,
        campaign_name,
        referral_id,
        referral_name: referralName
      }
    });
  }

  return successResponse(
    {
      status: "success",
      message: isUpdate
        ? "Campaign updated successfully (Step 1 complete)"
        : "Campaign created successfully (Step 1 complete)",
      data: {
        ...campaign,
        image_url
      },
    },
    isUpdate ? 200 : 201
  );
}

/**
 * Step 2: Select PostGrid templates (front and back)
 * Accepts both database UUID and PostGrid template IDs
 * Supports organization templates and universal templates
 */
async function handleStep2(supabase: any, body: any, campaign_id: string, organizationId: string, user: any) {
  const { front_template_id, back_template_id } = body;

  if (!campaign_id) {
    return errorResponse(
      "INVALID_INPUT",
      "campaign_id is required for step 2",
      400
    );
  }

  if (!front_template_id) {
    return errorResponse(
      "INVALID_INPUT",
      "front_template_id is required for step 2",
      400
    );
  }

  if (!back_template_id) {
    return errorResponse(
      "INVALID_INPUT",
      "back_template_id is required for step 2",
      400
    );
  }

  // Verify campaign exists and belongs to organization
  const { data: existingCampaign, error: fetchError } = await supabase
    .from("campaigns")
    .select("campaign_name")
    .eq("id", campaign_id)
    .eq("organization_id", organizationId)
    .single();

  if (fetchError || !existingCampaign) {
    return errorResponse(
      "CAMPAIGN_NOT_FOUND",
      `Campaign not found in your organization. Please ensure you are using the correct campaign_id (not referral_id). Received ID: ${campaign_id}`,
      404
    );
  }

  // Helper function to check if string is a valid UUID
  function isUUID(str: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
  }

  // Helper function to look up template and verify organization or universal
  async function getTemplate(templateId: string, templateType: string) {
    const isDbId = isUUID(templateId);

    // Build query to get organization templates OR universal templates (same as getAllTemplates)
    let query = supabase
      .from("templates")
      .select("id, postgrid_template_id, campaigns_used, deleted, is_universal, description, organization_id")
      .or(`organization_id.eq.${organizationId},is_universal.eq.true`)
      .eq("deleted", false);

    // Add ID filter
    if (isDbId) {
      query = query.eq("id", templateId);
    } else {
      query = query.eq("postgrid_template_id", templateId);
    }

    const { data: templates, error: templateError } = await query;

    if (templateError) {
      console.error(`[getTemplate] Database error:`, templateError);
      return {
        error: errorResponse(
          "TEMPLATE_NOT_FOUND",
          `${templateType} template not found`,
          404
        )
      };
    }

    const template = templates && templates.length > 0 ? templates[0] : null;

    if (!template) {
      return {
        error: errorResponse(
          "TEMPLATE_NOT_FOUND",
          `${templateType} template not found`,
          404
        )
      };
    }

    return { template };
  }

  // Look up front template
  const frontResult = await getTemplate(front_template_id, "Front");
  if (frontResult.error) return frontResult.error;
  const frontTemplate = frontResult.template;

  // Look up back template
  const backResult = await getTemplate(back_template_id, "Back");
  if (backResult.error) return backResult.error;
  const backTemplate = backResult.template;

  // Update campaign with PostGrid template IDs
  const { data: campaign, error: updateError } = await supabase
    .from("campaigns")
    .update({
      front_template_id: frontTemplate.postgrid_template_id,
      back_template_id: backTemplate.postgrid_template_id,
      current_step: 2,
      updated_at: new Date().toISOString()
    })
    .eq("id", campaign_id)
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

  // Update campaigns_used array for both templates (using campaign ID)
  // Update front template
  const frontCampaignsUsed = Array.isArray(frontTemplate.campaigns_used)
    ? frontTemplate.campaigns_used
    : [];

  if (!frontCampaignsUsed.includes(campaign_id)) {
    frontCampaignsUsed.push(campaign_id);

    const { error: frontUpdateError } = await supabase
      .from("templates")
      .update({
        campaigns_used: frontCampaignsUsed,
        updated_at: new Date().toISOString()
      })
      .eq("id", frontTemplate.id);

    if (frontUpdateError) {
      console.error("Error updating front template campaigns_used:", frontUpdateError);
      // Don't fail the request, just log the error
    }
  }

  // Update back template
  const backCampaignsUsed = Array.isArray(backTemplate.campaigns_used)
    ? backTemplate.campaigns_used
    : [];

  if (!backCampaignsUsed.includes(campaign_id)) {
    backCampaignsUsed.push(campaign_id);

    const { error: backUpdateError } = await supabase
      .from("templates")
      .update({
        campaigns_used: backCampaignsUsed,
        updated_at: new Date().toISOString()
      })
      .eq("id", backTemplate.id);

    if (backUpdateError) {
      console.error("Error updating back template campaigns_used:", backUpdateError);
      // Don't fail the request, just log the error
    }
  }

  // Log campaign history
  await logCampaignHistory(
    supabase,
    campaign_id,
    user.userId,
    user.userName,
    `selected templates (front: ${frontTemplate.postgrid_template_id}, back: ${backTemplate.postgrid_template_id})`
  );

  // Create notification for ADMIN role only
  const frontTemplateName = frontTemplate.description || frontTemplate.postgrid_template_id;
  const backTemplateName = backTemplate.description || backTemplate.postgrid_template_id;
  await createNotification({
    supabase,
    organizationId,
    notificationType: "TEMPLATE_USED_IN_CAMPAIGN",
    title: "Template Used",
    description: `Templates "${frontTemplateName}" (front) and "${backTemplateName}" (back) used in Campaign "${existingCampaign.campaign_name}"`,
    targetRoles: ROLES.ADMIN_ONLY,
    metadata: {
      campaign_id,
      campaign_name: existingCampaign.campaign_name,
      front_template_id: frontTemplate.id,
      front_template_name: frontTemplateName,
      back_template_id: backTemplate.id,
      back_template_name: backTemplateName
    }
  });

  // Fetch image_url from referral's gallery only if campaign has a referral
  let image_url = null;
  if (campaign.referral_id) {
    image_url = await getImageUrlForReferral(supabase, campaign.referral_id);
  }

  return successResponse(
    {
      status: "success",
      message: "Templates selected successfully (Step 2 complete)",
      data: {
        ...campaign,
        image_url,
        templates_info: {
          front_template: {
            db_id: frontTemplate.id,
            postgrid_id: frontTemplate.postgrid_template_id
          },
          back_template: {
            db_id: backTemplate.id,
            postgrid_id: backTemplate.postgrid_template_id
          }
        }
      },
    },
    200
  );
}

/**
 * Step 3: Add offer details
 */
async function handleStep3(supabase: any, body: any, campaign_id: string, organizationId: string, user: any) {
  const { data } = body;

  if (!campaign_id) {
    return errorResponse(
      "INVALID_INPUT",
      "campaign_id is required for step 3",
      400
    );
  }

  if (!data || typeof data !== "object") {
    return errorResponse(
      "INVALID_INPUT",
      "data object is required for step 3",
      400
    );
  }

  // Validate required fields
  const requiredFields = ["offer_headline", "offer_description", "start_date", "end_date", "cta_text", "disclaimer_text"];
  const missingFields = requiredFields.filter(field => !data[field]);

  if (missingFields.length > 0) {
    return errorResponse(
      "INVALID_INPUT",
      `Missing required fields: ${missingFields.join(", ")}`,
      400
    );
  }

  // Verify campaign exists and belongs to organization
  const { data: existingCampaign, error: fetchError } = await supabase
    .from("campaigns")
    .select("*")
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

  // Update campaign with offer data
  const { data: campaign, error: updateError } = await supabase
    .from("campaigns")
    .update({
      offer_data: data,
      current_step: 3,
      updated_at: new Date().toISOString()
    })
    .eq("id", campaign_id)
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
  await logCampaignHistory(
    supabase,
    campaign_id,
    user.userId,
    user.userName,
    "added offer details"
  );

  // Fetch image_url from referral's gallery only if campaign has a referral
  let image_url = null;
  if (campaign.referral_id) {
    image_url = await getImageUrlForReferral(supabase, campaign.referral_id);
  }

  return successResponse(
    {
      status: "success",
      message: "Offer details added successfully (Step 3 complete)",
      data: {
        ...campaign,
        image_url
      },
    },
    200
  );
}

/**
 * Step 4: Add business details and images
 * Supports up to 6 optional images (image_1_id through image_6_id)
 * Image IDs must exist in gallery (either referral's gallery or organization's gallery)
 * URLs are fetched automatically from gallery - no manual URLs allowed
 */
async function handleStep4(supabase: any, req: Request, body: any, campaign_id: string, organizationId: string, user: any) {
  const { data } = body;

  if (!campaign_id) {
    return errorResponse(
      "INVALID_INPUT",
      "campaign_id is required for step 4",
      400
    );
  }

  if (!data || typeof data !== "object") {
    return errorResponse(
      "INVALID_INPUT",
      "data object is required for step 4",
      400
    );
  }

  // Validate required fields (images are optional)
  const requiredFields = ["business_name", "phone", "website", "qr_url"];
  const missingFields = requiredFields.filter(field => !data[field]);

  if (missingFields.length > 0) {
    return errorResponse(
      "INVALID_INPUT",
      `Missing required fields: ${missingFields.join(", ")}`,
      400
    );
  }

  // Verify campaign exists and belongs to organization
  const { data: existingCampaign, error: fetchError } = await supabase
    .from("campaigns")
    .select("referral_id")
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

  // Validate merge_variable if provided (optional JSON field)
  if (data.merge_variable !== undefined && data.merge_variable !== null) {
    if (typeof data.merge_variable !== 'object') {
      return errorResponse(
        "INVALID_INPUT",
        "merge_variable must be a valid JSON object",
        400
      );
    }
  }

  // Call Linkly API to create short link for QR URL
  let shortenedUrl = data.qr_url;
  let trackerId: number | null = null;

  if (data.qr_url) {
    try {
      // Get Linkly credentials from request headers
      const linklyApiKey = req.headers.get("x-linkly-api-key");
      const linklyWorkspaceId = req.headers.get("x-linkly-workspace-id");

      if (!linklyApiKey) {
        return errorResponse(
          "MISSING_LINKLY_API_KEY",
          "x-linkly-api-key header is required when qr_url is provided",
          400
        );
      }

      if (!linklyWorkspaceId) {
        return errorResponse(
          "MISSING_LINKLY_WORKSPACE_ID",
          "x-linkly-workspace-id header is required when qr_url is provided",
          400
        );
      }

      // Create short link via Linkly API
      const linklyResponse = await fetch(
        `https://app.linklyhq.com/api/v1/link?api_key=${encodeURIComponent(linklyApiKey)}`,
        {
          method: "POST",
          headers: {
            "accept": "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: data.qr_url,
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

      console.log(`Created Linkly short link: ${shortenedUrl} (tracker ID: ${trackerId}) for QR URL: ${data.qr_url}`);
    } catch (error: unknown) {
      console.error("Error calling Linkly API:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return errorResponse(
        "LINKLY_API_ERROR",
        `Failed to create short link: ${errorMessage}`,
        500
      );
    }
  }

  // Build business_data with shortened URL and optional merge_variable
  const businessData: any = {
    business_name: data.business_name,
    phone: data.phone,
    website: data.website,
    qr_url: shortenedUrl
  };

  // Add merge_variable if provided
  if (data.merge_variable !== undefined && data.merge_variable !== null) {
    businessData.merge_variable = data.merge_variable;
  }

  // Update campaign with business data and tracker ID
  const { data: campaign, error: updateError } = await supabase
    .from("campaigns")
    .update({
      business_data: businessData,
      postgrid_tracker_id: trackerId,
      current_step: 4,
      updated_at: new Date().toISOString()
    })
    .eq("id", campaign_id)
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
  const mergeVarText = data.merge_variable ? ' with merge variables' : '';
  await logCampaignHistory(
    supabase,
    campaign_id,
    user.userId,
    user.userName,
    `added business details${mergeVarText}`
  );

  // Fetch image_url from referral's gallery only if campaign has a referral
  let image_url = null;
  if (campaign.referral_id) {
    image_url = await getImageUrlForReferral(supabase, campaign.referral_id);
  }

  return successResponse(
    {
      status: "success",
      message: "Business details added successfully (Step 4 complete)",
      data: {
        ...campaign,
        image_url
      },
    },
    200
  );
}

/**
 * Step 5: Link Zone to Campaign
 * Links a location zone to the campaign
 *
 * Request body:
 * {
 *   "step": 5,
 *   "campaign_id": "uuid",
 *   "zone_id": "uuid"
 * }
 */
async function handleStep5(supabase: any, body: any, campaign_id: string, organizationId: string, user: any) {
  const { zone_id } = body;

  if (!campaign_id) {
    return errorResponse(
      "INVALID_INPUT",
      "campaign_id is required for step 5",
      400
    );
  }

  if (!zone_id) {
    return errorResponse(
      "INVALID_INPUT",
      "zone_id is required for step 5",
      400
    );
  }

  // Verify campaign exists and belongs to organization
  const { data: existingCampaign, error: fetchError } = await supabase
    .from("campaigns")
    .select("id")
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

  // Verify zone exists and belongs to this organization
  const { data: zone, error: zoneError } = await supabase
    .from("location_zones")
    .select("*")
    .eq("id", zone_id)
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
  let finalZoneId = zone_id;
  if (zone.campaign_id !== campaign_id) {
    // Create a duplicate zone for this campaign
    const { data: newZone, error: duplicateError } = await supabase
      .from("location_zones")
      .insert({
        campaign_id: campaign_id,
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
    console.log(`Duplicated zone ${zone_id} to new zone ${finalZoneId} for campaign ${campaign_id}`);
  }

  // Update campaign to save zone_id and mark step 5 complete
  const { data: campaign, error: updateError } = await supabase
    .from("campaigns")
    .update({
      zone_id: finalZoneId,
      current_step: 5,
      updated_at: new Date().toISOString()
    })
    .eq("id", campaign_id)
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
  await logCampaignHistory(
    supabase,
    campaign_id,
    user.userId,
    user.userName,
    "linked location zone to campaign"
  );

  // Fetch image_url from referral's gallery only if campaign has a referral
  let image_url = null;
  if (campaign.referral_id) {
    image_url = await getImageUrlForReferral(supabase, campaign.referral_id);
  }

  return successResponse(
    {
      status: "success",
      message: "Zone linked to campaign successfully (Step 5 complete)",
      data: {
        campaign: {
          ...campaign,
          image_url
        },
        zone_id: finalZoneId
      },
    },
    200
  );
}

/**
 * Step 6: Campaign Consent/Disclaimers
 * Validates that all required consents are provided and set to true
 */
async function handleStep6(supabase: any, body: any, campaign_id: string, organizationId: string, user: any) {
  const { consent } = body;

  if (!campaign_id) {
    return errorResponse(
      "INVALID_INPUT",
      "campaign_id is required for step 6",
      400
    );
  }

  if (!consent || typeof consent !== "object") {
    return errorResponse(
      "INVALID_INPUT",
      "consent object is required for step 6",
      400
    );
  }

  // Verify campaign exists and belongs to organization
  const { data: existingCampaign, error: fetchError } = await supabase
    .from("campaigns")
    .select("id")
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

  // Fetch all disclaimers from campaign_disclaimers table
  const { data: disclaimers, error: disclaimerError } = await supabase
    .from("campaign_disclaimers")
    .select("id, disclaimer_text, value");

  if (disclaimerError) {
    console.error("Error fetching disclaimers:", disclaimerError);
    return errorResponse(
      "DATABASE_ERROR",
      "Failed to fetch campaign disclaimers",
      500
    );
  }

  if (!disclaimers || disclaimers.length === 0) {
    return errorResponse(
      "NO_DISCLAIMERS",
      "No disclaimers found in the system",
      500
    );
  }

  // Validate that all required consents are provided and set to true
  const missingConsents: string[] = [];
  const falseConsents: string[] = [];

  for (const disclaimer of disclaimers) {
    const consentValue = consent[disclaimer.id];

    if (consentValue === undefined || consentValue === null) {
      missingConsents.push(disclaimer.disclaimer_text);
    } else if (consentValue !== true) {
      falseConsents.push(disclaimer.disclaimer_text);
    }
  }

  if (missingConsents.length > 0) {
    return errorResponse(
      "MISSING_CONSENTS",
      `Missing required consents: ${missingConsents.join(", ")}`,
      400
    );
  }

  if (falseConsents.length > 0) {
    return errorResponse(
      "CONSENT_NOT_ACCEPTED",
      `All consents must be accepted (set to true). The following were not accepted: ${falseConsents.join(", ")}`,
      400
    );
  }

  // Update campaign to mark step 6 complete and store consents
  const { data: campaign, error: updateError } = await supabase
    .from("campaigns")
    .update({
      consents: consent,
      current_step: 6,
      updated_at: new Date().toISOString()
    })
    .eq("id", campaign_id)
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
  await logCampaignHistory(
    supabase,
    campaign_id,
    user.userId,
    user.userName,
    "completed campaign consents and disclaimers"
  );

  // Fetch image_url from referral's gallery only if campaign has a referral
  let image_url = null;
  if (campaign.referral_id) {
    image_url = await getImageUrlForReferral(supabase, campaign.referral_id);
  }

  return successResponse(
    {
      status: "success",
      message: "Campaign consents verified successfully (Step 6 complete)",
      data: {
        campaign: {
          ...campaign,
          image_url
        }
      },
    },
    200
  );
}
