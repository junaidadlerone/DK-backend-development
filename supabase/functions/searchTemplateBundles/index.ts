import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { getPreferences } from "../_shared/preferences.ts";

/**
 * Search Template Bundles Edge Function
 * Searches template bundles by template name with sorting and pagination
 *
 * Business Rules:
 * - Searches bundles belonging to user's organization AND universal bundles
 * - Searches by template description/name (either front or back template)
 * - Supports multiple sorting options
 * - Excludes bundles where either template is deleted
 * - User must be authenticated and in organization
 *
 * Query parameters:
 * - q: string (required) - Search query for template description/name
 * - sort: "a-z" | "z-a" | "newest" | "oldest" | "most-used" (default: "newest")
 * - page: number (default: 1)
 * - limit: number (default: 10, max: 100)
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

  const startTime = Date.now();

  try {
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

    // Parse query parameters
    const url = new URL(req.url);
    const searchQuery = url.searchParams.get('q');
    const sortOption = url.searchParams.get('sort') || 'newest';
    const pageParam = url.searchParams.get("page");
    const limitParam = url.searchParams.get("limit");

    // Validate search query
    if (!searchQuery || searchQuery.trim() === '') {
      return errorResponse(
        "MISSING_QUERY",
        "Search query parameter 'q' is required",
        400
      );
    }

    // Validate sort option
    const validSortOptions = ['a-z', 'z-a', 'newest', 'oldest', 'most-used'];
    if (!validSortOptions.includes(sortOption)) {
      return errorResponse(
        "INVALID_SORT",
        `Invalid sort option. Valid options: ${validSortOptions.join(', ')}`,
        400
      );
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

    // Fetch ALL bundles for organization OR universal bundles (we'll filter and paginate in memory)
    const { data: bundles, error: fetchError } = await supabase
      .from("template_bundles")
      .select(`
        *,
        front:template_front_id (*),
        back:template_back_id (*)
      `)
      .or(`organization_id.eq.${organizationId},is_universal.eq.true`);

    if (fetchError) {
      console.error("Error fetching bundles:", fetchError);
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to fetch template bundles",
        500
      );
    }

    // Fetch user preferences for timezone enrichment
    const preferences = await getPreferences(supabase, user.userId);

    // Filter bundles by search query and exclude deleted
    const searchLower = searchQuery.toLowerCase().trim();
    const filteredBundles = (bundles || [])
      .filter(bundle => {
        // Exclude bundles with deleted templates
        if (bundle.front?.deleted || bundle.back?.deleted) {
          return false;
        }

        // Search in front template description
        const frontDesc = (bundle.front?.description || '').toLowerCase();
        const backDesc = (bundle.back?.description || '').toLowerCase();

        // Match if query is found in either front or back template description
        return frontDesc.includes(searchLower) || backDesc.includes(searchLower);
      });

    // Apply sorting
    let sortedBundles = [...filteredBundles];

    switch (sortOption) {
      case 'a-z':
        // Sort alphabetically by front template description
        sortedBundles.sort((a, b) => {
          const aDesc = (a.front?.description || '').toLowerCase();
          const bDesc = (b.front?.description || '').toLowerCase();
          return aDesc.localeCompare(bDesc);
        });
        break;

      case 'z-a':
        // Sort reverse alphabetically by front template description
        sortedBundles.sort((a, b) => {
          const aDesc = (a.front?.description || '').toLowerCase();
          const bDesc = (b.front?.description || '').toLowerCase();
          return bDesc.localeCompare(aDesc);
        });
        break;

      case 'newest':
        // Sort by created_at descending (newest first)
        sortedBundles.sort((a, b) => {
          const aTime = new Date(a.created_at).getTime();
          const bTime = new Date(b.created_at).getTime();
          return bTime - aTime;
        });
        break;

      case 'oldest':
        // Sort by created_at ascending (oldest first)
        sortedBundles.sort((a, b) => {
          const aTime = new Date(a.created_at).getTime();
          const bTime = new Date(b.created_at).getTime();
          return aTime - bTime;
        });
        break;

      case 'most-used':
        // Sort by number of campaigns using the bundle (descending)
        sortedBundles.sort((a, b) => {
          const aUsed = (a.front?.campaigns_used || []).length + (a.back?.campaigns_used || []).length;
          const bUsed = (b.front?.campaigns_used || []).length + (b.back?.campaigns_used || []).length;
          return bUsed - aUsed;
        });
        break;
    }

    // Calculate total count before pagination
    const totalCount = sortedBundles.length;

    // Apply pagination
    const offset = (page - 1) * limit;
    const paginatedBundles = sortedBundles.slice(offset, offset + limit);

    // Transform bundles to response format
    const transformedBundles = paginatedBundles.map(bundle => ({
      id: bundle.id,
      isUniversal: bundle.is_universal || false,
      front_template: {
        id: bundle.front.id,
        postgrid_template_id: bundle.front.postgrid_template_id,
        description: bundle.front.description,
        html: bundle.front.html,
        templateType: bundle.front.template_type,
        postcardSize: bundle.front.postcard_size,
        isUniversal: bundle.front.is_universal || false,
        isManualEdit: bundle.front.is_manual_edit || false,
        campaigns_used: bundle.front.campaigns_used || [],
        createdBy: bundle.front.created_by,
        live: bundle.front.live,
        deleted: bundle.front.deleted,
        created_at: bundle.front.created_at,
        created_at_tz: enrichTimestamp(bundle.front.created_at, preferences.timezone),
        updated_at: bundle.front.updated_at,
        updated_at_tz: enrichTimestamp(bundle.front.updated_at, preferences.timezone)
      },
      back_template: {
        id: bundle.back.id,
        postgrid_template_id: bundle.back.postgrid_template_id,
        description: bundle.back.description,
        html: bundle.back.html,
        templateType: bundle.back.template_type,
        postcardSize: bundle.back.postcard_size,
        isUniversal: bundle.back.is_universal || false,
        isManualEdit: bundle.back.is_manual_edit || false,
        campaigns_used: bundle.back.campaigns_used || [],
        createdBy: bundle.back.created_by,
        live: bundle.back.live,
        deleted: bundle.back.deleted,
        created_at: bundle.back.created_at,
        created_at_tz: enrichTimestamp(bundle.back.created_at, preferences.timezone),
        updated_at: bundle.back.updated_at,
        updated_at_tz: enrichTimestamp(bundle.back.updated_at, preferences.timezone)
      },
      created_at: bundle.created_at,
      created_at_tz: enrichTimestamp(bundle.created_at, preferences.timezone),
      updated_at: bundle.updated_at,
      updated_at_tz: enrichTimestamp(bundle.updated_at, preferences.timezone)
    }));

    const processingTimeMs = Date.now() - startTime;

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    // Build response
    const response = {
      status: "success",
      message: `Found ${transformedBundles.length} template bundle(s) matching "${searchQuery}" on page ${page}`,
      data: transformedBundles,
      pagination: {
        page: page,
        limit: limit,
        total_count: totalCount,
        total_pages: totalPages,
        has_next_page: hasNextPage,
        has_previous_page: hasPreviousPage
      },
      metadata: {
        search_query: searchQuery,
        sort_option: sortOption,
        processingTimeMs
      }
    };

    return successResponse(response, 200);

  } catch (error) {
    console.error("Unexpected error in searchTemplateBundles:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
