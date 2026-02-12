import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { logReferralHistory, getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Change Photo Type By ID Edge Function
 * Updates the type of a specific photo in a gallery
 *
 * Business Rules:
 * - Requires id (photo ID) and type in request body
 * - Valid types: "before", "after", "none"
 * - Case-insensitive type matching (converts to lowercase)
 * - Updates the photo type in the gallery's images array
 */
Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow PATCH/PUT requests
  if (req.method !== "PATCH" && req.method !== "PUT") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only PATCH or PUT methods are allowed", 405);
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

    const { id, type } = body;

    // Validate required fields
    if (!id) {
      return errorResponse(
        "INVALID_INPUT",
        "Photo ID is required",
        400
      );
    }

    if (!type) {
      return errorResponse(
        "INVALID_INPUT",
        "Type is required",
        400
      );
    }

    // Validate type value (case-insensitive)
    const validTypes = ["before", "after", "none"];
    const normalizedType = type.toLowerCase();

    if (!validTypes.includes(normalizedType)) {
      return errorResponse(
        "INVALID_INPUT",
        `Invalid type. Must be one of: ${validTypes.join(", ")}`,
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

    // Find the gallery containing this photo (join with referrals to check organization)
    const { data: galleries, error: fetchError } = await supabase
      .from("gallery")
      .select(`
        *,
        referrals!inner(organization_id)
      `)
      .eq("referrals.organization_id", organizationId);

    if (fetchError) {
      console.error("Error fetching galleries:", fetchError);
      return errorResponse(
        "GALLERY_FETCH_FAILED",
        "Failed to fetch galleries",
        500
      );
    }

    // Find the gallery that contains the photo with the given ID
    let targetGallery = null;
    let photoIndex = -1;

    for (const gallery of galleries || []) {
      const images = gallery.images || [];
      const index = images.findIndex((img: any) => img.id === id);
      if (index !== -1) {
        targetGallery = gallery;
        photoIndex = index;
        break;
      }
    }

    // If photo not found in any gallery
    if (!targetGallery || photoIndex === -1) {
      return errorResponse(
        "PHOTO_NOT_FOUND",
        "Photo not found in any gallery",
        404
      );
    }

    // Update the photo type
    const updatedImages = [...targetGallery.images];
    updatedImages[photoIndex] = {
      ...updatedImages[photoIndex],
      type: normalizedType
    };

    // Update the gallery
    const { data: updatedGallery, error: updateError } = await supabase
      .from("gallery")
      .update({
        images: updatedImages,
        updated_at: new Date().toISOString()
      })
      .eq("id", targetGallery.id)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating gallery:", updateError);
      return errorResponse(
        "GALLERY_UPDATE_FAILED",
        "Failed to update photo type",
        500
      );
    }

    // Log referral history
    await logReferralHistory(
      supabase,
      targetGallery.referral_id,
      user.userId,
      user.userName,
      `changed photo type to "${normalizedType}"`
    );

    // Return success response with updated photo
    return successResponse(
      {
        status: "success",
        message: "Photo type updated successfully",
        data: {
          gallery: updatedGallery,
          updated_photo: updatedImages[photoIndex]
        }
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in changePhotoTypeById:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
