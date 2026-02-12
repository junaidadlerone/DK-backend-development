import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { getUserPreferences } from "../_shared/preferences.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { enrichCurrency } from "../_shared/currency.ts";

/**
 * Get Referral By ID Edge Function
 * Retrieves a specific referral by its ID
 *
 * Business Rules:
 * - Requires referral ID in request body
 * - Returns complete referral information
 * - Includes image_url field with first image from gallery (empty string if no images)
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
    const body = await req.json();
    const { id } = body;

    // Validate required fields
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

    // Fetch user preferences for enrichment
    const preferences = await getUserPreferences(supabase, user.userId);

    // Fetch the referral by ID (must be in user's organization)
    const { data: referral, error: fetchError } = await supabase
      .from("referrals")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .single();

    if (fetchError) {
      if (fetchError.code === "PGRST116") {
        return errorResponse(
          "REFERRAL_NOT_FOUND",
          "Referral not found",
          404
        );
      }
      console.error("Error fetching referral:", fetchError);
      return errorResponse(
        "FETCH_FAILED",
        "Failed to fetch referral",
        500
      );
    }

    // Fetch gallery for this referral to get image_url
    const { data: gallery } = await supabase
      .from("gallery")
      .select("images")
      .eq("referral_id", id)
      .single();

    // Get first image URL from gallery (if exists)
    let image_url = "";
    if (gallery && gallery.images && Array.isArray(gallery.images) && gallery.images.length > 0) {
      image_url = gallery.images[0].url || "";
    }

    // Return the referral with image_url
    return successResponse(
      {
        status: "success",
        data: {
          ...referral,
          image_url,
          created_at_tz: enrichTimestamp(referral.created_at, preferences.timezone),
          // Enrich job value if it exists
          ...(referral.job_details?.value !== undefined && {
            job_details: {
              ...referral.job_details,
              value_display: enrichCurrency(referral.job_details.value, preferences.currency)
            }
          })
        },
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in getReferralById:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
