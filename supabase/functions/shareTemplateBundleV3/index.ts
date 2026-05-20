import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { createNotification, ROLES } from "../_shared/notifications.ts";
import { callerRoleOnOrg } from "../_shared/agencyGate.ts";

/**
 * shareTemplateBundleV3 — share a private template bundle with one or more orgs.
 *
 * The bundle's owning org must be `is_agency = TRUE` and the caller must be its
 * OWNER or ADMIN. The caller must also be OWNER or ADMIN of every target org.
 * Universal bundles cannot be re-shared.
 *
 * Sharing is org-level: every member of each target org gains read access via the
 * `get_template_bundles` RPC. There is no per-member grant.
 *
 * Whole-call rejection — if any per-target check fails, no shares are applied.
 */

interface ShareRequest {
  template_bundle_id: string;
  organization_ids: string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();
    const caller = getUserFromRequest(req);
    if (!caller) return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);

    let body: ShareRequest;
    try {
      body = await req.json();
    } catch {
      return errorResponse("INVALID_INPUT", "Invalid JSON body", 400);
    }

    const { template_bundle_id, organization_ids } = body;
    if (!template_bundle_id || typeof template_bundle_id !== "string") {
      return errorResponse("INVALID_INPUT", "template_bundle_id is required", 400);
    }
    if (!Array.isArray(organization_ids) || organization_ids.length === 0) {
      return errorResponse(
        "INVALID_INPUT",
        "organization_ids must be a non-empty array of UUIDs",
        400,
      );
    }
    const uniqueOrgIds = Array.from(new Set(organization_ids));
    if (uniqueOrgIds.length !== organization_ids.length) {
      return errorResponse("INVALID_INPUT", "organization_ids must not contain duplicates", 400);
    }

    // Load bundle
    const { data: bundle, error: bundleErr } = await supabase
      .from("template_bundles")
      .select("id, organization_id, is_universal, shared_with_organization_ids")
      .eq("id", template_bundle_id)
      .maybeSingle();
    if (bundleErr) {
      console.error("shareTemplateBundleV3: bundle fetch error", bundleErr);
      return errorResponse("FETCH_FAILED", "Failed to load template bundle", 500);
    }
    if (!bundle) {
      return errorResponse("BUNDLE_NOT_FOUND", "Template bundle not found", 404);
    }
    if (bundle.is_universal === true) {
      return errorResponse(
        "BUNDLE_IS_UNIVERSAL",
        "Universal bundles are already public; cannot be shared",
        400,
      );
    }
    if (!bundle.organization_id) {
      return errorResponse(
        "BUNDLE_HAS_NO_OWNER_ORG",
        "Bundle has no owning organization; cannot be shared",
        400,
      );
    }

    // Owning-org check: caller must be OWNER/ADMIN AND org must be is_agency = true
    const { data: ownerOrg, error: ownerErr } = await supabase
      .from("organizations")
      .select("id, owner_id, organization_members, is_agency")
      .eq("id", bundle.organization_id)
      .single();
    if (ownerErr || !ownerOrg) {
      console.error("shareTemplateBundleV3: owner org fetch error", ownerErr);
      return errorResponse("FETCH_FAILED", "Failed to load owning organization", 500);
    }
    const callerOwnerRole = callerRoleOnOrg(ownerOrg, caller.userId);
    if (callerOwnerRole !== "OWNER" && callerOwnerRole !== "ADMIN") {
      return errorResponse(
        "NOT_BUNDLE_ADMIN",
        "You must be OWNER or ADMIN of the bundle's owning organization to share it",
        403,
      );
    }
    if (ownerOrg.is_agency !== true) {
      return errorResponse(
        "OWNER_ORG_NOT_AGENCY",
        "Only bundles owned by an agency organization (is_agency = true) can be shared",
        400,
      );
    }

    // Filter out the owning org (no point sharing with yourself)
    const targetIds = uniqueOrgIds.filter((id) => id !== bundle.organization_id);
    if (targetIds.length === 0) {
      return successResponse({
        status: "success",
        message: "No new orgs to share with (only the owning org was listed)",
        template_bundle_id: bundle.id,
        shared_with_organization_ids: bundle.shared_with_organization_ids || [],
      }, 200);
    }

    // Per-target check: caller must be OWNER/ADMIN of every target org
    const { data: targetOrgs, error: targetsErr } = await supabase
      .from("organizations")
      .select("id, owner_id, organization_members")
      .in("id", targetIds);
    if (targetsErr) {
      console.error("shareTemplateBundleV3: target org fetch error", targetsErr);
      return errorResponse("FETCH_FAILED", "Failed to load target organizations", 500);
    }
    const targetsById = new Map<string, any>();
    for (const o of targetOrgs || []) targetsById.set(o.id, o);

    for (const id of targetIds) {
      const org = targetsById.get(id);
      if (!org) {
        return errorResponse("ORG_NOT_FOUND", `Organization ${id} not found`, 404);
      }
      const role = callerRoleOnOrg(org, caller.userId);
      if (role !== "OWNER" && role !== "ADMIN") {
        return errorResponse(
          "NO_SHARE_PERMISSION",
          `You must be OWNER or ADMIN of ${id} to share a bundle with it`,
          403,
        );
      }
    }

    // Union with existing shares
    const existing: string[] = Array.isArray(bundle.shared_with_organization_ids)
      ? bundle.shared_with_organization_ids
      : [];
    const merged = Array.from(new Set([...existing, ...targetIds]));
    const newlyAdded = targetIds.filter((id) => !existing.includes(id));

    const { error: updErr } = await supabase
      .from("template_bundles")
      .update({ shared_with_organization_ids: merged, updated_at: new Date().toISOString() })
      .eq("id", bundle.id);
    if (updErr) {
      console.error("shareTemplateBundleV3: update error", updErr);
      return errorResponse("UPDATE_FAILED", "Failed to update bundle sharing", 500);
    }

    // Notifications — one per newly-added target org
    for (const id of newlyAdded) {
      try {
        await createNotification({
          supabase,
          organizationId: id,
          notificationType: "TEMPLATE_BUNDLE_SHARED",
          title: "Template Bundle Shared",
          description: `A template bundle was shared with your organization`,
          targetRoles: ROLES.ALL,
          metadata: {
            template_bundle_id: bundle.id,
            shared_from_organization_id: bundle.organization_id,
            shared_by: caller.userId,
          },
        });
      } catch (e) {
        console.error(`shareTemplateBundleV3: notification failed for ${id}`, e);
      }
    }

    return successResponse({
      status: "success",
      message: `Bundle shared with ${newlyAdded.length} new organization(s)`,
      template_bundle_id: bundle.id,
      shared_with_organization_ids: merged,
    }, 200);
  } catch (error) {
    console.error("Unexpected error in shareTemplateBundleV3:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500,
    );
  }
});
