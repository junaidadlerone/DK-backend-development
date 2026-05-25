import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizations } from "../_shared/organization.ts";

/**
 * getTemplateBundleByIdV3 — V3 single-bundle fetch.
 *
 * Returns one template bundle by id, restricted to bundles OWNED by one of the
 * caller's "agency orgs" (orgs where the caller is OWNER or ADMIN AND the org
 * has `is_agency = true`). Mirrors `getAllTemplatesBundlesV3`'s access model:
 *   - NO universal bundles.
 *   - NO shared-in bundles (share = read access via V1 surface, not V3).
 *   - NO sub-org-owned bundles.
 *
 * Every successfully returned bundle is tagged `isAgencyTemplate: true` by
 * definition.
 *
 * V1 `getTemplateBundleById` is preserved unchanged.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only GET method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();
    const user = getUserFromRequest(req);
    if (!user) return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);

    const url = new URL(req.url);
    const bundleId = url.searchParams.get("bundle_id");
    if (!bundleId) {
      return errorResponse("INVALID_INPUT", "bundle_id query parameter is required", 400);
    }

    // Resolve the caller's agency orgs.
    const visibleOrgs = await getUserOrganizations(supabase, user.userId);
    const agencyOrgIds = visibleOrgs
      .filter((o) => o.isAgencyAccount === true && (o.role === "OWNER" || o.role === "ADMIN"))
      .map((o) => o.id);

    if (agencyOrgIds.length === 0) {
      return errorResponse(
        "NOT_AGENCY_ADMIN",
        "Caller is not OWNER or ADMIN of any agency organization",
        403,
      );
    }

    // Fetch the bundle + joined templates.
    const { data: bundle, error: bundleErr } = await supabase
      .from("template_bundles")
      .select(`
        *,
        front:template_front_id (*),
        back:template_back_id (*)
      `)
      .eq("id", bundleId)
      .single();

    if (bundleErr || !bundle) {
      return errorResponse("BUNDLE_NOT_FOUND", "Template bundle not found", 404);
    }

    // V3 gate: must be a non-universal bundle owned by one of the caller's agency orgs.
    if (bundle.is_universal) {
      return errorResponse(
        "BUNDLE_NOT_AGENCY_OWNED",
        "Universal bundles are not exposed via V3",
        403,
      );
    }
    if (!bundle.organization_id || !agencyOrgIds.includes(bundle.organization_id)) {
      return errorResponse(
        "BUNDLE_NOT_AGENCY_OWNED",
        "Bundle is not owned by one of your agency organizations",
        403,
      );
    }

    const front = (bundle as any).front;
    const back = (bundle as any).back;
    if (!front || !back) {
      return errorResponse(
        "TEMPLATES_MISSING",
        "Bundle is missing its front or back template",
        500,
      );
    }

    // Expand the owning org + every share-list entry into display rows so the
    // frontend doesn't need a second round-trip.
    const sharedIds: string[] = Array.isArray(bundle.shared_with_organization_ids)
      ? bundle.shared_with_organization_ids
      : [];
    const idsToLoad = Array.from(new Set([bundle.organization_id, ...sharedIds]));

    const { data: orgRows, error: orgsErr } = await supabase
      .from("organizations")
      .select("id, business_name, business_email, business_address, branding_settings, is_agency")
      .in("id", idsToLoad);
    if (orgsErr) {
      console.error("getTemplateBundleByIdV3: failed to load organizations", orgsErr);
      return errorResponse("FETCH_FAILED", "Failed to load related organizations", 500);
    }
    const orgById = new Map<string, any>();
    for (const o of orgRows ?? []) orgById.set(o.id, o);
    const owningOrganization = orgById.get(bundle.organization_id) ?? null;
    const sharedWithOrganizations = sharedIds
      .map((id) => orgById.get(id))
      .filter((o): o is any => !!o);

    return successResponse({
      status: "success",
      message: "Template bundle retrieved successfully",
      data: {
        bundle: {
          id: bundle.id,
          organization_id: bundle.organization_id,
          is_universal: bundle.is_universal,
          shared_with_organization_ids: sharedIds,
          isAgencyTemplate: true,
          show_restriction_annotations_tooltips:
            bundle.show_restriction_annotations_tooltips ?? false,
          show_restriction_area_warning: bundle.show_restriction_area_warning ?? false,
          created_at: bundle.created_at,
          updated_at: bundle.updated_at,
        },
        owning_organization: owningOrganization,
        shared_with_organizations: sharedWithOrganizations,
        front_template: front,
        back_template: back,
      },
    }, 200);
  } catch (error: any) {
    console.error("Unexpected error in getTemplateBundleByIdV3:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error?.message || String(error)}`,
      500,
    );
  }
});
