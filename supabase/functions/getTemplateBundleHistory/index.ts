import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Get Template Bundle History
 * 
 * Returns combined history of both front and back templates in a template bundle.
 * Merges and sorts history entries by timestamp (newest first).
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
        is_universal
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

    // Fetch front template
    console.log('Fetching front template with ID:', bundle.template_front_id);
    const { data: frontTemplate, error: frontError } = await supabase
      .from("templates")
      .select("id, description, postgrid_template_id")
      .eq("id", bundle.template_front_id)
      .single();

    if (frontError || !frontTemplate) {
      console.error('Front template not found. Error:', frontError);
      return errorResponse(
        "FRONT_TEMPLATE_NOT_FOUND",
        "Front template not found",
        404
      );
    }

    // Fetch back template
    console.log('Fetching back template with ID:', bundle.template_back_id);
    const { data: backTemplate, error: backError } = await supabase
      .from("templates")
      .select("id, description, postgrid_template_id")
      .eq("id", bundle.template_back_id)
      .single();

    if (backError || !backTemplate) {
      console.error('Back template not found. Error:', backError);
      return errorResponse(
        "BACK_TEMPLATE_NOT_FOUND",
        "Back template not found",
        404
      );
    }

    // Fetch history for front template
    const { data: frontHistoryData, error: frontHistoryError } = await supabase
      .from("template_history")
      .select("*")
      .eq("template_id", frontTemplate.id)
      .order("created_at", { ascending: false });
      
    if (frontHistoryError) {
      console.error("Error fetching front template history:", frontHistoryError);
    }

    // Fetch history for back template
    const { data: backHistoryData, error: backHistoryError } = await supabase
      .from("template_history")
      .select("*")
      .eq("template_id", backTemplate.id)
      .order("created_at", { ascending: false });

    if (backHistoryError) {
      console.error("Error fetching back template history:", backHistoryError);
    }

    // Combine and enrich history entries
    const frontHistory = frontHistoryData || [];
    const backHistory = backHistoryData || [];

    // Add template context to each history entry
    const enrichedFrontHistory = frontHistory.map((entry: any) => ({
      ...entry,
      template_type: "front",
      template_id: frontTemplate.id,
      template_description: frontTemplate.description,
      postgrid_template_id: frontTemplate.postgrid_template_id,
      timestamp: entry.created_at // Ensure timestamp is available
    }));

    const enrichedBackHistory = backHistory.map((entry: any) => ({
      ...entry,
      template_type: "back",
      template_id: backTemplate.id,
      template_description: backTemplate.description,
      postgrid_template_id: backTemplate.postgrid_template_id,
      timestamp: entry.created_at // Ensure timestamp is available
    }));

    // Combine both histories
    const combinedHistory = [...enrichedFrontHistory, ...enrichedBackHistory];

    // Sort by timestamp (newest first)
    combinedHistory.sort((a: any, b: any) => {
      const timeA = new Date(a.created_at || a.timestamp || 0).getTime();
      const timeB = new Date(b.created_at || b.timestamp || 0).getTime();
      return timeB - timeA; // Descending order (newest first)
    });

    return successResponse(
      {
        status: "success",
        message: `Found ${combinedHistory.length} history entries`,
        data: {
          bundle_id: bundle.id,
          is_universal: bundle.is_universal,
          templates: {
            front: {
              id: frontTemplate.id,
              description: frontTemplate.description,
              postgrid_template_id: frontTemplate.postgrid_template_id
            },
            back: {
              id: backTemplate.id,
              description: backTemplate.description,
              postgrid_template_id: backTemplate.postgrid_template_id
            }
          },
          history: combinedHistory,
          metadata: {
            total_entries: combinedHistory.length,
            front_entries: enrichedFrontHistory.length,
            back_entries: enrichedBackHistory.length
          }
        },
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in getTemplateBundleHistory:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
