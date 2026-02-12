import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { getUserPreferences } from "../_shared/preferences.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { enrichCurrency } from "../_shared/currency.ts";

/**
 * Get All Referrals Edge Function
 * Returns a paginated list of referrals from the database
 *
 * Business Rules:
 * - Returns referrals ordered by creation date (newest first)
 * - Supports pagination with page and limit query parameters
 * - Default: page=1, limit=10
 * - Returns total count and pagination metadata
 * - Includes complete referral information
 * - Includes image_url field with first image from gallery (empty string if no images)
 * - Optional body parameter: {"showOnlyActive": true} to filter only Ready and In Use statuses
 */
Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Allow GET and POST requests
  if (req.method !== "GET" && req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only GET and POST methods are allowed", 405);
  }

  try {
    // Parse query parameters
    const url = new URL(req.url);
    const pageParam = url.searchParams.get("page");
    const limitParam = url.searchParams.get("limit");

    // Parse request body for POST requests
    let showOnlyActive = false;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        showOnlyActive = body.showOnlyActive === true;
      } catch (error) {
        // If body parsing fails, continue with default showOnlyActive=false
        console.log("No body provided or invalid JSON, using default showOnlyActive=false");
      }
    }

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

    // Build count query with optional status filter
    let countQuery = supabase
      .from("referrals")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId);

    // Apply status filter if showOnlyActive is true
    if (showOnlyActive) {
      // Filter for Ready (4d1ca79a-1a0a-4c9f-a183-6c5bebd13336) or In Use (cabe17d8-a7c8-4730-986f-bd0d87e44758)
      countQuery = countQuery.or('status->>id.eq.4d1ca79a-1a0a-4c9f-a183-6c5bebd13336,status->>id.eq.cabe17d8-a7c8-4730-986f-bd0d87e44758');
    }

    const { count: totalCount, error: countError } = await countQuery;

    if (countError) {
      console.error("Error counting referrals:", countError);
      return errorResponse(
        "COUNT_FAILED",
        "Failed to count referrals",
        500
      );
    }

    // Build fetch query with optional status filter
    let fetchQuery = supabase
      .from("referrals")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply status filter if showOnlyActive is true
    if (showOnlyActive) {
      // Filter for Ready (4d1ca79a-1a0a-4c9f-a183-6c5bebd13336) or In Use (cabe17d8-a7c8-4730-986f-bd0d87e44758)
      fetchQuery = fetchQuery.or('status->>id.eq.4d1ca79a-1a0a-4c9f-a183-6c5bebd13336,status->>id.eq.cabe17d8-a7c8-4730-986f-bd0d87e44758');
    }

    const { data: referrals, error: fetchError } = await fetchQuery;

    if (fetchError) {
      console.error("Error fetching referrals:", fetchError);
      return errorResponse(
        "FETCH_FAILED",
        "Failed to fetch referrals",
        500
      );
    }

    // Fetch user preferences for enrichment
    const preferences = await getUserPreferences(supabase, user.userId);

    // Fetch galleries for all referrals to get image_urls
    const referralIds = (referrals || []).map(r => r.id);
    const { data: galleries } = await supabase
      .from("gallery")
      .select("referral_id, images")
      .in("referral_id", referralIds);

    // Create a map of referral_id to first image URL
    const imageUrlMap: Record<string, string> = {};
    if (galleries) {
      for (const gallery of galleries) {
        if (gallery.images && Array.isArray(gallery.images) && gallery.images.length > 0) {
          imageUrlMap[gallery.referral_id] = gallery.images[0].url || "";
        }
      }
    }

    // Add image_url and enrich data for each referral
    const referralsWithImages = (referrals || []).map(referral => ({
      ...referral,
      image_url: imageUrlMap[referral.id] || "",
      created_at_tz: enrichTimestamp(referral.created_at, preferences.timezone),
      // Enrich job value if it exists
      ...(referral.job_details?.value !== undefined && {
        job_details: {
          ...referral.job_details,
          value_display: enrichCurrency(referral.job_details.value, preferences.currency)
        }
      })
    }));

    // Calculate pagination metadata
    const totalPages = Math.ceil((totalCount || 0) / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    // Return the paginated list of referrals
    return successResponse(
      {
        data: referralsWithImages,
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
    console.error("Unexpected error in getAllReferrals:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
