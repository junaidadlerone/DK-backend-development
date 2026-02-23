import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { enrichCurrency } from "../_shared/currency.ts";
import { getPreferences } from "../_shared/preferences.ts";

/**
 * Search Referral Edge Function
 * Searches referrals based on query and/or filters with pagination
 *
 * Business Rules:
 * - Either query or filters must be provided (at least one is mandatory)
 * - Query searches by home owner name or phone number
 * - Filters can include: job_type, status, and/or value
 * - All provided criteria are combined with AND logic
 * - Supports pagination with page and limit parameters
 * - Default: page=1, limit=10
 * - sort_order: "asc" (oldest first) or "desc" (newest first, default)
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

    const { query, filters, page: pageParam, limit: limitParam, sort_order: sortOrderParam } = body;

    // Parse and validate sort_order ("asc" or "desc", default "desc")
    const sortOrderRaw = typeof sortOrderParam === 'string' ? sortOrderParam.toLowerCase().trim() : "desc";
    if (sortOrderRaw !== "asc" && sortOrderRaw !== "desc") {
      return errorResponse(
        "INVALID_INPUT",
        "sort_order must be \"asc\" or \"desc\"",
        400
      );
    }
    const ascending = sortOrderRaw === "asc";

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
      const { job_type, status, value } = filters;
      if (job_type === undefined && status === undefined && value === undefined) {
        return errorResponse(
          "INVALID_INPUT",
          "At least one filter (job_type, status, or value) must be provided",
          400
        );
      }

      // Validate job_type if provided
      if (job_type !== undefined) {
        if (typeof job_type !== 'object' || Array.isArray(job_type)) {
          return errorResponse(
            "INVALID_INPUT",
            "job_type must be a JSON object with id and name",
            400
          );
        }
      }

      // Validate status if provided
      if (status !== undefined) {
        if (typeof status !== 'object' || Array.isArray(status)) {
          return errorResponse(
            "INVALID_INPUT",
            "status must be a JSON object with id and name",
            400
          );
        }
      }

      // Validate value if provided
      if (value !== undefined) {
        if (typeof value !== 'number') {
          return errorResponse(
            "INVALID_INPUT",
            "value must be a number",
            400
          );
        }
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

    // Fetch referrals from user's organization (we'll filter in application since JSONB queries can be complex)
    const { data: allReferrals, error: fetchError } = await supabase
      .from("referrals")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending });

    if (fetchError) {
      console.error("Error fetching referrals:", fetchError);
      return errorResponse(
        "FETCH_FAILED",
        "Failed to fetch referrals",
        500
      );
    }

    // Filter referrals based on query and filters
    let filteredReferrals = allReferrals || [];

    // Apply query filter (search by name or phone)
    if (query && typeof query === 'string' && query.trim()) {
      const queryLower = query.toLowerCase().trim();
      filteredReferrals = filteredReferrals.filter(referral => {
        const homeOwnerInfo = referral.home_owner_info;
        if (!homeOwnerInfo) return false;

        const name = homeOwnerInfo.name?.toLowerCase() || "";
        const phone = homeOwnerInfo.phone?.toLowerCase() || "";

        return name.includes(queryLower) || phone.includes(queryLower);
      });
    }

    // Apply filters
    if (filters) {
      // Filter by job_type
      if (filters.job_type !== undefined) {
        filteredReferrals = filteredReferrals.filter(referral => {
          const jobDetails = referral.job_details;
          if (!jobDetails || !jobDetails.job_type) return false;

          // Match by id if provided, otherwise by name
          if (filters.job_type.id !== undefined && filters.job_type.id !== null) {
            return jobDetails.job_type.id === filters.job_type.id;
          }
          if (filters.job_type.name) {
            return jobDetails.job_type.name === filters.job_type.name;
          }
          return false;
        });
      }

      // Filter by status
      if (filters.status !== undefined) {
        filteredReferrals = filteredReferrals.filter(referral => {
          const status = referral.status;
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

      // Filter by value
      if (filters.value !== undefined) {
        filteredReferrals = filteredReferrals.filter(referral => {
          const jobDetails = referral.job_details;
          if (!jobDetails) return false;

          return jobDetails.value === filters.value;
        });
      }
    }

    // Re-sort filtered results to ensure sort_order is respected after in-memory filtering
    filteredReferrals.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return ascending ? dateA - dateB : dateB - dateA;
    });


    // Calculate pagination metadata
    const totalCount = filteredReferrals.length;
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    // Apply pagination to filtered results
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedReferrals = filteredReferrals.slice(startIndex, endIndex);

    // Fetch user preferences
    const preferences = await getPreferences(supabase, user.userId);

    // Fetch galleries for paginated referrals to get image_urls
    const referralIds = paginatedReferrals.map(r => r.id);
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

    // Add image_url, timezone, and currency info to each referral
    const referralsWithImages = paginatedReferrals.map(referral => ({
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

    // Return the paginated filtered referrals
    return successResponse(
      {
        status: "success",
        message: `Found ${totalCount} referral(s)`,
        data: referralsWithImages,
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
    console.error("Unexpected error in searchReferral:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
