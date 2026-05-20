import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest, getUserProfile } from "../_shared/history.ts";
import { getUserOrganizationId, validateOrganizationAccess } from "../_shared/organization.ts";
import { logTemplateHistory } from "../_shared/templateHistory.ts";
import { createNotification, ROLES } from "../_shared/notifications.ts";
import { callerRoleOnOrg } from "../_shared/agencyGate.ts";

/**
 * createNewTemplateBundleV3 — create a template bundle and (optionally) share it
 * with sub-orgs in one call.
 *
 * Differences from V1 createNewTemplateBundle:
 *   - `organization_id` (optional): explicitly choose which org OWNS the bundle.
 *     Useful when an agency owner is logged in but their active org doesn't
 *     match the org they want the bundle attributed to. Defaults to active org.
 *   - `share_with_organization_ids` (optional): orgs to instantly grant read
 *     access to. Same gates as shareTemplateBundleV3:
 *       * Owning org must be is_agency = true
 *       * Caller must be OWNER or ADMIN of owning org AND of every target org
 *
 * V1 createNewTemplateBundle is preserved unchanged.
 */

interface RequestBody {
  description: string;
  html_front: string;
  html_back: string;
  postcardSize: "4x6" | "6x9" | "6x11";
  isManualEdit?: boolean;
  campaign_id?: string;
  organization_id?: string;
  share_with_organization_ids?: string[];
}

interface PostGridTemplateResponse {
  id: string;
  object: string;
  live: boolean;
  deleted: boolean;
  description: string;
  html: string;
  createdAt: string;
  updatedAt: string;
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

    const userProfile = await getUserProfile(supabase, user.userId);
    if (!userProfile) {
      return errorResponse("USER_PROFILE_NOT_FOUND", "User profile not found", 404);
    }

    let body: RequestBody;
    try {
      body = await req.json();
    } catch {
      return errorResponse("INVALID_INPUT", "Invalid JSON in request body", 400);
    }

    const postgridApiKey = Deno.env.get("POSTGRID_POSTCARD_API_KEY");
    if (!postgridApiKey) {
      console.error("POSTGRID_POSTCARD_API_KEY environment variable is not set");
      return errorResponse("CONFIGURATION_ERROR", "PostGrid postcard API key is not configured", 500);
    }

    const {
      description,
      html_front,
      html_back,
      postcardSize,
      isManualEdit,
      campaign_id,
      organization_id: requestedOrgId,
      share_with_organization_ids,
    } = body;

    // Body validation (mirrors V1)
    if (!description || typeof description !== "string") {
      return errorResponse("INVALID_INPUT", "description is required and must be a string", 400);
    }
    if (!html_front || typeof html_front !== "string") {
      return errorResponse("INVALID_INPUT", "html_front is required and must be a string", 400);
    }
    if (!html_back || typeof html_back !== "string") {
      return errorResponse("INVALID_INPUT", "html_back is required and must be a string", 400);
    }
    if (!postcardSize || !["4x6", "6x9", "6x11"].includes(postcardSize)) {
      return errorResponse(
        "INVALID_INPUT",
        "postcardSize is required and must be one of: '4x6', '6x9', '6x11'",
        400,
      );
    }
    const isManual = isManualEdit === true;

    // Resolve OWNING org: explicit organization_id or active org. Validate access either way.
    let organizationId: string | null = null;
    if (requestedOrgId) {
      const hasAccess = await validateOrganizationAccess(supabase, requestedOrgId, user.userId);
      if (!hasAccess) {
        return errorResponse(
          "FORBIDDEN",
          "You do not have access to the specified organization_id",
          403,
        );
      }
      organizationId = requestedOrgId;
    } else {
      organizationId = await getUserOrganizationId(supabase, user.userId);
    }
    if (!organizationId) {
      return errorResponse(
        "NO_ORGANIZATION",
        "User is not associated with any organization",
        403,
      );
    }

    // Validate campaign_id if isManualEdit
    if (isManual) {
      if (!campaign_id || typeof campaign_id !== "string") {
        return errorResponse(
          "INVALID_INPUT",
          "campaign_id is required when isManualEdit is true",
          400,
        );
      }
      const { data: campaign, error: campaignError } = await supabase
        .from("campaigns")
        .select("id")
        .eq("id", campaign_id)
        .eq("organization_id", organizationId)
        .single();
      if (campaignError || !campaign) {
        return errorResponse(
          "CAMPAIGN_NOT_FOUND",
          "Campaign not found or doesn't belong to the owning organization",
          404,
        );
      }
    }

