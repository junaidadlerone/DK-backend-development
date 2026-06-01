import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import {
  createSupabaseClient,
  isValidEmail,
  isValidRole,
  type UserRole,
} from "../_shared/client.ts";
import { getUserFromRequest, getUserProfile } from "../_shared/history.ts";
import { createNotification, ROLES } from "../_shared/notifications.ts";
import { callerRoleOnOrg } from "../_shared/agencyGate.ts";
import { getUserOrganizations } from "../_shared/organization.ts";

/**
 * createUserV3 — multi-org user invitation for agency users.
 *
 * Differs from V1 `createUser`:
 *   - Accepts `organization_ids: string[]` and adds the new user to every listed org in a single call.
 *   - Single auth invite email regardless of how many orgs are granted.
 *   - Gated to agency users (OWNER/ADMIN of at least one is_agency=true org).
 *
 * V1 createUser is preserved unchanged.
 */

interface CreateUserV3Request {
  email: string;
  fullName?: string | null;
  role: UserRole;
  organization_ids?: string[];
  grant_agency_access?: boolean;
}

const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://door-knocker-plus-dev.vercel.app").replace(/\/$/, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();
    const caller = getUserFromRequest(req);
    if (!caller) return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);

    // Body parse
    let body: CreateUserV3Request;
    try {
      body = await req.json();
    } catch {
      return errorResponse("INVALID_INPUT", "Invalid JSON body", 400);
    }

    const { email, fullName, role, organization_ids } = body;

    if (!email || !role) {
      return errorResponse("INVALID_INPUT", "email and role are required", 400);
    }
    if (!isValidEmail(email)) {
      return errorResponse("INVALID_EMAIL", "Invalid email format", 400);
    }
    if (!isValidRole(role)) {
      return errorResponse("INVALID_ROLE", "role must be ADMIN, MARKETER, or TECHNICIAN", 400);
    }

    const rawOrgIds = Array.isArray(organization_ids) ? organization_ids : [];
    const uniqueOrgIds = Array.from(new Set(rawOrgIds));
    if (uniqueOrgIds.length !== rawOrgIds.length) {
      return errorResponse("INVALID_INPUT", "organization_ids must not contain duplicates", 400);
    }
    // Agency-org auto-grant is now opt-in. When grant_agency_access is true,
    // every is_agency=true org the caller OWNs or ADMINs is auto-merged into
    // the grant list. When false/omitted (default), only the orgs the frontend
    // explicitly listed in organization_ids are granted.
    const grantAgencyAccess = body.grant_agency_access === true;
    if (uniqueOrgIds.length === 0 && !grantAgencyAccess) {
      return errorResponse(
        "INVALID_INPUT",
        "organization_ids must be a non-empty array of UUIDs when grant_agency_access is not true",
        400,
      );
    }

    // Gate: caller must be OWNER or ADMIN of at least one is_agency=true org.
    // This restricts the V3 surface to agency users regardless of the
    // grant_agency_access flag (the flag controls auto-merge, not eligibility).
    const callerOrgs = await getUserOrganizations(supabase, caller.userId);
    const callerAgencyOrgIds = callerOrgs
      .filter((o) => o.isAgencyAccount === true && (o.role === "OWNER" || o.role === "ADMIN"))
      .map((o) => o.id);

    if (callerAgencyOrgIds.length === 0) {
      return errorResponse(
        "NOT_AGENCY_USER",
        "Only agency users can call V3 endpoints. Use V1 createUser for single-org operations.",
        403,
      );
    }

    // Final grant list: with the flag, union with caller's agency orgs; without it,
    // honor the frontend's organization_ids verbatim.
    const finalOrgIds = grantAgencyAccess
      ? Array.from(new Set([...uniqueOrgIds, ...callerAgencyOrgIds]))
      : uniqueOrgIds;

    // Caller profile (for created_by audit field)
    const callerProfile = await getUserProfile(supabase, caller.userId);
    if (!callerProfile) {
      return errorResponse("ADMIN_PROFILE_NOT_FOUND", "Caller profile not found", 404);
    }

    // Pre-flight: load all orgs we plan to grant access to (requested + agency parents)
    // in one query, then validate ownership/ADMIN-membership for each.
    const { data: orgs, error: orgsErr } = await supabase
      .from("organizations")
      .select("id, owner_id, organization_members")
      .in("id", finalOrgIds);
    if (orgsErr) {
      console.error("createUserV3: org fetch error", orgsErr);
      return errorResponse("FETCH_FAILED", "Failed to load organizations", 500);
    }

    const orgsById = new Map<string, any>();
    for (const o of orgs || []) orgsById.set(o.id, o);

    for (const orgId of finalOrgIds) {
      const org = orgsById.get(orgId);
      if (!org) {
        return errorResponse("ORG_NOT_FOUND", `Organization ${orgId} not found`, 400);
      }
      const callerRole = callerRoleOnOrg(org, caller.userId);
      if (callerRole !== "OWNER" && callerRole !== "ADMIN") {
        return errorResponse(
          "NO_INVITE_PERMISSION",
          `You must be OWNER or ADMIN of ${orgId} to grant access`,
          403,
        );
      }
    }

    // All pre-flight passed. Invite the auth user (single email).
    const { data: authData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
      email,
      {
        data: { full_name: fullName || null },
        redirectTo: `${SITE_URL}/set-password`,
      },
    );
    if (inviteError) {
      if (
        inviteError.message.includes("already registered") ||
        inviteError.message.includes("already been registered")
      ) {
        return errorResponse("EMAIL_EXISTS", "An account with this email already exists", 409);
      }
      console.error("createUserV3: invite error", inviteError);
      return errorResponse(
        "USER_INVITATION_FAILED",
        inviteError.message || "Failed to send invitation",
        400,
      );
    }
    if (!authData?.user) {
      return errorResponse("USER_INVITATION_FAILED", "Failed to send invitation", 500);
    }

    const newUserId = authData.user.id;

    // Insert profile row.
    const { error: profileErr } = await supabase.from("profiles").insert({
      id: newUserId,
      role,
      full_name: fullName || null,
      created_by: callerProfile,
      onboarding: true,
    });
    if (profileErr) {
      console.error("createUserV3: profile insert error", profileErr);
      // Rollback auth user.
      await supabase.auth.admin.deleteUser(newUserId);
      return errorResponse("PROFILE_CREATION_FAILED", "Failed to create user profile", 500);
    }

    // Add to each org's organization_members (idempotent: skip if already present).
    const addedTo: string[] = [];
    for (const orgId of finalOrgIds) {
      const org = orgsById.get(orgId);
      const currentMembers = Array.isArray(org.organization_members) ? org.organization_members : [];
      if (currentMembers.some((m: any) => m?.member_uid === newUserId)) continue;
      const updatedMembers = [...currentMembers, { member_uid: newUserId, member_role: role }];
      const { error: updErr } = await supabase
        .from("organizations")
        .update({ organization_members: updatedMembers })
        .eq("id", orgId);
      if (updErr) {
        console.error(`createUserV3: failed to add member to org ${orgId}`, updErr);
        // Best-effort: continue with the rest; we don't roll back partial successes.
        continue;
      }
      addedTo.push(orgId);

      // Notification per org.
      try {
        await createNotification({
          supabase,
          organizationId: orgId,
          notificationType: "NEW_USER_ADDED",
          title: "New User Added",
          description: `New ${role} user "${fullName || authData.user.email}" has been added`,
          targetRoles: ROLES.ALL,
          metadata: {
            user_id: newUserId,
            user_email: authData.user.email,
            user_name: fullName || null,
            user_role: role,
            created_by: callerProfile,
          },
        });
      } catch (e) {
        console.error(`createUserV3: notification for org ${orgId} failed`, e);
      }
    }

    return successResponse({
      status: "success",
      message: `User invited and added to ${addedTo.length} organization(s)`,
      user: {
        id: newUserId,
        email: authData.user.email,
        fullName: fullName || null,
        role,
        organization_ids: finalOrgIds,
        requested_organization_ids: uniqueOrgIds,
        auto_added_agency_organization_ids: grantAgencyAccess
          ? callerAgencyOrgIds.filter((id) => !uniqueOrgIds.includes(id))
          : [],
        grant_agency_access: grantAgencyAccess,
      },
    }, 201);
  } catch (error) {
    console.error("Unexpected error in createUserV3:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500,
    );
  }
});
