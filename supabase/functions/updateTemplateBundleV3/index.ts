import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient, isAdmin } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { logTemplateHistory } from "../_shared/templateHistory.ts";
import { createNotification, ROLES } from "../_shared/notifications.ts";
import { callerRoleOnOrg } from "../_shared/agencyGate.ts";

/**
 * updateTemplateBundleV3 — V3 edit counterpart to createNewTemplateBundleV3.
 *
 * Mirrors V1 updateTemplateBundle for template-content edits (html/description/
 * postcardSize/restriction flags) but layers on V3's stricter access gates
 * (OWNER or ADMIN of the owning org for non-universal bundles) AND adds
 * optional REPLACE-semantics share-list management (same per-target gates as
 * shareTemplateBundleV3).
 *
 * V1 updateTemplateBundle is preserved unchanged.
 */

interface RequestBody {
  template_bundle_id: string;
  description?: string;
  html_front?: string;
  html_back?: string;
  postcardSize?: "4x6" | "6x9" | "6x11";
  show_restriction_annotations_tooltips?: boolean;
  show_restriction_area_warning?: boolean;
  share_with_organization_ids?: string[]; // REPLACE the bundle's share list
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed", 405);
  }

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();
    const user = getUserFromRequest(req);
    if (!user) return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);

    let body: RequestBody;
    try {
      body = await req.json();
    } catch {
      return errorResponse("INVALID_INPUT", "Invalid JSON in request body", 400);
    }

    const {
      template_bundle_id,
      description,
      html_front,
      html_back,
      postcardSize,
      show_restriction_annotations_tooltips,
      show_restriction_area_warning,
      share_with_organization_ids,
    } = body;

    // PostGrid key
    const postgridApiKey = Deno.env.get("POSTGRID_POSTCARD_API_KEY");
    if (!postgridApiKey) {
      console.error("POSTGRID_POSTCARD_API_KEY environment variable is not set");
      return errorResponse(
        "CONFIGURATION_ERROR",
        "PostGrid postcard API key is not configured",
        500,
      );
    }

    // Required + at-least-one-editable check
    if (!template_bundle_id || typeof template_bundle_id !== "string") {
      return errorResponse(
        "INVALID_INPUT",
        "template_bundle_id is required and must be a string",
        400,
      );
    }
    const shareProvided = Array.isArray(share_with_organization_ids);
    if (
      !html_front && !html_back && !description && !postcardSize &&
      show_restriction_annotations_tooltips === undefined &&
      show_restriction_area_warning === undefined &&
      !shareProvided
    ) {
      return errorResponse(
        "INVALID_INPUT",
        "At least one of html_front, html_back, description, postcardSize, show_restriction_annotations_tooltips, show_restriction_area_warning, share_with_organization_ids must be provided",
        400,
      );
    }
    if (postcardSize && !["4x6", "6x9", "6x11"].includes(postcardSize)) {
      return errorResponse(
        "INVALID_INPUT",
        "postcardSize must be one of: '4x6', '6x9', '6x11'",
        400,
      );
    }

    // Load bundle + joined templates
    const { data: bundle, error: bundleErr } = await supabase
      .from("template_bundles")
      .select(`
        *,
        front:template_front_id (*),
        back:template_back_id (*)
      `)
      .eq("id", template_bundle_id)
      .single();
    if (bundleErr || !bundle) {
      return errorResponse("BUNDLE_NOT_FOUND", "Template bundle not found", 404);
    }

    // Access gates (V3-strict)
    if (!user.isServiceRole) {
      if (bundle.is_universal) {
        const userIsAdmin = await isAdmin(user.userId);
        if (!userIsAdmin) {
          return errorResponse(
            "NOT_ADMIN_FOR_UNIVERSAL",
            "Only ADMIN users can update universal template bundles",
            403,
          );
        }
      } else {
        if (!bundle.organization_id) {
          return errorResponse(
            "BUNDLE_HAS_NO_OWNER_ORG",
            "Bundle has no owning organization",
            400,
          );
        }
        const { data: ownerOrg, error: ownerErr } = await supabase
          .from("organizations")
          .select("id, owner_id, organization_members, is_agency")
          .eq("id", bundle.organization_id)
          .single();
        if (ownerErr || !ownerOrg) {
          return errorResponse("FETCH_FAILED", "Failed to load owning organization", 500);
        }
        const role = callerRoleOnOrg(ownerOrg, user.userId);
        if (role !== "OWNER" && role !== "ADMIN") {
          return errorResponse(
            "NOT_BUNDLE_ADMIN",
            "You must be OWNER or ADMIN of the bundle's owning organization to update it",
            403,
          );
        }
        // Cache ownerOrg for the share-list check below.
        (bundle as any)._owner_org = ownerOrg;
      }
    }

    // Share-list validation (only when provided). Whole-call rejection — no DB
    // or PostGrid mutation happens before this passes.
    let newShareList: string[] | undefined = undefined;
    let oldShareList: string[] = Array.isArray(bundle.shared_with_organization_ids)
      ? bundle.shared_with_organization_ids
      : [];
    if (shareProvided) {
      if (bundle.is_universal) {
        return errorResponse(
          "BUNDLE_IS_UNIVERSAL",
          "Universal bundles do not carry a share list",
          400,
        );
      }
      if (!bundle.organization_id) {
        return errorResponse(
          "BUNDLE_HAS_NO_OWNER_ORG",
          "Bundle has no owning organization; cannot manage shares",
          400,
        );
      }

      // Reload ownerOrg if service role skipped the access gate above.
      let ownerOrg = (bundle as any)._owner_org;
      if (!ownerOrg) {
        const { data: o, error: oe } = await supabase
          .from("organizations")
          .select("id, owner_id, organization_members, is_agency")
          .eq("id", bundle.organization_id)
          .single();
        if (oe || !o) {
          return errorResponse("FETCH_FAILED", "Failed to load owning organization", 500);
        }
        ownerOrg = o;
      }
      if (ownerOrg.is_agency !== true) {
        return errorResponse(
          "OWNER_ORG_NOT_AGENCY",
          "Only bundles owned by an agency organization (is_agency = true) can carry a share list",
          400,
        );
      }

      // Dedupe + reject duplicates explicitly
      const raw = share_with_organization_ids as string[];
      const unique = Array.from(new Set(raw));
      if (unique.length !== raw.length) {
        return errorResponse(
          "INVALID_INPUT",
          "share_with_organization_ids must not contain duplicates",
          400,
        );
      }

      // Filter out the owning org (no-op share with self)
      const targets = unique.filter((id) => id !== bundle.organization_id);

      // Per-target permission check: caller must be OWNER or ADMIN of every target.
      // (Skip for service role.)
      if (!user.isServiceRole && targets.length > 0) {
        const { data: targetOrgs, error: tErr } = await supabase
          .from("organizations")
          .select("id, owner_id, organization_members")
          .in("id", targets);
        if (tErr) {
          return errorResponse("FETCH_FAILED", "Failed to load target organizations", 500);
        }
        const targetsById = new Map<string, any>();
        for (const o of targetOrgs || []) targetsById.set(o.id, o);
        for (const id of targets) {
          const org = targetsById.get(id);
          if (!org) {
            return errorResponse("ORG_NOT_FOUND", `Organization ${id} not found`, 404);
          }
          const role = callerRoleOnOrg(org, user.userId);
          if (role !== "OWNER" && role !== "ADMIN") {
            return errorResponse(
              "NO_SHARE_PERMISSION",
              `You must be OWNER or ADMIN of ${id} to share a bundle with it`,
              403,
            );
          }
        }
      }

      newShareList = targets;
    }

    // ────────────────────────────────────────────────────────────
    // All validation passed — apply mutations.
    // ────────────────────────────────────────────────────────────

    const frontTemplate = (bundle as any).front;
    const backTemplate = (bundle as any).back;
    const updatedFields: string[] = [];
    if (postcardSize) updatedFields.push("postcard_size");

    // Front template update (mirrors V1)
    if (html_front || description || postcardSize) {
      const dbUpdateData: any = { updated_at: new Date().toISOString() };
      if (postcardSize) dbUpdateData.postcard_size = postcardSize;

      if (html_front || description) {
        const frontFormData = new URLSearchParams();
        if (html_front) frontFormData.append("html", html_front);
        if (description) frontFormData.append("description", `${description} Front`);

        const frontResponse = await fetch(
          `https://api.postgrid.com/print-mail/v1/templates/${frontTemplate.postgrid_template_id}`,
          {
            method: "POST",
            headers: {
              "x-api-key": postgridApiKey,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: frontFormData.toString(),
          },
        );
        if (!frontResponse.ok) {
          const errorText = await frontResponse.text();
          console.error("PostGrid API error (front update):", errorText);
          return errorResponse(
            "POSTGRID_API_ERROR",
            `Failed to update front template in PostGrid: ${frontResponse.status} - ${errorText}`,
            500,
          );
        }
        const updatedFront = await frontResponse.json();
        if (html_front) {
          dbUpdateData.html = updatedFront.html || html_front;
          updatedFields.push("html_front");
        }
        if (description) {
          dbUpdateData.description = updatedFront.description || `${description} Front`;
          if (!updatedFields.includes("description")) updatedFields.push("description");
        }
      }

      const { error: frontUpdateErr } = await supabase
        .from("templates")
        .update(dbUpdateData)
        .eq("id", frontTemplate.id);
      if (frontUpdateErr) {
        console.error("Error updating front template in database:", frontUpdateErr);
        return errorResponse("DATABASE_ERROR", "Failed to update front template in database", 500);
      }

      await logTemplateHistory(
        supabase,
        frontTemplate.id,
        user.userId,
        user.userName,
        `updated front template in bundle (${
          Object.keys(dbUpdateData).filter((k) => k !== "updated_at").join(", ")
        })`,
      );
    }

    // Back template update (mirrors V1)
    if (html_back || description || postcardSize) {
      const dbUpdateData: any = { updated_at: new Date().toISOString() };
      if (postcardSize) dbUpdateData.postcard_size = postcardSize;

      if (html_back || description) {
        const backFormData = new URLSearchParams();
        if (html_back) backFormData.append("html", html_back);
        if (description) backFormData.append("description", `${description} Back`);

        const backResponse = await fetch(
          `https://api.postgrid.com/print-mail/v1/templates/${backTemplate.postgrid_template_id}`,
          {
            method: "POST",
            headers: {
              "x-api-key": postgridApiKey,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: backFormData.toString(),
          },
        );
        if (!backResponse.ok) {
          const errorText = await backResponse.text();
          console.error("PostGrid API error (back update):", errorText);
          return errorResponse(
            "POSTGRID_API_ERROR",
            `Failed to update back template in PostGrid: ${backResponse.status} - ${errorText}`,
            500,
          );
        }
        const updatedBack = await backResponse.json();
        if (html_back) {
          dbUpdateData.html = updatedBack.html || html_back;
          if (!updatedFields.includes("html_back")) updatedFields.push("html_back");
        }
        if (description) {
          dbUpdateData.description = updatedBack.description || `${description} Back`;
        }
      }

      const { error: backUpdateErr } = await supabase
        .from("templates")
        .update(dbUpdateData)
        .eq("id", backTemplate.id);
      if (backUpdateErr) {
        console.error("Error updating back template in database:", backUpdateErr);
        return errorResponse("DATABASE_ERROR", "Failed to update back template in database", 500);
      }

      await logTemplateHistory(
        supabase,
        backTemplate.id,
        user.userId,
        user.userName,
        `updated back template in bundle (${
          Object.keys(dbUpdateData).filter((k) => k !== "updated_at").join(", ")
        })`,
      );
    }

    // Bundle row update: timestamp + optional bundle-level fields + share list
    const bundleUpdate: any = { updated_at: new Date().toISOString() };
    if (show_restriction_annotations_tooltips !== undefined) {
      bundleUpdate.show_restriction_annotations_tooltips = show_restriction_annotations_tooltips;
      updatedFields.push("show_restriction_annotations_tooltips");
    }
    if (show_restriction_area_warning !== undefined) {
      bundleUpdate.show_restriction_area_warning = show_restriction_area_warning;
      updatedFields.push("show_restriction_area_warning");
    }
    if (newShareList !== undefined) {
      bundleUpdate.shared_with_organization_ids = newShareList;
      updatedFields.push("share_with_organization_ids");
    }
    await supabase
      .from("template_bundles")
      .update(bundleUpdate)
      .eq("id", template_bundle_id);

    // Fetch updated bundle
    const { data: updatedBundle, error: fetchErr } = await supabase
      .from("template_bundles")
      .select(`
        *,
        front:template_front_id (*),
        back:template_back_id (*)
      `)
      .eq("id", template_bundle_id)
      .single();
    if (fetchErr || !updatedBundle) {
      console.error("Error fetching updated bundle:", fetchErr);
      return errorResponse("DATABASE_ERROR", "Failed to fetch updated bundle", 500);
    }

    // Notifications (best-effort)
    if (!bundle.is_universal) {
      try {
        await createNotification({
          supabase,
          organizationId: bundle.organization_id,
          notificationType: "TEMPLATE_BUNDLE_UPDATED",
          title: "Template Bundle Updated",
          description: `${user.userName} updated template bundle`,
          targetRoles: [ROLES.ADMIN],
          metadata: {
            bundle_id: template_bundle_id,
            fields_updated: updatedFields,
          },
        });
      } catch (e) {
        console.error("updateTemplateBundleV3: owner-org notification failed", e);
      }
    }

    // Share diff notifications
    if (newShareList !== undefined) {
      const oldSet = new Set(oldShareList);
      const newSet = new Set(newShareList);
      const added = newShareList.filter((id) => !oldSet.has(id));
      const removed = oldShareList.filter((id) => !newSet.has(id));

      for (const id of added) {
        try {
          await createNotification({
            supabase,
            organizationId: id,
            notificationType: "TEMPLATE_BUNDLE_SHARED",
            title: "Template Bundle Shared",
            description: `A template bundle was shared with your organization`,
            targetRoles: ROLES.ALL,
            metadata: {
              template_bundle_id,
              shared_from_organization_id: bundle.organization_id,
              shared_by: user.userId,
            },
          });
        } catch (e) {
          console.error(`updateTemplateBundleV3: share notification failed for ${id}`, e);
        }
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
              template_bundle_id,
              unshared_from_organization_id: bundle.organization_id,
              unshared_by: user.userId,
            },
          });
        } catch (e) {
          console.error(`updateTemplateBundleV3: unshare notification failed for ${id}`, e);
        }
      }
    }

    const processingTimeMs = Date.now() - startTime;

    return successResponse({
      status: "success",
      message: "Template bundle updated successfully",
      bundle: {
        id: updatedBundle.id,
        organization_id: updatedBundle.organization_id,
        is_universal: updatedBundle.is_universal,
        shared_with_organization_ids: updatedBundle.shared_with_organization_ids ?? [],
        show_restriction_annotations_tooltips:
          updatedBundle.show_restriction_annotations_tooltips ?? false,
        show_restriction_area_warning: updatedBundle.show_restriction_area_warning ?? false,
        front_template: {
          id: (updatedBundle as any).front.id,
          postgrid_template_id: (updatedBundle as any).front.postgrid_template_id,
          description: (updatedBundle as any).front.description,
          html: (updatedBundle as any).front.html,
          templateType: (updatedBundle as any).front.template_type,
          postcardSize: (updatedBundle as any).front.postcard_size,
          isUniversal: (updatedBundle as any).front.is_universal,
          isManualEdit: (updatedBundle as any).front.is_manual_edit,
          campaigns_used: (updatedBundle as any).front.campaigns_used,
          createdBy: (updatedBundle as any).front.created_by,
          live: (updatedBundle as any).front.live,
          deleted: (updatedBundle as any).front.deleted,
          created_at: (updatedBundle as any).front.created_at,
          updated_at: (updatedBundle as any).front.updated_at,
        },
        back_template: {
          id: (updatedBundle as any).back.id,
          postgrid_template_id: (updatedBundle as any).back.postgrid_template_id,
          description: (updatedBundle as any).back.description,
          html: (updatedBundle as any).back.html,
          templateType: (updatedBundle as any).back.template_type,
          postcardSize: (updatedBundle as any).back.postcard_size,
          isUniversal: (updatedBundle as any).back.is_universal,
          isManualEdit: (updatedBundle as any).back.is_manual_edit,
          campaigns_used: (updatedBundle as any).back.campaigns_used,
          createdBy: (updatedBundle as any).back.created_by,
          live: (updatedBundle as any).back.live,
          deleted: (updatedBundle as any).back.deleted,
          created_at: (updatedBundle as any).back.created_at,
          updated_at: (updatedBundle as any).back.updated_at,
        },
        created_at: updatedBundle.created_at,
        updated_at: updatedBundle.updated_at,
      },
      fields_updated: updatedFields,
      processingTimeMs,
    }, 200);
  } catch (error) {
    console.error("Unexpected error in updateTemplateBundleV3:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
});
