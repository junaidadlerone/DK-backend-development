import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { getPreferences } from "../_shared/preferences.ts";

/**
 * Get All Templates Edge Function
 * Returns all templates for the user's organization plus universal templates
 *
 * Business Rules:
 * - Returns templates belonging to user's organization AND universal templates
 * - Universal templates (is_universal=true) are visible to all organizations
 * - Excludes manual edit templates (is_manual_edit=true) UNLESS campaign_id is provided
 * - When campaign_id is provided, includes manual edit templates that contain the campaign_id in campaigns_used array
 * - User must be authenticated and in organization
 * - Returns templates ordered by created_at (newest first)
 * - Excludes deleted templates by default
 *
 * Query parameters (optional):
 * - includeDeleted: boolean (default: false) - Include deleted templates
 * - templateType: "Front" | "Back" - Filter by template type
 * - postcardSize: "4x6" | "6x9" | "6x11" - Filter by postcard size
 * - campaign_id: string - When provided, also includes manual edit templates for this campaign
 */

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow GET requests
  if (req.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only GET method is allowed", 405);
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

    // Parse query parameters
    const url = new URL(req.url);
    const includeDeleted = url.searchParams.get('includeDeleted') === 'true';
    const templateType = url.searchParams.get('templateType');
    const postcardSize = url.searchParams.get('postcardSize');
    const campaignId = url.searchParams.get('campaign_id');

    // Build query to get organization templates OR universal templates
    // Exclude manual edit templates by default (is_manual_edit=false OR is_manual_edit IS NULL)
    let query = supabase
      .from("templates")
      .select("*")
      .or(`organization_id.eq.${organizationId},is_universal.eq.true`)
      .or(`is_manual_edit.is.null,is_manual_edit.eq.false`);

    // Apply filters
    if (!includeDeleted) {
      query = query.eq("deleted", false);
    }

    if (templateType && ['Front', 'Back'].includes(templateType)) {
      query = query.eq("template_type", templateType);
    }

    if (postcardSize && ['4x6', '6x9', '6x11'].includes(postcardSize)) {
      query = query.eq("postcard_size", postcardSize);
    }

    // Order by created_at descending (newest first)
    query = query.order("created_at", { ascending: false });

    const { data: templates, error: fetchError } = await query;

    if (fetchError) {
      console.error("Error fetching templates:", fetchError);
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to fetch templates",
        500
      );
    }

    // If campaign_id is provided, also fetch manual edit templates for this campaign
    let manualEditTemplates = [];
    if (campaignId) {
      let manualQuery = supabase
        .from("templates")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("is_manual_edit", true)
        .filter("campaigns_used", "cs", `["${campaignId}"]`);

      // Apply same filters
      if (!includeDeleted) {
        manualQuery = manualQuery.eq("deleted", false);
      }

      if (templateType && ['Front', 'Back'].includes(templateType)) {
        manualQuery = manualQuery.eq("template_type", templateType);
      }

      if (postcardSize && ['4x6', '6x9', '6x11'].includes(postcardSize)) {
        manualQuery = manualQuery.eq("postcard_size", postcardSize);
      }

      const { data: manualTemplates, error: manualError } = await manualQuery;

      if (manualError) {
        console.error("Error fetching manual edit templates:", manualError);
        // Don't fail the request, just log the error
      } else if (manualTemplates) {
        manualEditTemplates = manualTemplates;
      }
    }

    // Combine regular templates and manual edit templates
    const allTemplates = [...templates, ...manualEditTemplates];

    // Remove duplicates (in case a template appears in both queries)
    const uniqueTemplates = allTemplates.filter((template, index, self) =>
      index === self.findIndex((t) => t.id === template.id)
    );

    // Sort by created_at descending
    uniqueTemplates.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Fetch user preferences
    const preferences = await getPreferences(supabase, user.userId);

    // Transform templates to response format
    const transformedTemplates = uniqueTemplates.map(template => ({
      id: template.id,
      postgrid_template_id: template.postgrid_template_id,
      description: template.description,
      html: template.html,
      templateType: template.template_type,
      postcardSize: template.postcard_size,
      isUniversal: template.is_universal || false,
      isManualEdit: template.is_manual_edit || false,
      campaigns_used: template.campaigns_used || [],
      createdBy: template.created_by,
      live: template.live,
      deleted: template.deleted,
      created_at: template.created_at,
      created_at_tz: enrichTimestamp(template.created_at, preferences.timezone),
      updated_at: template.updated_at,
      updated_at_tz: enrichTimestamp(template.updated_at, preferences.timezone)
    }));

    const processingTimeMs = Date.now() - startTime;

    // Build response
    const response = {
      status: "success",
      message: `Found ${transformedTemplates.length} template(s)`,
      metadata: {
        total_templates: transformedTemplates.length,
        filters_applied: {
          includeDeleted,
          templateType: templateType || null,
          postcardSize: postcardSize || null,
          campaign_id: campaignId || null
        },
        processingTimeMs
      },
      templates: transformedTemplates
    };

    return successResponse(response, 200);

  } catch (error) {
    console.error("Unexpected error in getAllTemplates:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
