import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { getPreferences } from "../_shared/preferences.ts";

/**
 * Get Template By ID Edge Function
 * Retrieves a single template by either database ID or PostGrid template ID
 *
 * Business Rules:
 * - Accepts either database UUID or PostGrid template ID
 * - Template must belong to user's organization OR be a universal template
 * - Universal templates (is_universal=true) are accessible to all organizations
 * - User must be authenticated and in organization
 * - Returns complete template details including isUniversal flag
 *
 * Request body:
 * {
 *   "templateId": string (required) - Can be either database UUID or PostGrid template ID
 * }
 */

interface RequestBody {
  templateId: string;
}

// Helper function to check if string is a valid UUID
function isUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
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
    let organizationId: string | null = null;
    if (!user.isServiceRole) {
      organizationId = await getUserOrganizationId(supabase, user.userId);
      if (!organizationId) {
        return errorResponse(
          "NO_ORGANIZATION",
          "User is not associated with any organization",
          403
        );
      }
    }

    // Parse request body
    let requestBody: RequestBody;
    try {
      requestBody = await req.json();
    } catch (_parseError) {
      return errorResponse(
        "INVALID_INPUT",
        "Invalid JSON in request body",
        400
      );
    }

    // Validate required fields
    const { templateId } = requestBody;

    if (!templateId || typeof templateId !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "templateId is required and must be a string",
        400
      );
    }

    // Determine if templateId is a UUID (database ID) or PostGrid template ID
    const isDbId = isUUID(templateId);

    // Fetch the template by id / postgrid id. Access is checked in JS afterward
    // so we can honor V3 agency sharing (which lives on template_bundles, not
    // on the templates table).
    let query = supabase.from("templates").select("*");

    if (isDbId) {
      query = query.eq("id", templateId);
    } else {
      query = query.eq("postgrid_template_id", templateId);
    }

    const { data: template, error: fetchError } = await query.single();

    if (fetchError || !template) {
      console.error("Error fetching template:", fetchError);
      return errorResponse(
        "TEMPLATE_NOT_FOUND",
        "Template not found or doesn't belong to your organization",
        404
      );
    }

    // Access check (skipped for service role):
    //   1. template is owned by the active org
    //   2. template is universal
    //   3. template is the front/back of a bundle shared with the active org
    //      (V3 agency sharing — added so single-template fetch stays in sync
    //      with getTemplateBundleById / getAllTemplatesBundles, which already
    //      surface shared-in templates for the active org).
    // Returns 404 (not 403) when inaccessible, preserving the original behavior
    // of not disclosing whether the template exists.
    if (!user.isServiceRole) {
      const ownsTemplate = template.organization_id === organizationId;
      const isUniversal = template.is_universal === true;

      let isSharedViaBundle = false;
      if (!ownsTemplate && !isUniversal) {
        const { data: sharedBundles } = await supabase
          .from("template_bundles")
          .select("id")
          .or(
            `template_front_id.eq.${template.id},template_back_id.eq.${template.id}`,
          )
          .contains("shared_with_organization_ids", [organizationId])
          .limit(1);
        isSharedViaBundle = Array.isArray(sharedBundles) &&
          sharedBundles.length > 0;
      }

      if (!ownsTemplate && !isUniversal && !isSharedViaBundle) {
        return errorResponse(
          "TEMPLATE_NOT_FOUND",
          "Template not found or doesn't belong to your organization",
          404,
        );
      }
    }

    // Check if template is deleted
    if (template.deleted) {
      return errorResponse(
        "TEMPLATE_DELETED",
        "This template has been deleted",
        410 // Gone status code
      );
    }

    const processingTimeMs = Date.now() - startTime;

    // Fetch user preferences (skip for service role)
    const preferences = !user.isServiceRole 
      ? await getPreferences(supabase, user.userId)
      : { timezone: "UTC" };

    // Transform template to response format
    const transformedTemplate = {
      id: template.id,
      postgrid_template_id: template.postgrid_template_id,
      description: template.description,
      html: template.html,
      templateType: template.template_type,
      postcardSize: template.postcard_size,
      isUniversal: template.is_universal || false,
      campaigns_used: template.campaigns_used || [],
      createdBy: template.created_by,
      live: template.live,
      deleted: template.deleted,
      created_at: template.created_at,
      created_at_tz: enrichTimestamp(template.created_at, preferences.timezone),
      updated_at: template.updated_at,
      updated_at_tz: enrichTimestamp(template.updated_at, preferences.timezone)
    };

    // Build response
    const response = {
      status: "success",
      message: "Template retrieved successfully",
      template: transformedTemplate,
      processingTimeMs
    };

    return successResponse(response, 200);

  } catch (error) {
    console.error("Unexpected error in getTemplateById:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${(error as Error).message}`,
      500
    );
  }
});
