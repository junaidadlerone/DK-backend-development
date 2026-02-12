import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { getImageUrlsForReferrals } from "../_shared/imageHelpers.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { getPreferences } from "../_shared/preferences.ts";

/**
 * Search Campaign Edge Function
 * Searches campaigns based on query and/or filters with pagination
 *
 * Business Rules:
 * - Either query or filters must be provided (at least one is mandatory)
 * - Query searches by campaign_name, offer headline, offer description
 * - Filters can include: status, start_date, end_date (expiry date), and/or created_by
 * - All provided criteria are combined with AND logic
 * - Supports pagination with page and limit parameters
 * - Default: page=1, limit=10
 * - Organization-based (only searches campaigns from user's organization)
 * - Returns campaigns with image_url from referral gallery
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

    const { query, filters, page: pageParam, limit: limitParam } = body;

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

    // Validate that at least query or filters is provided
    if (!query && !filters) {
      return errorResponse(
        "INVALID_INPUT",
        "Either 'query' or 'filters' must be provided",
        400
      );
    }

    // Validate filters if provided
    if (filters !== undefined) {
      if (typeof filters !== 'object' || Array.isArray(filters)) {
        return errorResponse(
          "INVALID_INPUT",
          "filters must be a JSON object",
          400
        );
      }

      // Validate that at least one filter is provided
      const { status, start_date, end_date, created_by } = filters;
      if (status === undefined && start_date === undefined && end_date === undefined && created_by === undefined) {
        return errorResponse(
          "INVALID_INPUT",
          "At least one filter (status, start_date, end_date, or created_by) must be provided",
          400
        );
      }

      // Validate status if provided
      if (status !== undefined) {
        if (typeof status !== 'object' || Array.isArray(status)) {
          return errorResponse(
            "INVALID_INPUT",
            "status must be a JSON object with id and/or name",
            400
          );
        }
      }

      // Validate dates if provided
      if (start_date !== undefined && typeof start_date !== 'string') {
        return errorResponse(
          "INVALID_INPUT",
          "start_date must be a string (ISO 8601 format)",
          400
        );
      }

      if (end_date !== undefined && typeof end_date !== 'string') {
        return errorResponse(
          "INVALID_INPUT",
          "end_date must be a string (ISO 8601 format)",
          400
        );
      }

      // Validate created_by if provided
      if (created_by !== undefined && typeof created_by !== 'string') {
        return errorResponse(
          "INVALID_INPUT",
          "created_by must be a string (user_id)",
          400
        );
      }
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

    // Fetch campaigns from user's organization
    const { data: allCampaigns, error: fetchError } = await supabase
      .from("campaigns")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    if (fetchError) {
      console.error("Error fetching campaigns:", fetchError);
      return errorResponse(
        "FETCH_FAILED",
        "Failed to fetch campaigns",
        500
      );
    }

    // Filter campaigns based on query and filters
    let filteredCampaigns = allCampaigns || [];

    // Apply query filter (search by campaign_name, offer headline, offer description)
    if (query && typeof query === 'string' && query.trim()) {
      const queryLower = query.toLowerCase().trim();
      filteredCampaigns = filteredCampaigns.filter(campaign => {
        // Search in campaign_name
        const campaignName = campaign.campaign_name?.toLowerCase() || "";

        // Search in offer_data (headline and description)
        const offerHeadline = campaign.offer_data?.offer_headline?.toLowerCase() || "";
        const offerDescription = campaign.offer_data?.offer_description?.toLowerCase() || "";

        return campaignName.includes(queryLower) ||
               offerHeadline.includes(queryLower) ||
               offerDescription.includes(queryLower);
      });
    }

    // Apply filters
    if (filters) {
      // Filter by status
      if (filters.status !== undefined) {
        filteredCampaigns = filteredCampaigns.filter(campaign => {
          const status = campaign.status;
          if (!status) return false;

          // Match by id if provided, otherwise by name
          if (filters.status.id !== undefined && filters.status.id !== null) {
            return status.id === filters.status.id;
          }
          if (filters.status.name) {
            return status.name === filters.status.name;
          }
          return false;
        });
      }

      // Filter by start_date (from offer_data)
      if (filters.start_date !== undefined) {
        filteredCampaigns = filteredCampaigns.filter(campaign => {
          const offerData = campaign.offer_data;
          if (!offerData || !offerData.start_date) return false;

          return offerData.start_date === filters.start_date;
        });
      }

      // Filter by end_date (expiry date from offer_data)
      if (filters.end_date !== undefined) {
        filteredCampaigns = filteredCampaigns.filter(campaign => {
          const offerData = campaign.offer_data;
          if (!offerData || !offerData.end_date) return false;

          return offerData.end_date === filters.end_date;
        });
      }

      // Filter by created_by (we'll need to fetch campaign_history to determine who created it)
      if (filters.created_by !== undefined) {
        // Get all campaign IDs
        const campaignIds = filteredCampaigns.map(c => c.id);

        // Fetch history for these campaigns to find who created them
        const { data: histories, error: historyError } = await supabase
          .from("campaign_history")
          .select("campaign_id, user_id")
          .in("campaign_id", campaignIds)
          .ilike("action", "%created this campaign%")
          .order("created_at", { ascending: true });

        if (!historyError && histories) {
          // Create a map of campaign_id -> creator_user_id
          const creatorMap = new Map();
          histories.forEach(h => {
            if (!creatorMap.has(h.campaign_id)) {
              creatorMap.set(h.campaign_id, h.user_id);
            }
          });

          // Filter campaigns by creator
          filteredCampaigns = filteredCampaigns.filter(campaign => {
            return creatorMap.get(campaign.id) === filters.created_by;
          });
        }
      }
    }

    // Calculate pagination metadata
    const totalCount = filteredCampaigns.length;
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    // Apply pagination to filtered results
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedCampaigns = filteredCampaigns.slice(startIndex, endIndex);

    // Fetch user preferences
    const preferences = await getPreferences(supabase, user.userId);

    // Fetch image URLs for paginated campaigns' referrals
    const referralIds = paginatedCampaigns.map(c => c.referral_id).filter(Boolean);
    const imageUrlMap = await getImageUrlsForReferrals(supabase, referralIds);

    // Add image_url and timezone info to each campaign
    const campaignsWithImages = paginatedCampaigns.map(campaign => ({
      ...campaign,
      image_url: campaign.referral_id ? (imageUrlMap[campaign.referral_id] || "") : "",
      created_at_tz: enrichTimestamp(campaign.created_at, preferences.timezone),
      updated_at_tz: enrichTimestamp(campaign.updated_at, preferences.timezone)
    }));

    // Return the paginated filtered campaigns
    return successResponse(
      {
        status: "success",
        message: `Found ${totalCount} campaign(s)`,
        data: campaignsWithImages,
        pagination: {
          page: page,
          limit: limit,
          total_count: totalCount,
          total_pages: totalPages,
          has_next_page: hasNextPage,
          has_previous_page: hasPreviousPage
        }
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in searchCampaign:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
