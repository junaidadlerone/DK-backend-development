import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { logReferralHistory, getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Delete Image Edge Function
 * Deletes a specific image from a gallery
 *
 * Business Rules:
 * - Requires image ID in request body
 * - Removes image from gallery's images array
 * - Deletes image file from Supabase Storage
 * - Returns updated gallery after deletion
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
        "Image ID is required",
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

    // Find the gallery containing this image
    // Need to check both referral-level and organization-level galleries
    const { data: referralGalleries, error: referralFetchError } = await supabase
      .from("gallery")
      .select(`
        *,
        referrals!inner(organization_id)
      `)
      .eq("referrals.organization_id", organizationId)
      .not("referral_id", "is", null);

    const { data: orgGalleries, error: orgFetchError } = await supabase
      .from("gallery")
      .select("*")
      .eq("organization_id", organizationId)
      .is("referral_id", null);

    if (referralFetchError && orgFetchError) {
      console.error("Error fetching galleries:", referralFetchError, orgFetchError);
      return errorResponse(
        "GALLERY_FETCH_FAILED",
        "Failed to fetch galleries",
        500
      );
    }

    // Combine both types of galleries
    const galleries = [...(referralGalleries || []), ...(orgGalleries || [])];

    // Find the gallery that contains the image with the given ID
    let targetGallery = null;
    let imageToDelete = null;
    let photoIndex = -1;

    for (const gallery of galleries || []) {
      const images = gallery.images || [];
      const index = images.findIndex((img: any) => img.id === id);
      if (index !== -1) {
        targetGallery = gallery;
        imageToDelete = images[index];
        photoIndex = index;
        break;
      }
    }

    // If image not found in any gallery
    if (!targetGallery || photoIndex === -1 || !imageToDelete) {
      return errorResponse(
        "IMAGE_NOT_FOUND",
        "Image not found in any gallery",
        404
      );
    }

    // Extract file path from URL for storage deletion
    // URL format: https://...supabase.co/storage/v1/object/public/images/gallery/{gallery_id}/{filename}
    const imageUrl = imageToDelete.url;
    const urlParts = imageUrl.split('/images/');
    const filePath = urlParts.length > 1 ? urlParts[1] : null;

    // Delete image from Supabase Storage
    if (filePath) {
      const { error: storageError } = await supabase
        .storage
        .from("images")
        .remove([filePath]);

      if (storageError) {
        console.error("Error deleting image from storage:", storageError);
        // Continue with database deletion even if storage deletion fails
      }
    }

    // Remove image from gallery's images array
    const updatedImages = [...targetGallery.images];
    updatedImages.splice(photoIndex, 1);

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
        "Failed to update gallery after image deletion",
        500
      );
    }

    // Log referral history only if this is a referral-level gallery
    if (targetGallery.referral_id) {
      await logReferralHistory(
        supabase,
        targetGallery.referral_id,
        user.userId,
        user.userName,
        "deleted a photo from this referral"
      );
    }

    // Return success response
    return successResponse(
      {
        status: "success",
        message: "Image deleted successfully",
        data: {
          gallery: updatedGallery,
          deleted_image_id: id
        }
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in deleteImage:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
