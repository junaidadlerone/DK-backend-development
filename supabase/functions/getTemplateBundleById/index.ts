import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Get Template Bundle By ID
 * 
 * Returns detailed template bundle data including full front and back template objects.
 * Template bundle must be accessible to the user (organization or universal).
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

    // Get bundle_id from query parameters
    const url = new URL(req.url);
    const bundleId = url.searchParams.get("bundle_id");

    if (!bundleId) {
      return errorResponse(
        "INVALID_INPUT",
        "bundle_id query parameter is required",
        400
      );
    }

    // Fetch template bundle (must be organization or universal)
    const { data: bundle, error: bundleError } = await supabase
      .from("template_bundles")
      .select(`
        id,
        template_front_id,
        template_back_id,
        organization_id,
        is_universal,
        show_restriction_annotations_tooltips,
        show_restriction_area_warning,
        created_at,
        updated_at
      `)
      .eq("id", bundleId)
      .or(`organization_id.eq.${organizationId},is_universal.eq.true`)
      .single();

    if (bundleError || !bundle) {
      return errorResponse(
        "BUNDLE_NOT_FOUND",
        "Template bundle not found or not accessible",
        404
      );
    }

    // Fetch front template with full details
    const { data: frontTemplate, error: frontError } = await supabase
      .from("templates")
      .select("*")
      .eq("id", bundle.template_front_id)
      .single();

    if (frontError || !frontTemplate) {
      return errorResponse(
        "FRONT_TEMPLATE_NOT_FOUND",
        "Front template not found",
        404
      );
    }

    // Fetch back template with full details
    const { data: backTemplate, error: backError } = await supabase
      .from("templates")
      .select("*")
      .eq("id", bundle.template_back_id)
      .single();

    if (backError || !backTemplate) {
      return errorResponse(
        "BACK_TEMPLATE_NOT_FOUND",
        "Back template not found",
        404
      );
    }

    return successResponse(
      {
        status: "success",
        message: "Template bundle retrieved successfully",
        data: {
          bundle: {
            id: bundle.id,
            organization_id: bundle.organization_id,
            is_universal: bundle.is_universal,
            show_restriction_annotations_tooltips: bundle.show_restriction_annotations_tooltips ?? false,
            show_restriction_area_warning: bundle.show_restriction_area_warning ?? false,
            created_at: bundle.created_at,
            updated_at: bundle.updated_at
          },
          front_template: frontTemplate,
          back_template: backTemplate
        },
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in getTemplateBundleById:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
