import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { logTemplateHistory } from "../_shared/templateHistory.ts";

/**
 * Delete Template Edge Function
 * Deletes a template from both PostGrid and the database
 *
 * Business Rules:
 * - Requires template ID and PostGrid API key
 * - Template must belong to user's organization
 * - Deletes template from PostGrid first
 * - Then marks template as deleted in database (soft delete)
 * - Returns error if template not found or doesn't belong to organization
 *
 * Request body:
 * {
 *   "templateId": string (uuid, required),
 *   "postgridApiKey": string (required)
 * }
 */

interface RequestBody {
  templateId: string;
  postgridApiKey: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow DELETE or POST requests
  if (req.method !== "DELETE" && req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only DELETE and POST methods are allowed", 405);
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
    const { templateId, postgridApiKey } = requestBody;

    if (!templateId || typeof templateId !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "templateId is required and must be a string",
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

    // Fetch template from database to verify ownership and get PostGrid ID
    const { data: template, error: fetchError } = await supabase
      .from("templates")
      .select("*")
      .eq("id", templateId)
      .eq("organization_id", organizationId)
      .single();

    if (fetchError || !template) {
      return errorResponse(
        "TEMPLATE_NOT_FOUND",
        "Template not found or doesn't belong to your organization",
        404
      );
    }

    // Check if template is already deleted
    if (template.deleted) {
      return errorResponse(
        "TEMPLATE_ALREADY_DELETED",
        "Template is already deleted",
        400
      );
    }

    // Delete template from PostGrid
    let postgridResponse: Response;
    try {
      postgridResponse = await fetch(
        `https://api.postgrid.com/print-mail/v1/templates/${template.postgrid_template_id}`,
        {
          method: 'DELETE',
          headers: {
            'x-api-key': postgridApiKey
          }
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
        500
      );
    }

    // Mark template as deleted in database (soft delete)
    const { error: updateError } = await supabase
      .from("templates")
      .update({
        deleted: true,
        updated_at: new Date().toISOString()
      })
      .eq("id", templateId);

    if (updateError) {
      console.error("Error updating template in database:", updateError);
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to delete template from database",
        500
      );
    }

    // Log template deletion history
    await logTemplateHistory(
      supabase,
      templateId,
      user.userId,
      user.userName,
      "deleted template"
    );

    const processingTimeMs = Date.now() - startTime;

    // Build response
    const response = {
      status: "success",
      message: "Template deleted successfully",
      template: {
        id: template.id,
        postgrid_template_id: template.postgrid_template_id,
        description: template.description
      },
      processingTimeMs
    };

    return successResponse(response, 200);

  } catch (error) {
    console.error("Unexpected error in deleteTemplate:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
