import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { getPreferences } from "../_shared/preferences.ts";

/**
 * Get All Template Bundles Edge Function
 * Returns all template bundles for the user's organization plus universal bundles
 *
 * Business Rules:
 * - Returns bundles belonging to user's organization AND universal bundles
 * - Universal bundles (is_universal=true) are visible to all organizations
 * - Excludes bundles where either template is deleted (unless includeDeleted=true)
 * - User must be authenticated and in organization
 * - Returns bundles ordered by created_at (newest first)
 *
 * Query parameters (optional):
 * - includeDeleted: boolean (default: false) - Include bundles with deleted templates
 * - postcardSize: "4x6" | "6x9" | "6x11" - Filter by postcard size
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
    // getUserOrganizationId fires owner + member lookups in parallel internally
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
    const includeDeleted = url.searchParams.get('includeDeleted') === 'true';
    const postcardSize = url.searchParams.get('postcardSize');
    const sortOption = url.searchParams.get('sort') || 'newest';
    const pageParam = url.searchParams.get("page");
    const limitParam = url.searchParams.get("limit");
    const campaignId = url.searchParams.get("campaign_id");

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

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1) limit = 10;
    if (limit > 100) limit = 100;

    const offset = (page - 1) * limit;

    // Single RPC call: native SQL JOIN + COUNT(*) OVER() window function.
    // This replaces the previous two-query pattern (separate COUNT + SELECT via PostgREST).
    // Preferences are fetched in parallel since they are independent.
    const [
      { data: rows, error: fetchError },
      preferences
    ] = await Promise.all([
      supabase.rpc("get_template_bundles", {
        p_organization_id: organizationId,
        p_limit:           limit,
        p_offset:          offset,
        p_postcard_size:   postcardSize && ['4x6', '6x9', '6x11'].includes(postcardSize)
                             ? postcardSize
                             : null,
        p_include_deleted: includeDeleted
      }),
      getPreferences(supabase, user.userId)
    ]);

    if (fetchError) {
      console.error("Error fetching bundles:", fetchError);
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to fetch template bundles",
        500
      );
    }

    // Extract total_count from the window function column (same value on every row)
    const totalCount: number = rows && rows.length > 0 ? Number(rows[0].total_count) : 0;

    // Re-shape flat RPC rows into bundle-like objects so the filter/sort/transform
    // logic below is identical to the original PostgREST-join version.
    const bundles = (rows || []).map((r: any) => ({
      id:           r.bundle_id,
      is_universal: r.is_universal,
      created_at:   r.bundle_created_at,
      updated_at:   r.bundle_updated_at,
      front: {
        id:                   r.front_id,
        html:                 r.front_html,
        description:          r.front_description,
        postgrid_template_id: r.front_postgrid_id,
        template_type:        r.front_type,
        postcard_size:        r.front_size,
        is_universal:         r.front_is_universal,
        is_manual_edit:       r.front_is_manual,
        campaigns_used:       r.front_campaigns,
        created_by:           r.front_created_by,
        live:                 r.front_live,
        deleted:              r.front_deleted,
        created_at:           r.front_created_at,
        updated_at:           r.front_updated_at
      },
      back: {
        id:                   r.back_id,
        html:                 r.back_html,
        description:          r.back_description,
        postgrid_template_id: r.back_postgrid_id,
        template_type:        r.back_type,
        postcard_size:        r.back_size,
        is_universal:         r.back_is_universal,
        is_manual_edit:       r.back_is_manual,
        campaigns_used:       r.back_campaigns,
        created_by:           r.back_created_by,
        live:                 r.back_live,
        deleted:              r.back_deleted,
        created_at:           r.back_created_at,
        updated_at:           r.back_updated_at
      }
    }));

    // Filter bundles — deleted is already handled inside the RPC.
    // Only campaignId / manual-edit logic remains in JS.
    let filteredBundles = bundles
      .filter(bundle => {
        // Filter based on manual edit status and campaign_id
        const isManual = bundle.front?.is_manual_edit || bundle.back?.is_manual_edit;

        if (isManual) {
          if (!campaignId) {
            // If no campaign_id provided, hide manual edit bundles
            return false;
          } else {
            // If campaign_id provided, check if bundle is used by this campaign
            const frontUsed = bundle.front?.campaigns_used?.includes(campaignId);
            const backUsed  = bundle.back?.campaigns_used?.includes(campaignId);

            // Include if either front or back uses this campaign
            if (!frontUsed && !backUsed) {
              return false;
            }
          }
        }

        return true;
      });

    // Apply sorting
    switch (sortOption) {
      case 'a-z':
        filteredBundles.sort((a, b) => {
          const aDesc = (a.front?.description || '').toLowerCase();
          const bDesc = (b.front?.description || '').toLowerCase();
          return aDesc.localeCompare(bDesc);
        });
        break;

      case 'z-a':
        filteredBundles.sort((a, b) => {
          const aDesc = (a.front?.description || '').toLowerCase();
          const bDesc = (b.front?.description || '').toLowerCase();
          return bDesc.localeCompare(aDesc);
        });
        break;

      case 'newest':
        filteredBundles.sort((a, b) => {
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
        break;

      case 'oldest':
        filteredBundles.sort((a, b) => {
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });
        break;

      case 'most-used':
        filteredBundles.sort((a, b) => {
          const aUsed = (a.front?.campaigns_used || []).length + (a.back?.campaigns_used || []).length;
          const bUsed = (b.front?.campaigns_used || []).length + (b.back?.campaigns_used || []).length;
          return bUsed - aUsed;
        });
        break;
    }

    // Transform bundles to response format — identical shape as before
    const transformedBundles = filteredBundles.map(bundle => ({
      id: bundle.id,
      isUniversal: bundle.is_universal || false,
      front_template: {
        id:                   bundle.front.id,
        postgrid_template_id: bundle.front.postgrid_template_id,
        description:          bundle.front.description,
        html:                 bundle.front.html,
        templateType:         bundle.front.template_type,
        postcardSize:         bundle.front.postcard_size,
        isUniversal:          bundle.front.is_universal  || false,
        isManualEdit:         bundle.front.is_manual_edit || false,
        campaigns_used:       bundle.front.campaigns_used || [],
        createdBy:            bundle.front.created_by,
        live:                 bundle.front.live,
        deleted:              bundle.front.deleted,
        created_at:           bundle.front.created_at,
        created_at_tz:        enrichTimestamp(bundle.front.created_at, preferences.timezone),
        updated_at:           bundle.front.updated_at,
        updated_at_tz:        enrichTimestamp(bundle.front.updated_at, preferences.timezone)
      },
      back_template: {
        id:                   bundle.back.id,
        postgrid_template_id: bundle.back.postgrid_template_id,
        description:          bundle.back.description,
        html:                 bundle.back.html,
        templateType:         bundle.back.template_type,
        postcardSize:         bundle.back.postcard_size,
        isUniversal:          bundle.back.is_universal  || false,
        isManualEdit:         bundle.back.is_manual_edit || false,
        campaigns_used:       bundle.back.campaigns_used || [],
        createdBy:            bundle.back.created_by,
        live:                 bundle.back.live,
        deleted:              bundle.back.deleted,
        created_at:           bundle.back.created_at,
        created_at_tz:        enrichTimestamp(bundle.back.created_at, preferences.timezone),
        updated_at:           bundle.back.updated_at,
        updated_at_tz:        enrichTimestamp(bundle.back.updated_at, preferences.timezone)
      },
      created_at:    bundle.created_at,
      created_at_tz: enrichTimestamp(bundle.created_at, preferences.timezone),
      updated_at:    bundle.updated_at,
      updated_at_tz: enrichTimestamp(bundle.updated_at, preferences.timezone)
    }));

    const processingTimeMs = Date.now() - startTime;

    const totalPages      = Math.ceil((totalCount || 0) / limit);
    const hasNextPage     = page < totalPages;
    const hasPreviousPage = page > 1;

    const response = {
      status:  "success",
      message: `Found ${filteredBundles.length} template bundle(s) on page ${page}`,
      data:    filteredBundles,
      pagination: {
        page,
        limit,
        total_count:      totalCount || 0,
        total_pages:      totalPages,
        has_next_page:    hasNextPage,
        has_previous_page: hasPreviousPage
      },
      metadata: {
        filters_applied: {
          includeDeleted,
          postcardSize: postcardSize || null
        },
        sort_option:     sortOption,
        processingTimeMs
      }
    };

    return successResponse(response, 200);

  } catch (error) {
    console.error("Unexpected error in getAllTemplatesBundles:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
