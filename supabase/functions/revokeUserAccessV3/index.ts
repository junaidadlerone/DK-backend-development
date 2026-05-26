import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { createNotification, ROLES } from "../_shared/notifications.ts";
import { callerRoleOnOrg } from "../_shared/agencyGate.ts";
import { getUserOrganizations } from "../_shared/organization.ts";

/**
 * revokeUserAccessV3 — remove a user's membership from one or more orgs.
 *
 * Profile and auth account remain intact. Other org memberships are untouched.
 * Whole-call rejection on any per-org validation failure.
 */

interface RevokeRequest {
  user_id: string;
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

    let body: RevokeRequest;
    try {
      body = await req.json();
    } catch {
      return errorResponse("INVALID_INPUT", "Invalid JSON body", 400);
    }

    const { user_id, organization_ids } = body;
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

    // Gate + resolve caller's agency orgs in one pass.
    const callerOrgs = await getUserOrganizations(supabase, caller.userId);
    const callerAgencyOrgIds = callerOrgs
      .filter((o) => o.isAgencyAccount === true && (o.role === "OWNER" || o.role === "ADMIN"))
      .map((o) => o.id);
    if (callerAgencyOrgIds.length === 0) {
      return errorResponse(
        "NOT_AGENCY_USER",
        "Only agency users can call V3 endpoints",
        403,
      );
    }

    // Self-revoke guard
    if (user_id === caller.userId) {
      return errorResponse("INVALID_OPERATION", "You cannot revoke your own access", 400);
    }

    // Symmetric with createUserV3 which auto-ADDS the caller's agency orgs into
    // every grant: revoke silently DROPS them from the input. The user stays in
    // the agency (still visible via getUserV3 / team lists). Use deleteUserV3
    // to fully remove a user.
    const agencySet = new Set(callerAgencyOrgIds);
    const droppedAgencyOrgIds = uniqueOrgIds.filter((id) => agencySet.has(id));
    const effectiveOrgIds = uniqueOrgIds.filter((id) => !agencySet.has(id));
    if (effectiveOrgIds.length === 0) {
      return errorResponse(
        "NO_ORGS_TO_REVOKE",
        "All requested orgs are agency orgs. Agency-org access cannot be revoked here — use deleteUserV3 to fully remove the user.",
        400,
      );
    }

    // Pre-flight: load all orgs and validate every one before mutating anything.
    const { data: orgs, error: orgsErr } = await supabase
      .from("organizations")
      .select("id, owner_id, organization_members")
      .in("id", effectiveOrgIds);
    if (orgsErr) {
      console.error("revokeUserAccessV3: org fetch error", orgsErr);
      return errorResponse("FETCH_FAILED", "Failed to load organizations", 500);
    }
    const orgsById = new Map<string, any>();
    for (const o of orgs || []) orgsById.set(o.id, o);

    for (const orgId of effectiveOrgIds) {
      const org = orgsById.get(orgId);
      if (!org) return errorResponse("ORG_NOT_FOUND", `Organization ${orgId} not found`, 404);
      const role = callerRoleOnOrg(org, caller.userId);
      if (role !== "OWNER" && role !== "ADMIN") {
        return errorResponse(
          "NO_REVOKE_PERMISSION",
          `You must be OWNER or ADMIN of ${orgId} to revoke access`,
          403,
        );
      }
      if (org.owner_id === user_id) {
        return errorResponse(
          "CANNOT_REVOKE_OWNER",
          `Cannot revoke the OWNER of ${orgId}. Use transferOrganizationOwnership first.`,
          400,
        );
      }
    }

    // All checks passed — apply revocations.
    const results: Array<{ organization_id: string; was_member: boolean }> = [];

    for (const orgId of effectiveOrgIds) {
      const org = orgsById.get(orgId);
      const members = Array.isArray(org.organization_members) ? org.organization_members : [];
      const updatedMembers = members.filter((m: any) => m?.member_uid !== user_id);
      const was_member = updatedMembers.length !== members.length;

      if (was_member) {
        const { error: updErr } = await supabase
          .from("organizations")
          .update({ organization_members: updatedMembers })
          .eq("id", orgId);
        if (updErr) {
          console.error(`revokeUserAccessV3: failed to update org ${orgId}`, updErr);
          // Continue with other orgs; report this as an issue.
        } else {
          try {
            await createNotification({
              supabase,
              organizationId: orgId,
              notificationType: "USER_ACCESS_REVOKED",
              title: "User Access Revoked",
              description: `Access was revoked for user ${user_id}`,
              targetRoles: ROLES.ALL,
              metadata: { user_id, revoked_by: caller.userId },
            });
          } catch (e) {
            console.error(`revokeUserAccessV3: notification failed for ${orgId}`, e);
          }
        }
      }

      results.push({ organization_id: orgId, was_member });
    }

    // Clear active_organization_id if it pointed at one of the revoked orgs.
    const { data: targetProfile } = await supabase
      .from("profiles")
      .select("active_organization_id")
      .eq("id", user_id)
      .maybeSingle();
    if (targetProfile?.active_organization_id && effectiveOrgIds.includes(targetProfile.active_organization_id)) {
      await supabase
        .from("profiles")
        .update({ active_organization_id: null })
        .eq("id", user_id);
    }

    return successResponse({
      status: "success",
      message: `User access revoked from ${results.filter((r) => r.was_member).length} organization(s)`,
      user_id,
      results,
      dropped_agency_organization_ids: droppedAgencyOrgIds,
    }, 200);
  } catch (error) {
    console.error("Unexpected error in revokeUserAccessV3:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500,
    );
  }
});
