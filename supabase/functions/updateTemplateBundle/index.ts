import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient, isAdmin } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { logTemplateHistory } from "../_shared/templateHistory.ts";
import { createNotification, ROLES } from "../_shared/notifications.ts";

/**
 * Update Template Bundle Edge Function
 * Updates both front and back templates in a bundle
 *
 * Business Rules:
 * - Requires bundle ID and PostGrid API key
 * - Bundle must belong to user's organization (or be universal and user is ADMIN)
 * - Can update html_front, html_back, and/or description
 * - Updates PostGrid templates first, then database
 * - Description changes automatically append " Front" and " Back"
 *
 * Request body:
 * {
 *   "postgridApiKey": string (required),
 *   "template_bundle_id": string (required),
 *   "html_front": string (optional),
 *   "html_back": string (optional),
 *   "description": string (optional)
 * }
 */

interface RequestBody {
  postgridApiKey: string;
  template_bundle_id: string;
  html_front?: string;
  html_back?: string;
  description?: string;
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

    const { postgridApiKey, template_bundle_id, html_front, html_back, description } = requestBody;

    // Validate required fields
    if (!template_bundle_id || typeof template_bundle_id !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "template_bundle_id is required and must be a string",
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

    // Validate at least one update field provided
    if (!html_front && !html_back && !description) {
      return errorResponse(
        "INVALID_INPUT",
        "At least one of html_front, html_back, or description must be provided",
        400
      );
    }

    // Fetch bundle from database
    const { data: bundle, error: bundleError } = await supabase
      .from("template_bundles")
      .select(`
        *,
        front:template_front_id (*),
        back:template_back_id (*)
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

    // Check ownership - must be user's org or universal (and user is ADMIN)
    if (bundle.is_universal) {
      const isUserAdmin = await isAdmin(user.userId);
      if (!isUserAdmin) {
        return errorResponse(
          "FORBIDDEN",
          "Only ADMIN users can update universal template bundles",
          403
        );
      }
    } else if (bundle.organization_id !== organizationId) {
      return errorResponse(
        "FORBIDDEN",
        "Bundle doesn't belong to your organization",
        403
      );
    }

    const frontTemplate = bundle.front;
    const backTemplate = bundle.back;

    const updatedFields: string[] = [];

    // Update front template if html_front or description provided
    if (html_front || description) {
      const frontFormData = new URLSearchParams();
      if (html_front) {
        frontFormData.append('html', html_front);
      }
      if (description) {
        frontFormData.append('description', `${description} Front`);
      }

      const frontResponse = await fetch(
        `https://api.postgrid.com/print-mail/v1/templates/${frontTemplate.postgrid_template_id}`,
        {
          method: 'POST',
          headers: {
            'x-api-key': postgridApiKey,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: frontFormData.toString()
        }
      );

      if (!frontResponse.ok) {
        const errorText = await frontResponse.text();
        console.error("PostGrid API error (front update):", errorText);
        return errorResponse(
          "POSTGRID_API_ERROR",
          `Failed to update front template in PostGrid: ${frontResponse.status} - ${errorText}`,
          500
        );
      }

      const updatedFrontTemplate = await frontResponse.json();

      // Update front template in database
      const dbUpdateData: any = { updated_at: new Date().toISOString() };
      if (html_front) {
        dbUpdateData.html = updatedFrontTemplate.html || html_front;
        updatedFields.push('html_front');
      }
      if (description) {
        dbUpdateData.description = updatedFrontTemplate.description || `${description} Front`;
        updatedFields.push('description');
      }

      const { error: frontUpdateError } = await supabase
        .from("templates")
        .update(dbUpdateData)
        .eq("id", frontTemplate.id);

      if (frontUpdateError) {
        console.error("Error updating front template in database:", frontUpdateError);
        return errorResponse(
          "DATABASE_ERROR",
          "Failed to update front template in database",
          500
        );
      }

      await logTemplateHistory(
        supabase,
        frontTemplate.id,
        user.userId,
        user.userName,
        `updated front template in bundle (${updatedFields.join(", ")})`
      );
    }

    // Update back template if html_back or description provided
    if (html_back || description) {
      const backFormData = new URLSearchParams();
      if (html_back) {
        backFormData.append('html', html_back);
      }
      if (description) {
        backFormData.append('description', `${description} Back`);
      }

      const backResponse = await fetch(
        `https://api.postgrid.com/print-mail/v1/templates/${backTemplate.postgrid_template_id}`,
        {
          method: 'POST',
          headers: {
            'x-api-key': postgridApiKey,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: backFormData.toString()
        }
      );

      if (!backResponse.ok) {
        const errorText = await backResponse.text();
        console.error("PostGrid API error (back update):", errorText);
        return errorResponse(
          "POSTGRID_API_ERROR",
          `Failed to update back template in PostGrid: ${backResponse.status} - ${errorText}`,
          500
        );
      }

      const updatedBackTemplate = await backResponse.json();

      // Update back template in database
      const dbUpdateData: any = { updated_at: new Date().toISOString() };
      if (html_back) {
        dbUpdateData.html = updatedBackTemplate.html || html_back;
        if (!updatedFields.includes('html_back')) updatedFields.push('html_back');
      }
      if (description) {
        dbUpdateData.description = updatedBackTemplate.description || `${description} Back`;
      }

      const { error: backUpdateError } = await supabase
        .from("templates")
        .update(dbUpdateData)
        .eq("id", backTemplate.id);

      if (backUpdateError) {
        console.error("Error updating back template in database:", backUpdateError);
        return errorResponse(
          "DATABASE_ERROR",
          "Failed to update back template in database",
          500
        );
      }

      await logTemplateHistory(
        supabase,
        backTemplate.id,
        user.userId,
        user.userName,
        `updated back template in bundle (${updatedFields.join(", ")})`
      );
    }

    // Update bundle timestamp
    await supabase
      .from("template_bundles")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", template_bundle_id);

    // Fetch updated bundle
    const { data: updatedBundle, error: fetchError } = await supabase
      .from("template_bundles")
      .select(`
        *,
        front:template_front_id (*),
        back:template_back_id (*)
      `)
      .eq("id", template_bundle_id)
      .single();

    if (fetchError) {
      console.error("Error fetching updated bundle:", fetchError);
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to fetch updated bundle",
        500
      );
    }

    const processingTimeMs = Date.now() - startTime;

    // Create notification
    if (!bundle.is_universal) {
      await createNotification({
        supabase,
        organizationId: bundle.organization_id,
        title: "Template Bundle Updated",
        message: `${user.userName} updated template bundle`,
        targetRoles: [ROLES.ADMIN],
        metadata: {
          bundle_id: template_bundle_id,
          fields_updated: updatedFields
        }
      });
    }

    // Build response
    const response = {
      status: "success",
      message: "Template bundle updated successfully",
      bundle: {
        id: updatedBundle.id,
        isUniversal: updatedBundle.is_universal,
        front_template: {
          id: updatedBundle.front.id,
          postgrid_template_id: updatedBundle.front.postgrid_template_id,
          description: updatedBundle.front.description,
          html: updatedBundle.front.html,
          templateType: updatedBundle.front.template_type,
          postcardSize: updatedBundle.front.postcard_size,
          isUniversal: updatedBundle.front.is_universal,
          isManualEdit: updatedBundle.front.is_manual_edit,
          campaigns_used: updatedBundle.front.campaigns_used,
          createdBy: updatedBundle.front.created_by,
          live: updatedBundle.front.live,
          deleted: updatedBundle.front.deleted,
          created_at: updatedBundle.front.created_at,
          updated_at: updatedBundle.front.updated_at
        },
        back_template: {
          id: updatedBundle.back.id,
          postgrid_template_id: updatedBundle.back.postgrid_template_id,
          description: updatedBundle.back.description,
          html: updatedBundle.back.html,
          templateType: updatedBundle.back.template_type,
          postcardSize: updatedBundle.back.postcard_size,
          isUniversal: updatedBundle.back.is_universal,
          isManualEdit: updatedBundle.back.is_manual_edit,
          campaigns_used: updatedBundle.back.campaigns_used,
          createdBy: updatedBundle.back.created_by,
          live: updatedBundle.back.live,
          deleted: updatedBundle.back.deleted,
          created_at: updatedBundle.back.created_at,
          updated_at: updatedBundle.back.updated_at
        },
        created_at: updatedBundle.created_at,
        updated_at: updatedBundle.updated_at
      },
      processingTimeMs
    };

    return successResponse(response, 200);

  } catch (error) {
    console.error("Unexpected error in updateTemplateBundle:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
