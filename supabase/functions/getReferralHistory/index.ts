import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { getPreferences } from "../_shared/preferences.ts";

/**
 * Get Referral History Edge Function
 * Retrieves the complete history log for a specific referral
 *
 * Business Rules:
 * - Requires referral ID in request body
 * - Returns all logged actions for the referral
 * - Ordered by most recent first
 * - Includes user information for each action
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

    // Fetch referral history
    const { data: history, error: historyError } = await supabase
      .from("referral_history")
      .select("*")
      .eq("referral_id", id)
      .order("created_at", { ascending: false });

    if (historyError) {
      console.error("Error fetching referral history:", historyError);
      return errorResponse(
        "HISTORY_FETCH_FAILED",
        "Failed to fetch referral history",
        500
      );
    }

    // Fetch user preferences
    const preferences = await getPreferences(supabase, user.userId);

    // Enrich history with timezone info
    const enrichedHistory = (history || []).map((item) => ({
      ...item,
      created_at_tz: enrichTimestamp(item.created_at, preferences.timezone),
    }));

    // Return the history
    return successResponse(
      {
        status: "success",
        message: "Referral history retrieved successfully",
        data: {
          referral_id: id,
          history: enrichedHistory,
          count: enrichedHistory.length
        }
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in getReferralHistory:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
