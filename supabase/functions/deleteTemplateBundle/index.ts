import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient, isAdmin } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { logTemplateHistory } from "../_shared/templateHistory.ts";
import { callerRoleOnOrg } from "../_shared/agencyGate.ts";

/**
 * Delete Template Bundle Edge Function
 * Deletes both front and back templates from PostGrid and database
 *
 * Business Rules:
 * - Requires bundle ID and PostGrid API key
 * - Bundle must belong to user's organization (or be universal and user is ADMIN)
 * - Deletes both templates from PostGrid
 * - Marks both templates as deleted in database (soft delete)
 * - Bundle record will be cascade deleted when templates are deleted
 *
 * Request body:
 * {
 *   "template_bundle_id": string (required),
 *   "postgridApiKey": string (required)
 * }
 */

interface RequestBody {
  template_bundle_id: string;
  postgridApiKey: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow POST or DELETE requests
  if (req.method !== "POST" && req.method !== "DELETE") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST and DELETE methods are allowed", 405);
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

    const { template_bundle_id, postgridApiKey } = requestBody;

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

    // Access check.
    // Service-role bypass (internal callers go through unchecked).
    // For non-universal bundles, only the OWNER or ADMIN of the bundle's
    // OWNING org may delete it. Active-org / share-list membership do NOT
    // grant delete rights. This intentionally tightens the prior V1 rule
    // (any member of the owning org) so that:
    //   1. Sub-org members who received the bundle via shared_with_organization_ids
    //      cannot delete it (share = read access only).
    //   2. Lower-privilege members (MARKETER, TECHNICIAN) of the owning org
    //      cannot delete it either.
    if (!user.isServiceRole) {
      if (bundle.is_universal) {
        const isUserAdmin = await isAdmin(user.userId);
        if (!isUserAdmin) {
          return errorResponse(
            "FORBIDDEN",
            "Only ADMIN users can delete universal template bundles",
            403
          );
        }
      } else {
        if (!bundle.organization_id) {
          return errorResponse(
            "BUNDLE_HAS_NO_OWNER_ORG",
            "Bundle has no owning organization; cannot resolve delete permission",
            400
          );
        }

        const { data: ownerOrg, error: ownerErr } = await supabase
          .from("organizations")
          .select("id, owner_id, organization_members")
          .eq("id", bundle.organization_id)
          .single();
        if (ownerErr || !ownerOrg) {
          return errorResponse("FETCH_FAILED", "Failed to load owning organization", 500);
        }
        const role = callerRoleOnOrg(ownerOrg, user.userId);
        if (role !== "OWNER" && role !== "ADMIN") {
          return errorResponse(
            "NOT_BUNDLE_ADMIN",
            "Only OWNER or ADMIN of the bundle's owning organization can delete it",
            403
          );
        }
      }
    }

    const frontTemplate = bundle.front;
    const backTemplate = bundle.back;

    // Check if templates are already deleted
    if (frontTemplate.deleted && backTemplate.deleted) {
      return errorResponse(
        "BUNDLE_ALREADY_DELETED",
        "Template bundle is already deleted",
        400
      );
    }

    // Delete front template from PostGrid
    if (!frontTemplate.deleted) {
      try {
        const frontResponse = await fetch(
          `https://api.postgrid.com/print-mail/v1/templates/${frontTemplate.postgrid_template_id}`,
          {
            method: 'DELETE',
            headers: { 'x-api-key': postgridApiKey }
          }
        );

        if (!frontResponse.ok) {
          const errorText = await frontResponse.text();
          console.error("PostGrid API error (front delete):", errorText);
          return errorResponse(
            "POSTGRID_API_ERROR",
            `Failed to delete front template from PostGrid: ${frontResponse.status} - ${errorText}`,
            500
          );
        }
      } catch (fetchError) {
        console.error("Error deleting front template from PostGrid:", fetchError);
        return errorResponse(
          "POSTGRID_API_ERROR",
          "Failed to connect to PostGrid API for front template deletion",
          500
        );
      }
    }

    // Delete back template from PostGrid
    if (!backTemplate.deleted) {
      try {
        const backResponse = await fetch(
          `https://api.postgrid.com/print-mail/v1/templates/${backTemplate.postgrid_template_id}`,
          {
            method: 'DELETE',
            headers: { 'x-api-key': postgridApiKey }
          }
        );

        if (!backResponse.ok) {
          const errorText = await backResponse.text();
          console.error("PostGrid API error (back delete):", errorText);
          return errorResponse(
            "POSTGRID_API_ERROR",
            `Failed to delete back template from PostGrid: ${backResponse.status} - ${errorText}`,
            500
          );
        }
      } catch (fetchError) {
        console.error("Error deleting back template from PostGrid:", fetchError);
        return errorResponse(
          "POSTGRID_API_ERROR",
          "Failed to connect to PostGrid API for back template deletion",
          500
        );
      }
    }

    // Mark front template as deleted in database (soft delete)
    if (!frontTemplate.deleted) {
      const { error: frontDeleteError } = await supabase
        .from("templates")
        .update({
          deleted: true,
          updated_at: new Date().toISOString()
        })
        .eq("id", frontTemplate.id);

      if (frontDeleteError) {
        console.error("Error marking front template as deleted:", frontDeleteError);
        return errorResponse(
          "DATABASE_ERROR",
          "Failed to delete front template from database",
          500
        );
      }

      await logTemplateHistory(
        supabase,
        frontTemplate.id,
        user.userId,
        user.userName,
        "deleted front template in bundle"
      );
    }

    // Mark back template as deleted in database (soft delete)
    if (!backTemplate.deleted) {
      const { error: backDeleteError } = await supabase
        .from("templates")
        .update({
          deleted: true,
          updated_at: new Date().toISOString()
        })
        .eq("id", backTemplate.id);

      if (backDeleteError) {
        console.error("Error marking back template as deleted:", backDeleteError);
        return errorResponse(
          "DATABASE_ERROR",
          "Failed to delete back template from database",
          500
        );
      }

      await logTemplateHistory(
        supabase,
        backTemplate.id,
        user.userId,
        user.userName,
        "deleted back template in bundle"
      );
    }

    const processingTimeMs = Date.now() - startTime;

    // Build response
    const response = {
      status: "success",
      message: "Template bundle deleted successfully",
      bundle: {
        id: bundle.id,
        front_template: {
          id: frontTemplate.id,
          postgrid_template_id: frontTemplate.postgrid_template_id,
          description: frontTemplate.description
        },
        back_template: {
          id: backTemplate.id,
          postgrid_template_id: backTemplate.postgrid_template_id,
          description: backTemplate.description
        }
      },
      processingTimeMs
    };

    return successResponse(response, 200);

  } catch (error) {
    console.error("Unexpected error in deleteTemplateBundle:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
