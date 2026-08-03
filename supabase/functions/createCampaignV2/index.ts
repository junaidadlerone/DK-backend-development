import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId, validateOrganizationAccess } from "../_shared/organization.ts";
import { logCampaignHistory } from "../_shared/campaignHistory.ts";
import { getImageUrlForReferral } from "../_shared/imageHelpers.ts";
import { createNotification, ROLES } from "../_shared/notifications.ts";

/**
 * Create Campaign V2 Edge Function
 * Simplified 4-step campaign creation process
 *
 * Steps:
 * 1. Create campaign with name, optional referral, and optional disclaimer
 * 2. Assign template bundle (automatically sets front and back templates)
 * 3. Link location zone
 * 4. Campaign consents and disclaimers
 *
 * Key Differences from V1:
 * - Uses template bundles instead of separate front/back selection
 * - No detailed offer data or business data collection
 * - QR code linking moved to separate optional API
 * - 4 steps instead of 6
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
    if (!step || typeof step !== "number" || step < 1 || step > 4) {
      return errorResponse(
        "INVALID_INPUT",
        "Valid step (1-4) is required",
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
        return await handleStep4(supabase, body, campaign_id, organizationId, user);
      default:
        return errorResponse(
          "NOT_IMPLEMENTED",
          `Step ${step} is not yet implemented`,
          501
        );
    }
  } catch (error) {
    console.error("Unexpected error in createCampaignV2:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});

/**
 * Step 1: Create campaign with name, optional referral, and optional disclaimer
 */
