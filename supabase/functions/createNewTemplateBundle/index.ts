import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest, getUserProfile } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { logTemplateHistory } from "../_shared/templateHistory.ts";
import { createNotification, ROLES } from "../_shared/notifications.ts";

/**
 * Create New Template Bundle Edge Function
 * Creates a pair of PostGrid templates (front and back) and saves them as a bundle
 *
 * Business Rules:
 * - Requires PostGrid API key in request body
 * - Creates two templates in PostGrid: one Front, one Back
 * - Appends " Front" and " Back" to the description
 * - Saves both templates to templates table
 * - Creates bundle record in template_bundles table
 * - User must be authenticated and in organization
 * - If isManualEdit is true, campaign_id is required
 *
 * Request body:
 * {
 *   "postgridApiKey": string (required),
 *   "description": string (required) - base description,
 *   "html_front": string (required) - HTML for front template,
 *   "html_back": string (required) - HTML for back template,
 *   "postcardSize": "4x6" | "6x9" | "6x11" (required),
 *   "isManualEdit": boolean (optional, default false),
 *   "campaign_id": string (optional) - required if isManualEdit is true
 * }
 */

interface RequestBody {
  postgridApiKey: string;
  description: string;
  html_front: string;
  html_back: string;
  postcardSize: '4x6' | '6x9' | '6x11';
  isManualEdit?: boolean;
  campaign_id?: string;
}

interface PostGridTemplateResponse {
  id: string;
  object: string;
  live: boolean;
  deleted: boolean;
  description: string;
  html: string;
  createdAt: string;
  updatedAt: string;
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

  const startTime = Date.now();

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

    // Get user profile for createdBy field
    const userProfile = await getUserProfile(supabase, user.userId);
    if (!userProfile) {
      return errorResponse(
        "USER_PROFILE_NOT_FOUND",
        "User profile not found",
        404
      );
    }

    // Parse request body
    let requestBody: RequestBody;
    try {
      requestBody = await req.json();
    } catch (parseError) {
      return errorResponse(
        "INVALID_INPUT",
        "Invalid JSON in request body",
        400
      );
    }

    // Validate required fields
    const { postgridApiKey, description, html_front, html_back, postcardSize, isManualEdit, campaign_id } = requestBody;