    // Pre-validate sharing BEFORE making any external (PostGrid) calls.
    // This way we don't create PostGrid templates that we have to clean up if
    // share validation fails.
    let validatedShareIds: string[] = [];
    if (Array.isArray(share_with_organization_ids) && share_with_organization_ids.length > 0) {
      const unique = Array.from(new Set(share_with_organization_ids));
      if (unique.length !== share_with_organization_ids.length) {
        return errorResponse(
          "INVALID_INPUT",
          "share_with_organization_ids must not contain duplicates",
          400,
        );
      }

      // Owning org must be is_agency = true; caller must be OWNER or ADMIN.
      const { data: ownerOrg, error: ownerErr } = await supabase
        .from("organizations")
        .select("id, owner_id, organization_members, is_agency")
        .eq("id", organizationId)
        .single();
      if (ownerErr || !ownerOrg) {
        return errorResponse("FETCH_FAILED", "Failed to load owning organization", 500);
      }
      const callerOwnerRole = callerRoleOnOrg(ownerOrg, user.userId);
      if (callerOwnerRole !== "OWNER" && callerOwnerRole !== "ADMIN") {
        return errorResponse(
          "NOT_BUNDLE_ADMIN",
          "You must be OWNER or ADMIN of the owning organization to share the new bundle",
          403,
        );
      }
      if (ownerOrg.is_agency !== true) {
        return errorResponse(
          "OWNER_ORG_NOT_AGENCY",
          "Only bundles owned by an agency organization (is_agency = true) can be shared at creation",
          400,
        );
      }

      // Filter out the owning org from share targets (no-op share).
      const targets = unique.filter((id) => id !== organizationId);
      if (targets.length > 0) {
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
        validatedShareIds = targets;
      }
    }

    // ────────────────────────────────────────────────────────────
    // PostGrid + DB create. Mirrors V1 createNewTemplateBundle.
    // ────────────────────────────────────────────────────────────

    // Front template in PostGrid
    const frontFormData = new URLSearchParams();
    frontFormData.append("description", `${description} Front`);
    frontFormData.append("html", html_front);

