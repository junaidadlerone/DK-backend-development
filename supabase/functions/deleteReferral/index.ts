import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { logReferralHistory, getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Delete Referral Edge Function
 * Deletes a specific referral by its ID
 *
 * Business Rules:
 * - Requires referral ID in request body
 * - Cascades deletion to associated gallery (due to ON DELETE CASCADE)
 * - Deletes all gallery images from Supabase Storage
 * - Returns success message after deletion
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
        "Referral ID is required",
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

    // Check if referral exists in user's organization
    const { data: referral, error: referralError } = await supabase
      .from("referrals")
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .single();

    if (referralError) {
      if (referralError.code === "PGRST116") {
        return errorResponse(
          "REFERRAL_NOT_FOUND",
          "Referral not found",
          404
        );
      }
      console.error("Error fetching referral:", referralError);
      return errorResponse(
        "REFERRAL_FETCH_FAILED",
        "Failed to fetch referral",
        500
      );
    }

    // Get associated gallery to delete images from storage
    const { data: gallery, error: galleryError } = await supabase
      .from("gallery")
      .select("*")
      .eq("referral_id", id)
      .single();

    // Delete all images from storage if gallery exists
    if (gallery && !galleryError) {
      const images = gallery.images || [];

      if (images.length > 0) {
        // Extract file paths from image URLs
        const filePaths: string[] = [];

        for (const image of images) {
          const imageUrl = image.url;
          const urlParts = imageUrl.split('/images/');
          if (urlParts.length > 1) {
            filePaths.push(urlParts[1]);
          }
        }

        // Delete all images from storage
        if (filePaths.length > 0) {
          const { error: storageError } = await supabase
            .storage
            .from("images")
            .remove(filePaths);

          if (storageError) {
            console.error("Error deleting images from storage:", storageError);
            // Continue with referral deletion even if storage deletion fails
          }
        }
      }
    }

    // Log referral history before deletion
    await logReferralHistory(
      supabase,
      id,
      user.userId,
      user.userName,
      "deleted this referral"
    );

    // Delete the referral (gallery and history will be cascade deleted due to foreign key)
    const { error: deleteError } = await supabase
      .from("referrals")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("Error deleting referral:", deleteError);
      return errorResponse(
        "DELETE_FAILED",
        "Failed to delete referral",
        500
      );
    }

    // Return success response
    return successResponse(
      {
        status: "success",
        message: "Referral deleted successfully",
        data: {
          deleted_referral_id: id
        }
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in deleteReferral:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