    if (!postgridApiKey || typeof postgridApiKey !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "postgridApiKey is required and must be a string",
        400
      );
    }

    if (!description || typeof description !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "description is required and must be a string",
        400
      );
    }

    if (!html_front || typeof html_front !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "html_front is required and must be a string",
        400
      );
    }

    if (!html_back || typeof html_back !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "html_back is required and must be a string",
        400
      );
    }

    if (!postcardSize || !['4x6', '6x9', '6x11'].includes(postcardSize)) {
      return errorResponse(
        "INVALID_INPUT",
        "postcardSize is required and must be one of: '4x6', '6x9', '6x11'",
        400
      );
    }

    const isManual = isManualEdit === true;

    // Validate campaign_id if isManualEdit is true
    if (isManual) {
      if (!campaign_id || typeof campaign_id !== 'string') {
        return errorResponse(
          "INVALID_INPUT",
          "campaign_id is required when isManualEdit is true",
          400
        );
      }

      // Verify campaign exists and belongs to organization
      const { data: campaign, error: campaignError } = await supabase
        .from("campaigns")
        .select("id")
        .eq("id", campaign_id)
        .eq("organization_id", organizationId)
        .single();

      if (campaignError || !campaign) {
        return errorResponse(
          "CAMPAIGN_NOT_FOUND",
          "Campaign not found or doesn't belong to your organization",
          404
        );
      }
    }

    // Create Front template in PostGrid
    const frontFormData = new URLSearchParams();
    frontFormData.append('description', `${description} Front`);
    frontFormData.append('html', html_front);

    let frontPostgridResponse: Response;
    try {
      frontPostgridResponse = await fetch('https://api.postgrid.com/print-mail/v1/templates', {
        method: 'POST',
        headers: {
          'x-api-key': postgridApiKey,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: frontFormData.toString()
      });
    } catch (fetchError) {
      console.error("Error calling PostGrid API for front template:", fetchError);
      return errorResponse(
        "POSTGRID_API_ERROR",
        "Failed to connect to PostGrid API for front template",
        500
      );
    }

    if (!frontPostgridResponse.ok) {
      const errorText = await frontPostgridResponse.text();
      console.error("PostGrid API error (front):", errorText);
      return errorResponse(
        "POSTGRID_API_ERROR",
        `PostGrid API returned error for front template: ${frontPostgridResponse.status} - ${errorText}`,
        500
      );
    }

    let frontTemplate: PostGridTemplateResponse;
    try {
      frontTemplate = await frontPostgridResponse.json();
    } catch (jsonError) {
      console.error("Error parsing PostGrid response (front):", jsonError);
      return errorResponse(
        "POSTGRID_RESPONSE_ERROR",
        "Failed to parse PostGrid API response for front template",
        500
      );
    }

    // Create Back template in PostGrid
    const backFormData = new URLSearchParams();
    backFormData.append('description', `${description} Back`);
    backFormData.append('html', html_back);

    let backPostgridResponse: Response;
    try {
      backPostgridResponse = await fetch('https://api.postgrid.com/print-mail/v1/templates', {
        method: 'POST',
        headers: {
          'x-api-key': postgridApiKey,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: backFormData.toString()
      });
    } catch (fetchError) {
      console.error("Error calling PostGrid API for back template:", fetchError);
      // Try to clean up front template
      try {
        await fetch(`https://api.postgrid.com/print-mail/v1/templates/${frontTemplate.id}`, {
          method: 'DELETE',
          headers: { 'x-api-key': postgridApiKey }
        });
      } catch (cleanupError) {
        console.error("Failed to cleanup front template:", cleanupError);
      }
      return errorResponse(
        "POSTGRID_API_ERROR",
        "Failed to connect to PostGrid API for back template",
        500
      );
    }

    if (!backPostgridResponse.ok) {
      const errorText = await backPostgridResponse.text();
      console.error("PostGrid API error (back):", errorText);
      // Try to clean up front template
      try {
        await fetch(`https://api.postgrid.com/print-mail/v1/templates/${frontTemplate.id}`, {
          method: 'DELETE',
          headers: { 'x-api-key': postgridApiKey }
        });
      } catch (cleanupError) {
        console.error("Failed to cleanup front template:", cleanupError);
      }
      return errorResponse(
        "POSTGRID_API_ERROR",
        `PostGrid API returned error for back template: ${backPostgridResponse.status} - ${errorText}`,
        500
      );
    }

    let backTemplate: PostGridTemplateResponse;
    try {
      backTemplate = await backPostgridResponse.json();
    } catch (jsonError) {
      console.error("Error parsing PostGrid response (back):", jsonError);
      // Try to clean up both templates
      try {
        await fetch(`https://api.postgrid.com/print-mail/v1/templates/${frontTemplate.id}`, {
          method: 'DELETE',
          headers: { 'x-api-key': postgridApiKey }
        });
      } catch (cleanupError) {
        console.error("Failed to cleanup front template:", cleanupError);
      }
      return errorResponse(
        "POSTGRID_RESPONSE_ERROR",
        "Failed to parse PostGrid API response for back template",
        500
      );
    }

    // Save front template to database
    const frontTemplateData: any = {
      organization_id: organizationId,
      is_universal: false,
      postgrid_template_id: frontTemplate.id,
      description: frontTemplate.description,
      html: frontTemplate.html,
      template_type: 'Front',
      postcard_size: postcardSize,
      campaigns_used: isManual && campaign_id ? [campaign_id] : [],
      created_by: userProfile,
      live: frontTemplate.live,
      deleted: frontTemplate.deleted,
      is_manual_edit: isManual
    };

    const { data: frontDbTemplate, error: frontInsertError } = await supabase
      .from("templates")
      .insert(frontTemplateData)
      .select()
      .single();

    if (frontInsertError) {
      console.error("Error saving front template to database:", frontInsertError);
      // Cleanup PostGrid templates
      try {
        await fetch(`https://api.postgrid.com/print-mail/v1/templates/${frontTemplate.id}`, {
          method: 'DELETE',
          headers: { 'x-api-key': postgridApiKey }
        });
        await fetch(`https://api.postgrid.com/print-mail/v1/templates/${backTemplate.id}`, {
          method: 'DELETE',
          headers: { 'x-api-key': postgridApiKey }
        });
      } catch (cleanupError) {
        console.error("Failed to cleanup PostGrid templates:", cleanupError);
      }
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to save front template to database",
        500
      );
    }

    // Save back template to database
    const backTemplateData: any = {
      organization_id: organizationId,
      is_universal: false,
      postgrid_template_id: backTemplate.id,
      description: backTemplate.description,
      html: backTemplate.html,
      template_type: 'Back',
      postcard_size: postcardSize,
      campaigns_used: isManual && campaign_id ? [campaign_id] : [],
      created_by: userProfile,
      live: backTemplate.live,
      deleted: backTemplate.deleted,
      is_manual_edit: isManual
    };

    const { data: backDbTemplate, error: backInsertError } = await supabase
      .from("templates")
      .insert(backTemplateData)
      .select()
      .single();

    if (backInsertError) {
      console.error("Error saving back template to database:", backInsertError);
      // Cleanup everything
      try {
        await fetch(`https://api.postgrid.com/print-mail/v1/templates/${frontTemplate.id}`, {
          method: 'DELETE',
          headers: { 'x-api-key': postgridApiKey }
        });
        await fetch(`https://api.postgrid.com/print-mail/v1/templates/${backTemplate.id}`, {
          method: 'DELETE',
          headers: { 'x-api-key': postgridApiKey }
        });
        await supabase.from("templates").delete().eq("id", frontDbTemplate.id);
      } catch (cleanupError) {
        console.error("Failed to cleanup templates:", cleanupError);
      }
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to save back template to database",
        500
      );
    }

    // Create bundle record
    const { data: bundleData, error: bundleError } = await supabase
      .from("template_bundles")
      .insert({
        template_front_id: frontDbTemplate.id,
        template_back_id: backDbTemplate.id,
        organization_id: organizationId,
        is_universal: false
      })
      .select()
      .single();

    if (bundleError) {
      console.error("Error creating bundle:", bundleError);
      // Cleanup everything
      try {
        await fetch(`https://api.postgrid.com/print-mail/v1/templates/${frontTemplate.id}`, {
          method: 'DELETE',
          headers: { 'x-api-key': postgridApiKey }
        });
        await fetch(`https://api.postgrid.com/print-mail/v1/templates/${backTemplate.id}`, {
          method: 'DELETE',
          headers: { 'x-api-key': postgridApiKey }
        });
        await supabase.from("templates").delete().eq("id", frontDbTemplate.id);
        await supabase.from("templates").delete().eq("id", backDbTemplate.id);
      } catch (cleanupError) {
        console.error("Failed to cleanup templates:", cleanupError);
      }
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to create template bundle",
        500
      );
    }

    // Log template creation history
    await logTemplateHistory(
      supabase,
      frontDbTemplate.id,
      user.userId,
      user.userName,
      `created front template in bundle (Front, ${postcardSize})`
    );

    await logTemplateHistory(
      supabase,
      backDbTemplate.id,
      user.userId,
      user.userName,
      `created back template in bundle (Back, ${postcardSize})`
    );

    const processingTimeMs = Date.now() - startTime;

    // Create notification for ADMIN users
    await createNotification({
      supabase,
      organizationId,
      title: "Template Bundle Created",
      message: `${user.userName} created a new template bundle: ${description}`,
      targetRoles: [ROLES.ADMIN],
      metadata: {
        bundle_id: bundleData.id,
        front_template_id: frontDbTemplate.id,
        back_template_id: backDbTemplate.id,
        postcard_size: postcardSize,
        is_manual_edit: isManual
      }
    });

    // Build response
    const response = {
      status: "success",
      message: "Template bundle created successfully",
      bundle: {
        id: bundleData.id,
        front_template: {
          id: frontDbTemplate.id,
          postgrid_template_id: frontDbTemplate.postgrid_template_id,
          description: frontDbTemplate.description,
          html: frontDbTemplate.html,
          templateType: frontDbTemplate.template_type,
          postcardSize: frontDbTemplate.postcard_size,
          isManualEdit: frontDbTemplate.is_manual_edit,
          campaigns_used: frontDbTemplate.campaigns_used,
          createdBy: frontDbTemplate.created_by,
          live: frontDbTemplate.live,
          deleted: frontDbTemplate.deleted,
          created_at: frontDbTemplate.created_at,
          updated_at: frontDbTemplate.updated_at
        },
        back_template: {
          id: backDbTemplate.id,
          postgrid_template_id: backDbTemplate.postgrid_template_id,
          description: backDbTemplate.description,
          html: backDbTemplate.html,
          templateType: backDbTemplate.template_type,
          postcardSize: backDbTemplate.postcard_size,
          isManualEdit: backDbTemplate.is_manual_edit,
          campaigns_used: backDbTemplate.campaigns_used,
          createdBy: backDbTemplate.created_by,
          live: backDbTemplate.live,
          deleted: backDbTemplate.deleted,
          created_at: backDbTemplate.created_at,
          updated_at: backDbTemplate.updated_at
        },
        created_at: bundleData.created_at,
        updated_at: bundleData.updated_at
      },
      processingTimeMs
    };

    return successResponse(response, 201);

  } catch (error) {
    console.error("Unexpected error in createNewTemplateBundle:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