    let frontPostgridResponse: Response;
    try {
      frontPostgridResponse = await fetch("https://api.postgrid.com/print-mail/v1/templates", {
        method: "POST",
        headers: {
          "x-api-key": postgridApiKey,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: frontFormData.toString(),
      });
    } catch (fetchError) {
      console.error("PostGrid front fetch error:", fetchError);
      return errorResponse(
        "POSTGRID_API_ERROR",
        "Failed to connect to PostGrid API for front template",
        500,
      );
    }
    if (!frontPostgridResponse.ok) {
      const errorText = await frontPostgridResponse.text();
      console.error("PostGrid front error:", errorText);
      return errorResponse(
        "POSTGRID_API_ERROR",
        `PostGrid API returned error for front template: ${frontPostgridResponse.status} - ${errorText}`,
        500,
      );
    }
    let frontTemplate: PostGridTemplateResponse;
    try {
      frontTemplate = await frontPostgridResponse.json();
    } catch {
      return errorResponse(
        "POSTGRID_RESPONSE_ERROR",
        "Failed to parse PostGrid API response for front template",
        500,
      );
    }

    const cleanupPostGrid = async (ids: string[]) => {
      for (const id of ids) {
        try {
          await fetch(`https://api.postgrid.com/print-mail/v1/templates/${id}`, {
            method: "DELETE",
            headers: { "x-api-key": postgridApiKey },
          });
        } catch (e) {
          console.error(`Failed to cleanup PostGrid template ${id}:`, e);
        }
      }
    };

    // Back template in PostGrid
    const backFormData = new URLSearchParams();
    backFormData.append("description", `${description} Back`);
    backFormData.append("html", html_back);

    let backPostgridResponse: Response;
    try {
      backPostgridResponse = await fetch("https://api.postgrid.com/print-mail/v1/templates", {
        method: "POST",
        headers: {
          "x-api-key": postgridApiKey,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: backFormData.toString(),
      });
    } catch (fetchError) {
      console.error("PostGrid back fetch error:", fetchError);
      await cleanupPostGrid([frontTemplate.id]);
      return errorResponse(
        "POSTGRID_API_ERROR",
        "Failed to connect to PostGrid API for back template",
        500,
      );
    }
    if (!backPostgridResponse.ok) {
      const errorText = await backPostgridResponse.text();
      console.error("PostGrid back error:", errorText);
      await cleanupPostGrid([frontTemplate.id]);
      return errorResponse(
        "POSTGRID_API_ERROR",
        `PostGrid API returned error for back template: ${backPostgridResponse.status} - ${errorText}`,
        500,
      );
    }
    let backTemplate: PostGridTemplateResponse;
    try {
      backTemplate = await backPostgridResponse.json();
    } catch {
      await cleanupPostGrid([frontTemplate.id]);
      return errorResponse(
        "POSTGRID_RESPONSE_ERROR",
        "Failed to parse PostGrid API response for back template",
        500,
      );
    }

    // Persist front + back template rows
    const frontTemplateData: any = {
      organization_id: organizationId,
      is_universal: false,
      postgrid_template_id: frontTemplate.id,
      description: frontTemplate.description,
      html: frontTemplate.html,
      template_type: "Front",
      postcard_size: postcardSize,
      campaigns_used: isManual && campaign_id ? [campaign_id] : [],
      created_by: userProfile,
      live: frontTemplate.live,
      deleted: frontTemplate.deleted,
      is_manual_edit: isManual,
    };
    const { data: frontDbTemplate, error: frontInsertError } = await supabase
      .from("templates")
      .insert(frontTemplateData)
      .select()
      .single();
    if (frontInsertError) {
      console.error("front template insert error:", frontInsertError);
      await cleanupPostGrid([frontTemplate.id, backTemplate.id]);
      return errorResponse("DATABASE_ERROR", "Failed to save front template to database", 500);
    }

    const backTemplateData: any = {
      organization_id: organizationId,
      is_universal: false,
      postgrid_template_id: backTemplate.id,
      description: backTemplate.description,
      html: backTemplate.html,
      template_type: "Back",
      postcard_size: postcardSize,
      campaigns_used: isManual && campaign_id ? [campaign_id] : [],
      created_by: userProfile,
      live: backTemplate.live,
      deleted: backTemplate.deleted,
      is_manual_edit: isManual,
    };
    const { data: backDbTemplate, error: backInsertError } = await supabase
      .from("templates")
      .insert(backTemplateData)
      .select()
      .single();
    if (backInsertError) {
      console.error("back template insert error:", backInsertError);
      await cleanupPostGrid([frontTemplate.id, backTemplate.id]);
      await supabase.from("templates").delete().eq("id", frontDbTemplate.id);
      return errorResponse("DATABASE_ERROR", "Failed to save back template to database", 500);
    }

    // Persist bundle WITH share list populated up front.
    const { data: bundleData, error: bundleError } = await supabase
      .from("template_bundles")
      .insert({
        template_front_id: frontDbTemplate.id,
        template_back_id: backDbTemplate.id,
        organization_id: organizationId,
        is_universal: false,
        shared_with_organization_ids: validatedShareIds,
      })
      .select()
      .single();
    if (bundleError) {
      console.error("bundle insert error:", bundleError);
      await cleanupPostGrid([frontTemplate.id, backTemplate.id]);
      await supabase.from("templates").delete().eq("id", frontDbTemplate.id);
      await supabase.from("templates").delete().eq("id", backDbTemplate.id);
      return errorResponse("DATABASE_ERROR", "Failed to create template bundle", 500);
    }

    // History
    await logTemplateHistory(
      supabase,
      frontDbTemplate.id,
      user.userId,
      user.userName,
      `created front template in bundle (Front, ${postcardSize})`,
    );
    await logTemplateHistory(
      supabase,
      backDbTemplate.id,
      user.userId,
      user.userName,
      `created back template in bundle (Back, ${postcardSize})`,
    );

    // Notifications
    await createNotification({
      supabase,
      organizationId,
      title: "Template Bundle Created",
      message: `${user.userName} created a new template bundle: ${description}`,
      targetRoles: [ROLES.ADMIN],
      metadata: {
        bundle_id: bundleData.id,
        front_template_id: frontDbTemplate.id,
        back_template_id: backDbTemplate.id,
        postcard_size: postcardSize,
        is_manual_edit: isManual,
      },
    });

    for (const id of validatedShareIds) {
      try {
        await createNotification({
          supabase,
          organizationId: id,
          notificationType: "TEMPLATE_BUNDLE_SHARED",
          title: "Template Bundle Shared",
          description: `A template bundle was shared with your organization`,
          targetRoles: ROLES.ALL,
          metadata: {
            template_bundle_id: bundleData.id,
            shared_from_organization_id: organizationId,
            shared_by: user.userId,
          },
        });
      } catch (e) {
        console.error(`createNewTemplateBundleV3: share notification failed for ${id}`, e);
      }
    }

    const processingTimeMs = Date.now() - startTime;

    return successResponse({
      status: "success",
      message: "Template bundle created successfully",
      bundle: {
        id: bundleData.id,
        organization_id: organizationId,
        shared_with_organization_ids: validatedShareIds,
        front_template: {
          id: frontDbTemplate.id,
          postgrid_template_id: frontDbTemplate.postgrid_template_id,
          description: frontDbTemplate.description,
          html: frontDbTemplate.html,
          templateType: frontDbTemplate.template_type,
          postcardSize: frontDbTemplate.postcard_size,
          isManualEdit: frontDbTemplate.is_manual_edit,
          campaigns_used: frontDbTemplate.campaigns_used,
          createdBy: frontDbTemplate.created_by,
          live: frontDbTemplate.live,
          deleted: frontDbTemplate.deleted,
          created_at: frontDbTemplate.created_at,
          updated_at: frontDbTemplate.updated_at,
        },
        back_template: {
          id: backDbTemplate.id,
          postgrid_template_id: backDbTemplate.postgrid_template_id,
          description: backDbTemplate.description,
          html: backDbTemplate.html,
          templateType: backDbTemplate.template_type,
          postcardSize: backDbTemplate.postcard_size,
          isManualEdit: backDbTemplate.is_manual_edit,
          campaigns_used: backDbTemplate.campaigns_used,
          createdBy: backDbTemplate.created_by,
          live: backDbTemplate.live,
          deleted: backDbTemplate.deleted,
          created_at: backDbTemplate.created_at,
          updated_at: backDbTemplate.updated_at,
        },
        created_at: bundleData.created_at,
        updated_at: bundleData.updated_at,
      },
      processingTimeMs,
    }, 201);
  } catch (error) {
    console.error("Unexpected error in createNewTemplateBundleV3:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500,
    );
  }
});
