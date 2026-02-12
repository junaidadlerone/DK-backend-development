import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest, getUserProfile } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { logTemplateHistory } from "../_shared/templateHistory.ts";
import { createNotification, ROLES } from "../_shared/notifications.ts";

/**
 * Create New Template Edge Function
 * Creates a PostGrid template and saves it to the database
 *
 * Business Rules:
 * - Requires PostGrid API key in request body
 * - Creates template in PostGrid using their API
 * - Saves template metadata to templates table
 * - Template is organization-scoped
 * - Tracks creator via createdBy field
 * - Initializes empty campaigns_used array (or with campaign_id if provided)
 * - Supports manual edit flag for campaign-specific templates
 * - If isManualEdit is true, campaign_id should be provided to add to campaigns_used array
 *
 * Request body:
 * {
 *   "postgridApiKey": string (required),
 *   "description": string (required),
 *   "html": string (required),
 *   "templateType": "Front" | "Back" (required),
 *   "postcardSize": "4x6" | "6x9" | "6x11" (required),
 *   "isManualEdit": boolean (optional, default: false) - if true, template is only shown when querying with specific campaign_id
 *   "campaign_id": string (optional) - should be provided if isManualEdit is true, will be added to campaigns_used array
 * }
 */

interface RequestBody {
  postgridApiKey: string;
  description: string;
  html: string;
  templateType: 'Front' | 'Back';
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

    // Get user profile for createdBy field
    const userProfile = await getUserProfile(supabase, user.userId);
    if (!userProfile) {
      return errorResponse(
        "USER_PROFILE_NOT_FOUND",
        "User profile not found",
        404
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
    const { postgridApiKey, description, html, templateType, postcardSize, isManualEdit, campaign_id } = requestBody;

    // Determine the isManualEdit flag (default to false if not provided)
    const isManualEditFlag = isManualEdit === true;

    // Validate campaign_id when isManualEdit is true
    if (isManualEditFlag && (!campaign_id || typeof campaign_id !== 'string')) {
      return errorResponse(
        "INVALID_INPUT",
        "campaign_id is required and must be a string when isManualEdit is true",
        400
      );
    }

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

    if (!html || typeof html !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "html is required and must be a string",
        400
      );
    }

    if (!templateType || !['Front', 'Back'].includes(templateType)) {
      return errorResponse(
        "INVALID_INPUT",
        "templateType is required and must be either 'Front' or 'Back'",
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

    // Create template in PostGrid
    const formData = new URLSearchParams();
    formData.append('description', description);
    formData.append('html', html);

    let postgridResponse: Response;
    try {
      postgridResponse = await fetch('https://api.postgrid.com/print-mail/v1/templates', {
        method: 'POST',
        headers: {
          'x-api-key': postgridApiKey,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData.toString()
      });
    } catch (fetchError) {
      console.error("Error calling PostGrid API:", fetchError);
      return errorResponse(
        "POSTGRID_API_ERROR",
        "Failed to connect to PostGrid API",
        500
      );
    }

    if (!postgridResponse.ok) {
      const errorText = await postgridResponse.text();
      console.error("PostGrid API error:", errorText);
      return errorResponse(
        "POSTGRID_API_ERROR",
        `PostGrid API returned error: ${postgridResponse.status} - ${errorText}`,
        500
      );
    }

    let postgridTemplate: PostGridTemplateResponse;
    try {
      postgridTemplate = await postgridResponse.json();
    } catch (jsonError) {
      console.error("Error parsing PostGrid response:", jsonError);
      return errorResponse(
        "POSTGRID_RESPONSE_ERROR",
        "Failed to parse PostGrid API response",
        500
      );
    }

    // Build campaigns_used array
    const campaignsUsed = isManualEditFlag && campaign_id ? [campaign_id] : [];

    // Save template to database
    const { data: templateData, error: insertError } = await supabase
      .from("templates")
      .insert({
        organization_id: organizationId,
        postgrid_template_id: postgridTemplate.id,
        description: postgridTemplate.description,
        html: postgridTemplate.html,
        template_type: templateType,
        postcard_size: postcardSize,
        campaigns_used: campaignsUsed,
        created_by: userProfile,
        live: postgridTemplate.live,
        deleted: postgridTemplate.deleted,
        is_manual_edit: isManualEditFlag
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error saving template to database:", insertError);
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to save template to database",
        500
      );
    }

    // Log template creation history
    await logTemplateHistory(
      supabase,
      templateData.id,
      user.userId,
      user.userName,
      `created template (${templateType}, ${postcardSize})`
    );

    const processingTimeMs = Date.now() - startTime;

    // Create notification for new template (for ADMIN only)
    const templateName = templateData.description || templateData.postgrid_template_id;
    await createNotification({
      supabase,
      organizationId,
      notificationType: "NEW_TEMPLATE_CREATED",
      title: "New Template Created",
      description: `New template "${templateName}" created (${templateData.template_type} - ${templateData.postcard_size})`,
      targetRoles: ROLES.ADMIN_ONLY,
      metadata: {
        template_id: templateData.id,
        template_name: templateName,
        postgrid_template_id: templateData.postgrid_template_id,
        template_type: templateData.template_type,
        postcard_size: templateData.postcard_size
      }
    });

    // Build response
    const response = {
      status: "success",
      message: "Template created successfully",
      template: {
        id: templateData.id,
        postgrid_template_id: templateData.postgrid_template_id,
        description: templateData.description,
        html: templateData.html,
        templateType: templateData.template_type,
        postcardSize: templateData.postcard_size,
        campaigns_used: templateData.campaigns_used,
        createdBy: templateData.created_by,
        live: templateData.live,
        deleted: templateData.deleted,
        is_manual_edit: templateData.is_manual_edit,
        created_at: templateData.created_at,
        updated_at: templateData.updated_at
      },
      processingTimeMs
    };

    return successResponse(response, 201);

  } catch (error) {
    console.error("Unexpected error in createNewTemplate:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
