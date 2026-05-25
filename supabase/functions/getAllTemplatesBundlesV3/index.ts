import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizations } from "../_shared/organization.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { getPreferences } from "../_shared/preferences.ts";

/**
 * getAllTemplatesBundlesV3 — agency-owned template bundles.
 *
 * Returns paginated bundles whose `organization_id` belongs to one of the
 * caller's "agency orgs" — orgs where the caller is OWNER or ADMIN AND the
 * org has `is_agency = true`. NO universal bundles. NO shared-in bundles.
 * NO sub-org-owned bundles.
 *
 * Every returned bundle is marked `isAgencyTemplate: true` by definition
 * (the entire list IS the agency's templates).
 *
 * Same query-param surface as V1 `getAllTemplatesBundles`:
 *   page, limit, sort, postcardSize, includeDeleted, campaign_id
 *
 * If the caller has no agency orgs, returns an empty paginated payload.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only GET method is allowed", 405);
  }

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();
    const user = getUserFromRequest(req);
    if (!user) return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);

    // Resolve the caller's agency orgs.
    const visibleOrgs = await getUserOrganizations(supabase, user.userId);
    const agencyOrgIds = visibleOrgs
      .filter((o) => o.isAgencyAccount === true && (o.role === "OWNER" || o.role === "ADMIN"))
      .map((o) => o.id);

    // Parse query params (mirror V1).
    const url = new URL(req.url);
    const includeDeleted = url.searchParams.get("includeDeleted") === "true";
    const postcardSize = url.searchParams.get("postcardSize");
    const sortOption = url.searchParams.get("sort") || "newest";
    const pageParam = url.searchParams.get("page");
    const limitParam = url.searchParams.get("limit");
    const campaignId = url.searchParams.get("campaign_id");

    const validSortOptions = ["a-z", "z-a", "newest", "oldest", "most-used"];
    if (!validSortOptions.includes(sortOption)) {
      return errorResponse(
        "INVALID_SORT",
        `Invalid sort option. Valid options: ${validSortOptions.join(", ")}`,
        400,
      );
    }

    let page = pageParam ? parseInt(pageParam, 10) : 1;
    let limit = limitParam ? parseInt(limitParam, 10) : 10;
    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1) limit = 10;
    if (limit > 100) limit = 100;
    const offset = (page - 1) * limit;

    // Empty-agency-orgs short-circuit: return paginated-shape with 0 results.
    if (agencyOrgIds.length === 0) {
      const preferences = await getPreferences(supabase, user.userId);
      return successResponse({
        status: "success",
        message: "No agency orgs — empty result set",
        data: [],
        pagination: {
          page,
          limit,
          total_count: 0,
          total_pages: 0,
          has_next_page: false,
          has_previous_page: false,
        },
        metadata: {
          filters_applied: { includeDeleted, postcardSize: postcardSize || null },
          sort_option: sortOption,
          agency_organization_ids: [],
          processingTimeMs: Date.now() - startTime,
        },
      }, 200);
    }

    // Fetch bundles + user preferences in parallel.
    const [{ data: rows, error: fetchError }, preferences] = await Promise.all([
      supabase.rpc("get_template_bundles_v3", {
        p_agency_organization_ids: agencyOrgIds,
        p_limit: limit,
        p_offset: offset,
        p_postcard_size: postcardSize && ["4x6", "6x9", "6x11"].includes(postcardSize)
          ? postcardSize
          : null,
        p_include_deleted: includeDeleted,
      }),
      getPreferences(supabase, user.userId),
    ]);

    if (fetchError) {
      console.error("Error fetching bundles (V3):", fetchError);
      return errorResponse("DATABASE_ERROR", "Failed to fetch template bundles", 500);
    }

    const totalCount: number = rows && rows.length > 0 ? Number(rows[0].total_count) : 0;

    // Shape rows. All entries are agency-owned by definition → isAgencyTemplate: true.
    const bundles = (rows || []).map((r: any) => ({
      id: r.bundle_id,
      organization_id: r.bundle_organization_id ?? null,
      is_universal: r.is_universal,
      shared_with_organization_ids: r.shared_with_organization_ids || [],
      isAgencyTemplate: true,
      show_restriction_annotations_tooltips: r.show_restriction_annotations_tooltips,
      show_restriction_area_warning: r.show_restriction_area_warning,
      created_at: r.bundle_created_at,
      updated_at: r.bundle_updated_at,
      front: {
        id: r.front_id,
        html: r.front_html,
        description: r.front_description,
        postgrid_template_id: r.front_postgrid_id,
        template_type: r.front_type,
        postcard_size: r.front_size,
        is_universal: r.front_is_universal,
        is_manual_edit: r.front_is_manual,
        campaigns_used: r.front_campaigns,
        created_by: r.front_created_by,
        live: r.front_live,
        deleted: r.front_deleted,
        created_at: r.front_created_at,
        updated_at: r.front_updated_at,
      },
      back: {
        id: r.back_id,
        html: r.back_html,
        description: r.back_description,
        postgrid_template_id: r.back_postgrid_id,
        template_type: r.back_type,
        postcard_size: r.back_size,
        is_universal: r.back_is_universal,
        is_manual_edit: r.back_is_manual,
        campaigns_used: r.back_campaigns,
        created_by: r.back_created_by,
        live: r.back_live,
        deleted: r.back_deleted,
        created_at: r.back_created_at,
        updated_at: r.back_updated_at,
      },
    }));

    // Manual-edit + campaign_id filter (same logic as V1).
    let filteredBundles = bundles.filter((bundle) => {
      const isManual = bundle.front?.is_manual_edit || bundle.back?.is_manual_edit;
      if (isManual) {
        if (!campaignId) return false;
        const frontUsed = bundle.front?.campaigns_used?.includes(campaignId);
        const backUsed = bundle.back?.campaigns_used?.includes(campaignId);
        if (!frontUsed && !backUsed) return false;
      }
      return true;
    });

    // Sort (mirror V1).
    switch (sortOption) {
      case "a-z":
        filteredBundles.sort((a, b) =>
          (a.front?.description || "").toLowerCase().localeCompare(
            (b.front?.description || "").toLowerCase(),
          )
        );
        break;
      case "z-a":
        filteredBundles.sort((a, b) =>
          (b.front?.description || "").toLowerCase().localeCompare(
            (a.front?.description || "").toLowerCase(),
          )
        );
        break;
      case "newest":
        filteredBundles.sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        break;
      case "oldest":
        filteredBundles.sort((a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        break;
      case "most-used":
        filteredBundles.sort((a, b) => {
          const aUsed = (a.front?.campaigns_used || []).length +
            (a.back?.campaigns_used || []).length;
          const bUsed = (b.front?.campaigns_used || []).length +
            (b.back?.campaigns_used || []).length;
          return bUsed - aUsed;
        });
        break;
    }

    const totalPages = Math.ceil((totalCount || 0) / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    return successResponse({
      status: "success",
      message: `Found ${filteredBundles.length} agency template bundle(s) on page ${page}`,
      data: filteredBundles,
      pagination: {
        page,
        limit,
        total_count: totalCount || 0,
        total_pages: totalPages,
        has_next_page: hasNextPage,
        has_previous_page: hasPreviousPage,
      },
      metadata: {
        filters_applied: {
          includeDeleted,
          postcardSize: postcardSize || null,
        },
        sort_option: sortOption,
        agency_organization_ids: agencyOrgIds,
        processingTimeMs: Date.now() - startTime,
      },
    }, 200);
  } catch (error: any) {
    console.error("Unexpected error in getAllTemplatesBundlesV3:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error?.message || String(error)}`,
      500,
    );
  }
});
