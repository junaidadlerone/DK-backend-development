import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { getImageUrlsForReferrals } from "../_shared/imageHelpers.ts";
import { enrichTimestamp, TimezoneEnrichment } from "../_shared/timezone.ts";
import { getPreferences } from "../_shared/preferences.ts";

/**
 * Get All Campaigns Edge Function
 * Returns a paginated list of campaigns from the database
 *
 * Business Rules:
 * - Returns campaigns ordered by creation date (newest first)
 * - Supports pagination with page and limit query parameters
 * - Default: page=1, limit=10
 * - Returns total count and pagination metadata
 * - Organization-based (only returns campaigns from user's organization)
 */
Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow GET requests
  if (req.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only GET method is allowed", 405);
  }

  try {
    // Parse query parameters
    const url = new URL(req.url);
    const pageParam = url.searchParams.get("page");
    const limitParam = url.searchParams.get("limit");

    // Parse and validate pagination parameters
    let page = pageParam ? parseInt(pageParam, 10) : 1;
    let limit = limitParam ? parseInt(limitParam, 10) : 10;

    // Validate page and limit
    if (isNaN(page) || page < 1) {
      page = 1;
    }

    if (isNaN(limit) || limit < 1) {
      limit = 10;
    }

    // Limit maximum results per page to 100
    if (limit > 100) {
      limit = 100;
    }

    // Calculate offset
    const offset = (page - 1) * limit;

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

    // Get total count of campaigns in user's organization
    const { count: totalCount, error: countError } = await supabase
      .from("campaigns")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId);

    if (countError) {
      console.error("Error counting campaigns:", countError);
      return errorResponse(
        "COUNT_FAILED",
        "Failed to count campaigns",
        500
      );
    }

    // Fetch paginated campaigns from user's organization
    const { data: campaigns, error: fetchError } = await supabase
      .from("campaigns")
      .select("*, campaign_csv_address_lists(is_editing)")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (fetchError) {
      console.error("Error fetching campaigns:", fetchError);
      return errorResponse(
        "FETCH_FAILED",
        "Failed to fetch campaigns",
        500
      );
    }

    // Fetch user preferences
    const preferences = await getPreferences(supabase, user.userId);

    // Fetch image URLs for all campaigns' referrals
    const referralIds = (campaigns || []).map(c => c.referral_id).filter(Boolean);
    const imageUrlMap = await getImageUrlsForReferrals(supabase, referralIds);

    // Fetch payment_history totals for all campaigns on this page
    const campaignIds = (campaigns || []).map(c => c.id);
    const { data: paymentRows } = campaignIds.length > 0
      ? await supabase
          .from("payment_history")
          .select("campaign_id, amount_paid")
          .in("campaign_id", campaignIds)
      : { data: [] };

    const paymentTotals: Record<string, number> = {};
    for (const row of (paymentRows || [])) {
      paymentTotals[row.campaign_id] = (paymentTotals[row.campaign_id] || 0) + Number(row.amount_paid);
    }

    // Add image_url, computed total_spent, and timezone info to each campaign
    const campaignsWithImages = (campaigns || []).map(campaign => ({
      ...campaign,
      is_editing: (campaign as any).campaign_csv_address_lists?.is_editing || false,
      total_spent: campaign.id in paymentTotals
        ? paymentTotals[campaign.id]
        : (campaign.postcards_sent || 0) * 3,
      image_url: campaign.referral_id ? (imageUrlMap[campaign.referral_id] || "") : "",
      created_at_tz: enrichTimestamp(campaign.created_at, preferences.timezone),
      updated_at_tz: enrichTimestamp(campaign.updated_at, preferences.timezone)
    }));

    // Calculate pagination metadata
    const totalPages = Math.ceil((totalCount || 0) / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    // Return the paginated list of campaigns
    return successResponse(
      {
        data: campaignsWithImages,
        pagination: {
          page: page,
          limit: limit,
          total_count: totalCount || 0,
          total_pages: totalPages,
          has_next_page: hasNextPage,
          has_previous_page: hasPreviousPage
        }
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in getAllCampaigns:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