async function handleStep1(supabase: any, body: any, organizationId: string, user: any) {
  const { referral_id, campaign_name, disclaimer_text, target_type } = body;

  if (!campaign_name || typeof campaign_name !== 'string' || campaign_name.trim() === '') {
    return errorResponse(
      "INVALID_INPUT",
      "campaign_name is required for step 1",
      400
    );
  }

  // Validate target_type if provided, or infer it
  const validTypes = ['Referrals', 'Location Zone', 'Address List'];
  let finalTargetType = target_type;

  if (target_type && !validTypes.includes(target_type)) {
    return errorResponse(
      "INVALID_INPUT",
      `Invalid target_type. Must be one of: ${validTypes.join(', ')}`,
      400
    );
  }

  // Inference logic if target_type is missing
  if (!finalTargetType) {
    if (referral_id) {
      finalTargetType = 'Referrals';
    } else {
      finalTargetType = 'Location Zone'; // Default
    }
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

  // Get Draft status
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

  // Build offer_data with optional disclaimer_text and start_date
  const offerData: any = {};
  if (disclaimer_text) {
    offerData.disclaimer_text = disclaimer_text;
  }
  if (body.start_date) {
    offerData.start_date = body.start_date;
  }

  // Create campaign
  const { data: newCampaign, error: createError } = await supabase
    .from("campaigns")
    .insert({
      organization_id: organizationId,
      referral_id: referral_id || null,
      campaign_name: campaign_name.trim(),
      campaign_target_type: finalTargetType,
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

  const campaign = newCampaign;

  // Link the referral to the campaign. Deliberately does NOT touch the referral's status
  // (2026-07-31): this used to force `{ name: "Ready" }` unconditionally, which meant linking an
  // unfinished DRAFT referral silently marked it Ready — destroying the one signal the app itself
  // uses to show the referral is incomplete, and making the problem invisible afterwards. Readiness
  // is computed from the referral's own fields (createReferral / updateReferralById) and depends on
  // the homeowner's consent + signature, which only the user can provide; linking is not evidence
  // of either. Note deleteCampaign does not reset the status, so a forced Ready also outlived the
  // campaign that caused it.
  if (referral_id) {
    const { error: updateReferralError } = await supabase
      .from("referrals")
      .update({
        campaign_id: campaign.id,
      })
      .eq("id", referral_id);

    if (updateReferralError) {
      console.error("Error updating referral with campaign_id and status:", updateReferralError);
      // Don't fail the request, just log the error
    }
  }

  // Log campaign history
  await logCampaignHistory(
    supabase,
    campaign.id,
    user.userId,
    user.userName,
    "created this campaign (v2)"
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
      message: "Campaign created successfully (Step 1 complete)",
      data: {
        ...campaign,
        image_url
      },
    },
    201
  );
}

/**
 * Step 2: Assign template bundle
 * Looks up bundle and automatically assigns front and back templates
 */
async function handleStep2(supabase: any, body: any, campaign_id: string, organizationId: string, user: any) {
  const { template_bundle_id } = body;

  if (!campaign_id) {
    return errorResponse(
      "INVALID_INPUT",
      "campaign_id is required for step 2",
      400
    );
  }

  if (!template_bundle_id) {
    return errorResponse(
      "INVALID_INPUT",
      "template_bundle_id is required for step 2",
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
      "Campaign not found in your organization",
      404
    );
  }

  // Fetch bundle by id only; access is checked in JS so we can match the V1
  // list (getAllTemplatesBundles) and detail (getTemplateBundleById) rules:
  // active org owns it OR bundle is universal OR active org is in
  // shared_with_organization_ids (V3 share).
  const { data: bundle, error: bundleError } = await supabase
    .from("template_bundles")
    .select(`
      id,
      template_front_id,
      template_back_id,
      is_universal,
      organization_id,
      shared_with_organization_ids
    `)
    .eq("id", template_bundle_id)
    .single();

  if (bundleError || !bundle) {
    return errorResponse(
      "BUNDLE_NOT_FOUND",
      "Template bundle not found",
      404
    );
  }

  const sharedIds: string[] = Array.isArray(bundle.shared_with_organization_ids)
    ? bundle.shared_with_organization_ids
    : [];
  const ownsBundle = bundle.organization_id === organizationId;
  const isShared = sharedIds.includes(organizationId);
  if (!ownsBundle && !bundle.is_universal && !isShared) {
    return errorResponse(
      "BUNDLE_NOT_FOUND",
      "Template bundle not accessible to your organization",
      404
    );
  }

  // Fetch front template
  const { data: frontTemplate, error: frontError } = await supabase
    .from("templates")
    .select("id, postgrid_template_id, campaigns_used, deleted, description")
    .eq("id", bundle.template_front_id)
    .eq("deleted", false)
    .single();

  if (frontError || !frontTemplate) {
    return errorResponse(
      "FRONT_TEMPLATE_NOT_FOUND",
      "Front template from bundle not found or deleted",
      404
    );
  }

  // Fetch back template
  const { data: backTemplate, error: backError } = await supabase
    .from("templates")
    .select("id, postgrid_template_id, campaigns_used, deleted, description")
    .eq("id", bundle.template_back_id)
    .eq("deleted", false)
    .single();

  if (backError || !backTemplate) {
    return errorResponse(
      "BACK_TEMPLATE_NOT_FOUND",
      "Back template from bundle not found or deleted",
      404
    );
  }

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

  // Update campaigns_used array for both templates
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
    `assigned template bundle (front: ${frontTemplate.postgrid_template_id}, back: ${backTemplate.postgrid_template_id})`
  );

  // Create notification for ADMIN role only
  const frontTemplateName = frontTemplate.description || frontTemplate.postgrid_template_id;
  const backTemplateName = backTemplate.description || backTemplate.postgrid_template_id;
  await createNotification({
    supabase,
    organizationId,
    notificationType: "TEMPLATE_USED_IN_CAMPAIGN",
    title: "Template Bundle Used",
    description: `Template bundle with "${frontTemplateName}" (front) and "${backTemplateName}" (back) used in Campaign "${existingCampaign.campaign_name}"`,
    targetRoles: ROLES.ADMIN_ONLY,
    metadata: {
      campaign_id,
      campaign_name: existingCampaign.campaign_name,
      template_bundle_id,
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
      message: "Template bundle assigned successfully (Step 2 complete)",
      data: {
        ...campaign,
        image_url,
        bundle_info: {
          bundle_id: bundle.id,
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
 * Step 3: Link Location Zone
 * Same logic as V1 Step 5
 */
async function handleStep3(supabase: any, body: any, campaign_id: string, organizationId: string, user: any) {
  const { zone_id, csv_address_list_id } = body;

  if (!campaign_id) {
    return errorResponse(
      "INVALID_INPUT",
      "campaign_id is required for step 3",
      400
    );
  }

  // Verify campaign exists and belongs to organization
  const { data: existingCampaign, error: fetchError } = await supabase
    .from("campaigns")
    .select("id, campaign_target_type, csv_address_list_id")
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

  const targetType = existingCampaign.campaign_target_type;

  // Validate based on target type
  if (targetType === 'Location Zone' && !zone_id) {
    return errorResponse(
        "INVALID_INPUT",
        "zone_id is required for Location Zone campaigns",
        400
    );
  }

  if (targetType === 'Address List') {
     if (!csv_address_list_id) {
        return errorResponse(
            "INVALID_INPUT",
            "csv_address_list_id is required for Address List campaigns",
            400
        );
     }
     
     // Verification: Ensure the provided list matches the one linked to the campaign
     if (csv_address_list_id !== existingCampaign.csv_address_list_id) {
        return errorResponse(
            "INVALID_INPUT",
            "Provided csv_address_list_id does not match the address list linked to this campaign. Please ensure you have imported the list for this campaign.",
            400
        );
     }
  }

  // If Referrals type, they can set either or both (usually zone), but we'll prioritize zone if provided
  if (!zone_id && !csv_address_list_id && targetType !== 'Referrals') {
    return errorResponse(
      "INVALID_INPUT",
      "Either zone_id or csv_address_list_id is required for step 3",
      400
    );
  }

  // Verify resources if provided
  if (zone_id) {
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
  }

  if (csv_address_list_id) {
    const { data: list, error: listError } = await supabase
        .from("campaign_csv_address_lists")
        .select("id")
        .eq("id", csv_address_list_id)
        .eq("organization_id", organizationId)
        .single();

    if (listError || !list) {
        return errorResponse(
            "ADDRESS_LIST_NOT_FOUND",
            "Address List not found in your organization",
            404
        );
    }
  }

  // Update campaign to save selection and mark step 3 complete
  // When setting one, nullify the other to ensure consistency
  const { data: campaign, error: updateError } = await supabase
    .from("campaigns")
    .update({
      zone_id: zone_id || null,
      csv_address_list_id: csv_address_list_id || null,
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
    zone_id ? "linked location zone to campaign" : "linked CSV address list to campaign"
  );

  // Fetch image_url from referral's gallery only if campaign has a referral
  let image_url = null;
  if (campaign.referral_id) {
    image_url = await getImageUrlForReferral(supabase, campaign.referral_id);
  }

  return successResponse(
    {
      status: "success",
      message: "Zone linked to campaign successfully (Step 3 complete)",
      data: {
        campaign: {
          ...campaign,
          image_url
        },
        zone_id: zone_id || null,
        csv_address_list_id: csv_address_list_id || null
      },
    },
    200
  );
}

/**
 * Step 4: Campaign Consent/Disclaimers
 * Same logic as V1 Step 6
 */
async function handleStep4(supabase: any, body: any, campaign_id: string, organizationId: string, user: any) {
  const { consent } = body;

  if (!campaign_id) {
    return errorResponse(
      "INVALID_INPUT",
      "campaign_id is required for step 4",
      400
    );
  }

  if (!consent || typeof consent !== "object") {
    return errorResponse(
      "INVALID_INPUT",
      "consent object is required for step 4",
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

  // Update campaign to mark step 4 complete and store consents
  const { data: campaign, error: updateError } = await supabase
    .from("campaigns")
    .update({
      consents: consent,
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
  await logCampaignHistory(
    supabase,
    campaign_id,
    user.userId,
    user.userName,
    "completed campaign consents and disclaimers (v2)"
  );

  // Fetch image_url from referral's gallery only if campaign has a referral
  let image_url = null;
  if (campaign.referral_id) {
    image_url = await getImageUrlForReferral(supabase, campaign.referral_id);
  }

  return successResponse(
    {
      status: "success",
      message: "Campaign consents verified successfully (Step 4 complete - Campaign ready)",
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
