import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { getPreferences } from "../_shared/preferences.ts";

/**
 * Get Photo Gallery Edge Function
 * Retrieves the photo gallery for a referral or organization
 *
 * Business Rules:
 * - referral_id is optional in request body
 * - If referral_id provided: returns referral's gallery
 * - If referral_id NOT provided: returns organization's standalone gallery
 * - Returns gallery with all images (before/after/none types)
 * - Returns empty gallery if no gallery exists
 */
Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow POST requests
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed", 405);
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

    const { referral_id } = body;

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

    // Determine which gallery to fetch
    let gallery = null;
    let galleryError = null;
    let galleryType = "";

    if (referral_id) {
      // If referral_id provided, validate and fetch referral's gallery
      const { data: referral, error: referralError } = await supabase
        .from("referrals")
        .select("id")
        .eq("id", referral_id)
        .eq("organization_id", organizationId)
        .single();

      if (referralError) {
        if (referralError.code === "PGRST116") {
          return errorResponse(
            "REFERRAL_NOT_FOUND",
            "Referral not found in your organization",
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

      // Fetch referral's gallery
      const { data: refGallery, error: refGalleryError } = await supabase
        .from("gallery")
        .select("*")
        .eq("referral_id", referral_id)
        .single();

      gallery = refGallery;
      galleryError = refGalleryError;
      galleryType = "referral";
    } else {
      // If no referral_id, fetch organization's standalone gallery
      const { data: orgGallery, error: orgGalleryError } = await supabase
        .from("gallery")
        .select("*")
        .eq("organization_id", organizationId)
        .is("referral_id", null)
        .single();

      gallery = orgGallery;
      galleryError = orgGalleryError;
      galleryType = "organization";
    }

    // If no gallery exists, return empty gallery structure
    if (galleryError?.code === "PGRST116" || !gallery) {
      const emptyMessage = referral_id
        ? "No gallery found for this referral"
        : "No gallery found for this organization";

      return successResponse(
        {
          status: "success",
          message: emptyMessage,
          data: {
            id: null,
            referral_id: referral_id || null,
            organization_id: referral_id ? null : organizationId,
            images: [],
            created_at: null,
            updated_at: null,
            gallery_type: galleryType
          }
        },
        200
      );
    }

    if (galleryError) {
      console.error("Error fetching gallery:", galleryError);
      return errorResponse(
        "GALLERY_FETCH_FAILED",
        "Failed to fetch gallery",
        500
      );
    }

    // Fetch user preferences
    const preferences = await getPreferences(supabase, user.userId);

    const successMessage = galleryType === "referral"
      ? "Referral gallery retrieved successfully"
      : "Organization gallery retrieved successfully";

    // Return the gallery
    return successResponse(
      {
        status: "success",
        message: successMessage,
        data: {
          ...gallery,
          gallery_type: galleryType,
          created_at_tz: enrichTimestamp(gallery.created_at, preferences.timezone),
          updated_at_tz: enrichTimestamp(gallery.updated_at, preferences.timezone)
        }
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in getPhotoGallery:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
