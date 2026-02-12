import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Delete Address Zone Edge Function
 * Deletes a specific location zone by ID
 *
 * Business Rules:
 * - Requires zone ID in request body
 * - Organization-based (user must be in same organization as zone)
 * - Cascade deletes will handle related data (if any campaigns reference this zone, zone_id will be set to NULL)
 */
Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow DELETE requests
  if (req.method !== "DELETE") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only DELETE method is allowed", 405);
  }

  try {
    // Parse request body
    let body: any;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      return errorResponse(
        "INVALID_INPUT",
        "Invalid JSON format in request body",
        400
      );
    }

    const { id } = body;

    // Validate required ID
    if (!id) {
      return errorResponse(
        "INVALID_INPUT",
        "Zone ID is required",
        400
      );
    }

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

    // Verify zone exists and belongs to user's organization before deletion
    const { data: existingZone, error: fetchError } = await supabase
      .from("location_zones")
      .select("id, campaign_id")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .single();

    if (fetchError || !existingZone) {
      return errorResponse(
        "ZONE_NOT_FOUND",
        "Zone not found in your organization",
        404
      );
    }

    // Delete the zone
    const { error: deleteError } = await supabase
      .from("location_zones")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId);

    if (deleteError) {
      console.error("Error deleting zone:", deleteError);
      return errorResponse(
        "DELETE_FAILED",
        "Failed to delete zone",
        500
      );
    }

    // Return success
    return successResponse(
      {
        status: "success",
        message: "Zone deleted successfully",
        data: {
          id: id,
          deleted: true
        }
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in deleteAddressZone:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
