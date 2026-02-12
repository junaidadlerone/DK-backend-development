import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { logTemplateHistory } from "../_shared/templateHistory.ts";
import { createNotification, ROLES } from "../_shared/notifications.ts";

/**
 * Update Template Edge Function
 * Updates a template in both PostGrid and the database
 *
 * Business Rules:
 * - Requires PostGrid API key and template ID in request body
 * - Template ID can be either database UUID or PostGrid template ID
 * - Template must belong to user's organization
 * - Updates PostGrid template first, then updates database
 * - Cannot update deleted templates
 * - Only updates fields that are provided (partial updates supported)
 * - Can update template type (Front/Back) and postcard size (4x6, 6x9, 6x11)
 *
 * Request body:
 * {
 *   "postgridApiKey": string (required),
 *   "templateId": string (required) - database UUID or PostGrid template ID,
 *   "html": string (optional) - updated HTML content,
 *   "description": string (optional) - updated description,
 *   "templateType": "Front" | "Back" (optional) - updated template type,
 *   "postcardSize": "4x6" | "6x9" | "6x11" (optional) - updated postcard size
 * }
 */

interface RequestBody {
  postgridApiKey: string;
  templateId: string;
  html?: string;
  description?: string;
  templateType?: 'Front' | 'Back';
  postcardSize?: '4x6' | '6x9' | '6x11';
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow POST or PATCH requests
  if (req.method !== "POST" && req.method !== "PATCH") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST and PATCH methods are allowed", 405);
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
    const { postgridApiKey, templateId, html, description, templateType, postcardSize } = requestBody;

    if (!postgridApiKey || typeof postgridApiKey !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "postgridApiKey is required and must be a string",
        400
      );
    }

    if (!templateId || typeof templateId !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "templateId is required and must be a string",
        400
      );
    }

    // Validate templateType if provided
    if (templateType && !['Front', 'Back'].includes(templateType)) {
      return errorResponse(
        "INVALID_INPUT",
        "templateType must be either 'Front' or 'Back'",
        400
      );
    }

    // Validate postcardSize if provided
    if (postcardSize && !['4x6', '6x9', '6x11'].includes(postcardSize)) {
      return errorResponse(
        "INVALID_INPUT",
        "postcardSize must be either '4x6', '6x9', or '6x11'",
        400
      );
    }

    // Check if at least one field to update is provided
    if (!html && !description && !templateType && !postcardSize) {
      return errorResponse(
        "INVALID_INPUT",
        "At least one field (html, description, templateType, or postcardSize) must be provided for update",
        400
      );
    }

    // Helper function to check if string is a valid UUID
    function isUUID(str: string): boolean {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      return uuidRegex.test(str);
    }

    // Determine if templateId is a UUID (database ID) or PostGrid template ID
    const isDbId = isUUID(templateId);

    let query = supabase
      .from("templates")
      .select("*")
      .eq("organization_id", organizationId);

    // Query by appropriate field
    if (isDbId) {
      query = query.eq("id", templateId);
    } else {
      query = query.eq("postgrid_template_id", templateId);
    }

    const { data: template, error: fetchError } = await query.single();

    if (fetchError || !template) {
      return errorResponse(
        "TEMPLATE_NOT_FOUND",
        "Template not found or doesn't belong to your organization",
        404
      );
    }

    // Check if template is deleted
    if (template.deleted) {
      return errorResponse(
        "TEMPLATE_DELETED",
        "Cannot update a deleted template",
        410
      );
    }

    // Build PostGrid update request body
    const formData = new URLSearchParams();
    if (html) {
      formData.append('html', html);
    }
    if (description) {
      formData.append('description', description);
    }

    // Update template in PostGrid
    let postgridResponse: Response;
    try {
      postgridResponse = await fetch(
        `https://api.postgrid.com/print-mail/v1/templates/${template.postgrid_template_id}`,
        {
          method: 'POST',
          headers: {
            'x-api-key': postgridApiKey,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: formData.toString()
        }
      );
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
        postgridResponse.status
      );
    }

    let updatedPostgridTemplate: any;
    try {
      updatedPostgridTemplate = await postgridResponse.json();
    } catch (jsonError) {
      console.error("Error parsing PostGrid response:", jsonError);
      return errorResponse(
        "POSTGRID_RESPONSE_ERROR",
        "Failed to parse PostGrid API response",
        500
      );
    }

    // Update template in database
    const dbUpdateData: any = {
      updated_at: new Date().toISOString()
    };

    if (html) {
      dbUpdateData.html = updatedPostgridTemplate.html || html;
    }
    if (description) {
      dbUpdateData.description = updatedPostgridTemplate.description || description;
    }
    if (templateType) {
      dbUpdateData.template_type = templateType;
    }
    if (postcardSize) {
      dbUpdateData.postcard_size = postcardSize;
    }

    // Update live status from PostGrid response
    if (updatedPostgridTemplate.live !== undefined) {
      dbUpdateData.live = updatedPostgridTemplate.live;
    }

    const { data: updatedTemplate, error: updateError } = await supabase
      .from("templates")
      .update(dbUpdateData)
      .eq("id", template.id)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating template in database:", updateError);
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to update template in database",
        500
      );
    }

    // Log template update history
    const updatedFields = [];
    if (html) updatedFields.push("html");
    if (description) updatedFields.push("description");
    if (templateType) updatedFields.push("templateType");
    if (postcardSize) updatedFields.push("postcardSize");
    await logTemplateHistory(
      supabase,
      template.id,
      user.userId,
      user.userName,
      `updated template (${updatedFields.join(", ")})`
    );

    const processingTimeMs = Date.now() - startTime;

    // Create notification for template update (for ADMIN only)
    const templateName = updatedTemplate.description || updatedTemplate.postgrid_template_id;
    await createNotification({
      supabase,
      organizationId,
      notificationType: "TEMPLATE_UPDATED",
      title: "Template Updated",
      description: `Template "${templateName}" updated (${updatedFields.join(", ")})`,
      targetRoles: ROLES.ADMIN_ONLY,
      metadata: {
        template_id: updatedTemplate.id,
        template_name: templateName,
        postgrid_template_id: updatedTemplate.postgrid_template_id,
        fields_updated: updatedFields,
        template_type: updatedTemplate.template_type,
        postcard_size: updatedTemplate.postcard_size
      }
    });

    // Build response
    const response = {
      status: "success",
      message: "Template updated successfully",
      template: {
        id: updatedTemplate.id,
        postgrid_template_id: updatedTemplate.postgrid_template_id,
        description: updatedTemplate.description,
        html: updatedTemplate.html,
        templateType: updatedTemplate.template_type,
        postcardSize: updatedTemplate.postcard_size,
        campaigns_used: updatedTemplate.campaigns_used,
        createdBy: updatedTemplate.created_by,
        live: updatedTemplate.live,
        deleted: updatedTemplate.deleted,
        created_at: updatedTemplate.created_at,
        updated_at: updatedTemplate.updated_at
      },
      processingTimeMs
    };

    return successResponse(response, 200);

  } catch (error) {
    console.error("Unexpected error in updateTemplate:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
