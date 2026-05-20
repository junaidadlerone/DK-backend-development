import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { createNotification, ROLES } from "../_shared/notifications.ts";
import { callerRoleOnOrg } from "../_shared/agencyGate.ts";

/**
 * unshareTemplateBundleV3 — remove orgs from a template bundle's share list.
 *
 * Only the bundle's owning agency org's OWNER or ADMIN can manage sharing
 * (mirrors shareTemplateBundleV3). Recipient sub-orgs cannot unshare themselves
 * or others.
 */

interface UnshareRequest {
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

    let body: UnshareRequest;
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
      console.error("unshareTemplateBundleV3: bundle fetch error", bundleErr);
      return errorResponse("FETCH_FAILED", "Failed to load template bundle", 500);
    }
    if (!bundle) {
      return errorResponse("BUNDLE_NOT_FOUND", "Template bundle not found", 404);
    }
    if (bundle.is_universal === true) {
      return errorResponse(
        "BUNDLE_IS_UNIVERSAL",
        "Universal bundles are public; there is nothing to unshare",
        400,
      );
    }
    if (!bundle.organization_id) {
      return errorResponse(
        "BUNDLE_HAS_NO_OWNER_ORG",
        "Bundle has no owning organization",
        400,
      );
    }

    // Owning-org check
    const { data: ownerOrg, error: ownerErr } = await supabase
      .from("organizations")
      .select("id, owner_id, organization_members, is_agency")
      .eq("id", bundle.organization_id)
      .single();
    if (ownerErr || !ownerOrg) {
      console.error("unshareTemplateBundleV3: owner org fetch error", ownerErr);
      return errorResponse("FETCH_FAILED", "Failed to load owning organization", 500);
    }
    const callerOwnerRole = callerRoleOnOrg(ownerOrg, caller.userId);
    if (callerOwnerRole !== "OWNER" && callerOwnerRole !== "ADMIN") {
      return errorResponse(
        "NOT_BUNDLE_ADMIN",
        "You must be OWNER or ADMIN of the bundle's owning organization to unshare it",
        403,
      );
    }
    if (ownerOrg.is_agency !== true) {
      return errorResponse(
        "OWNER_ORG_NOT_AGENCY",
        "Only bundles owned by an agency organization (is_agency = true) can be managed",
        400,
      );
    }

    const existing: string[] = Array.isArray(bundle.shared_with_organization_ids)
      ? bundle.shared_with_organization_ids
      : [];
    const toRemove = new Set(uniqueOrgIds);
    const next = existing.filter((id) => !toRemove.has(id));
    const removed = existing.filter((id) => toRemove.has(id));

    if (removed.length === 0) {
      // No-op — none of the listed orgs were actually shared.
      return successResponse({
        status: "success",
        message: "No matching shares to remove",
        template_bundle_id: bundle.id,
        shared_with_organization_ids: existing,
      }, 200);
    }

    const { error: updErr } = await supabase
      .from("template_bundles")
      .update({ shared_with_organization_ids: next, updated_at: new Date().toISOString() })
      .eq("id", bundle.id);
    if (updErr) {
      console.error("unshareTemplateBundleV3: update error", updErr);
      return errorResponse("UPDATE_FAILED", "Failed to update bundle sharing", 500);
    }

    for (const id of removed) {
      try {
        await createNotification({
          supabase,
          organizationId: id,
          notificationType: "TEMPLATE_BUNDLE_UNSHARED",
          title: "Template Bundle Access Removed",
          description: `Access to a template bundle was removed from your organization`,
          targetRoles: ROLES.ALL,
          metadata: {
            template_bundle_id: bundle.id,
            unshared_from_organization_id: bundle.organization_id,
            unshared_by: caller.userId,
          },
        });
      } catch (e) {
        console.error(`unshareTemplateBundleV3: notification failed for ${id}`, e);
      }
    }

    return successResponse({
      status: "success",
      message: `Bundle unshared from ${removed.length} organization(s)`,
      template_bundle_id: bundle.id,
      shared_with_organization_ids: next,
    }, 200);
  } catch (error) {
    console.error("Unexpected error in unshareTemplateBundleV3:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500,
    );
  }
});
