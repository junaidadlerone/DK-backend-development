import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Update Address Zone By ID Edge Function
 * Updates a specific location zone by ID
 *
 * Business Rules:
 * - Requires zone ID and update data in request body
 * - Organization-based (user must be in same organization as zone)
 * - Can update: center, mode, search_type, metadata, addresses
 * - Cannot update: id, organization_id, campaign_id
 * - Updates updated_at timestamp automatically
 */
Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow PATCH requests
  if (req.method !== "PATCH") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only PATCH method is allowed", 405);
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

    const { id, ...updateData } = body;

    // Validate required ID
    if (!id) {
      return errorResponse(
        "INVALID_INPUT",
        "Zone ID is required",
        400
      );
    }

    // Validate that there's data to update
    if (Object.keys(updateData).length === 0) {
      return errorResponse(
        "INVALID_INPUT",
        "No update data provided",
        400
      );
    }

    // Prevent updating protected fields
    const protectedFields = ['id', 'organization_id', 'created_at'];
    const attemptedProtectedUpdates = protectedFields.filter(field => field in updateData);
    if (attemptedProtectedUpdates.length > 0) {
      return errorResponse(
        "INVALID_INPUT",
        `Cannot update protected fields: ${attemptedProtectedUpdates.join(', ')}`,
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

    // Verify zone exists and belongs to user's organization
    const { data: existingZone, error: fetchError } = await supabase
      .from("location_zones")
      .select("id")
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

    // Update the zone
    const { data: updatedZone, error: updateError } = await supabase
      .from("location_zones")
      .update({
        ...updateData,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("organization_id", organizationId)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating zone:", updateError);
      return errorResponse(
        "UPDATE_FAILED",
        "Failed to update zone",
        500
      );
    }

    // Return the updated zone
    return successResponse(
      {
        status: "success",
        message: "Zone updated successfully",
        data: updatedZone
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in updateAddressZoneById:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
