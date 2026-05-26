import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient, isValidRole, type UserRole } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizations } from "../_shared/organization.ts";
import { callerRoleOnOrg } from "../_shared/agencyGate.ts";
import { createNotification, ROLES } from "../_shared/notifications.ts";

/**
 * editUserV3 — grant org access (or re-grant after a revoke) to an EXISTING user,
 * optionally updating their per-org role.
 *
 * Symmetric counterpart to createUserV3, which invites NEW users. This endpoint
 * never creates auth accounts — it operates on a known user_id, mutating each
 * target org's `organization_members` array.
 *
 * Body: { user_id, role?, organization_ids }
 *
 * `role` is required when ANY listed org does not already contain the target;
 * for orgs the target is already in, `role` is optional and updates the role
 * if it differs.
 */

interface EditUserV3Request {
  user_id: string;
  role?: UserRole;
  organization_ids: string[];
}

type Action = "added" | "role_updated" | "no_change" | "owner_skipped";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();
    const caller = getUserFromRequest(req);
    if (!caller) return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);

    let body: EditUserV3Request;
    try {
      body = await req.json();
    } catch {
      return errorResponse("INVALID_INPUT", "Invalid JSON body", 400);
    }

    const { user_id, role, organization_ids } = body;

    if (!user_id || typeof user_id !== "string") {
      return errorResponse("INVALID_INPUT", "user_id is required", 400);
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
    if (role !== undefined && !isValidRole(role)) {
      return errorResponse(
        "INVALID_ROLE",
        "role must be ADMIN, MARKETER, or TECHNICIAN",
        400,
      );
    }
    if (user_id === caller.userId) {
      return errorResponse("INVALID_OPERATION", "You cannot edit your own access", 400);
    }

    // Agency gate + resolve caller's agency orgs.
    const callerOrgs = await getUserOrganizations(supabase, caller.userId);
    const callerAgencyOrgIds = callerOrgs
      .filter((o) => o.isAgencyAccount === true && (o.role === "OWNER" || o.role === "ADMIN"))
      .map((o) => o.id);
    if (callerAgencyOrgIds.length === 0) {
      return errorResponse(
        "NOT_AGENCY_USER",
        "Only agency users (OWNER/ADMIN of an is_agency=true org) can call V3 endpoints",
        403,
      );
    }

    // Confirm target auth user exists.
    const { data: { user: targetAuthUser }, error: targetAuthErr } =
      await supabase.auth.admin.getUserById(user_id);
    if (targetAuthErr || !targetAuthUser) {
      return errorResponse("USER_NOT_FOUND", "Target user does not exist", 404);
    }

    // Final grant list = requested orgs ∪ caller's agency orgs (deduped), so the
    // target always lands in (or stays in) the caller's agency org.
    const finalOrgIds = Array.from(new Set([...uniqueOrgIds, ...callerAgencyOrgIds]));

    // Load every target org for pre-flight validation.
    const { data: orgRows, error: orgsErr } = await supabase
      .from("organizations")
      .select("id, owner_id, organization_members")
      .in("id", finalOrgIds);
    if (orgsErr) {
      console.error("editUserV3: org fetch error", orgsErr);
      return errorResponse("FETCH_FAILED", "Failed to load organizations", 500);
    }
    const orgsById = new Map<string, any>();
    for (const o of orgRows ?? []) orgsById.set(o.id, o);

    // Pre-flight (whole-call rejection).
    for (const orgId of finalOrgIds) {
      const org = orgsById.get(orgId);
      if (!org) {
        return errorResponse("ORG_NOT_FOUND", `Organization ${orgId} not found`, 404);
      }
      const callerRole = callerRoleOnOrg(org, caller.userId);
      if (callerRole !== "OWNER" && callerRole !== "ADMIN") {
        return errorResponse(
          "NO_GRANT_PERMISSION",
          `You must be OWNER or ADMIN of ${orgId} to grant or update access`,
          403,
        );
      }

      const members = Array.isArray(org.organization_members) ? org.organization_members : [];
      const existing = members.find((m: any) => m?.member_uid === user_id);
      const isOrgOwner = org.owner_id === user_id;

      // Trying to assign a member role to the org owner — block.
      if (isOrgOwner && role !== undefined) {
        return errorResponse(
          "CANNOT_CHANGE_OWNER_ROLE",
          `Cannot set a member role on the OWNER of ${orgId}`,
          400,
        );
      }

      // Net-new grant requires a role (we have nothing to copy).
      if (!existing && !isOrgOwner && role === undefined) {
        return errorResponse(
          "ROLE_REQUIRED_FOR_NEW_GRANTS",
          `role is required because user ${user_id} is not currently a member of ${orgId}`,
          400,
        );
      }
    }

    // Apply phase.
    const results: Array<{ organization_id: string; action: Action }> = [];
    const firstGrantedOrgIds: string[] = [];

    for (const orgId of finalOrgIds) {
      const org = orgsById.get(orgId);
      const members = Array.isArray(org.organization_members) ? [...org.organization_members] : [];
      const idx = members.findIndex((m: any) => m?.member_uid === user_id);
      const isOrgOwner = org.owner_id === user_id;

      let action: Action;
      let mutated = false;

      if (isOrgOwner) {
        action = "owner_skipped";
      } else if (idx === -1) {
        // Add new entry. role is guaranteed by pre-flight.
        members.push({ member_uid: user_id, member_role: role });
        action = "added";
        mutated = true;
        firstGrantedOrgIds.push(orgId);
      } else if (role === undefined) {
        action = "no_change";
      } else if (members[idx].member_role === role) {
        action = "no_change";
      } else {
        members[idx] = { ...members[idx], member_role: role };
        action = "role_updated";
        mutated = true;
      }

      if (mutated) {
        const { error: updErr } = await supabase
          .from("organizations")
          .update({ organization_members: members })
          .eq("id", orgId);
        if (updErr) {
          console.error(`editUserV3: failed to update org ${orgId}`, updErr);
          return errorResponse(
            "UPDATE_FAILED",
            `Failed to update organization_members for ${orgId}`,
            500,
          );
        }
      }

      results.push({ organization_id: orgId, action });
    }

    // active_organization_id repair: if null OR pointing at an org the user
    // is no longer in, set to the first newly-granted org id.
    if (firstGrantedOrgIds.length > 0) {
      const { data: targetProfile } = await supabase
        .from("profiles")
        .select("active_organization_id")
        .eq("id", user_id)
        .maybeSingle();

      let needsRepair = !targetProfile?.active_organization_id;
      if (!needsRepair && targetProfile?.active_organization_id) {
        // Verify the user still has membership on their active org.
        const { data: activeOrg } = await supabase
          .from("organizations")
          .select("owner_id, organization_members")
          .eq("id", targetProfile.active_organization_id)
          .maybeSingle();
        if (activeOrg) {
          const om = Array.isArray(activeOrg.organization_members) ? activeOrg.organization_members : [];
          const stillMember = activeOrg.owner_id === user_id ||
            om.some((m: any) => m?.member_uid === user_id);
          if (!stillMember) needsRepair = true;
        } else {
          needsRepair = true;
        }
      }
      if (needsRepair) {
        await supabase
          .from("profiles")
          .update({ active_organization_id: firstGrantedOrgIds[0] })
          .eq("id", user_id);
      }
    }

    // Best-effort notifications.
    for (const r of results) {
      if (r.action === "added" || r.action === "role_updated") {
        try {
          await createNotification({
            supabase,
            organizationId: r.organization_id,
            notificationType: r.action === "added" ? "USER_ACCESS_GRANTED" : "USER_ROLE_UPDATED",
            title: r.action === "added" ? "User Access Granted" : "User Role Updated",
            description: r.action === "added"
              ? `Access was granted to user ${user_id}`
              : `Role was updated for user ${user_id}`,
            targetRoles: ROLES.ALL,
            metadata: { user_id, granted_by: caller.userId, role },
          });
        } catch (e) {
          console.error(`editUserV3: notification failed for ${r.organization_id}`, e);
        }
      }
    }

    return successResponse({
      status: "success",
      message: `Updated access for user ${user_id}`,
      user_id,
      requested_organization_ids: uniqueOrgIds,
      organization_ids: finalOrgIds,
      results,
    }, 200);
  } catch (error: any) {
    console.error("Unexpected error in editUserV3:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error?.message || String(error)}`,
      500,
    );
  }
});
