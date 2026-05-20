import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { createNotification, ROLES } from "../_shared/notifications.ts";
import { isAgencyUser, callerRoleOnOrg } from "../_shared/agencyGate.ts";

/**
 * deleteUserV3 — globally delete a user.
 *
 * - Removes the user from every org they're a member of.
 * - Deletes the profile row.
 * - Deletes the Supabase Auth user.
 *
 * Whole-call rejection if:
 *   - Target owns any org (must transferOrganizationOwnership first).
 *   - Target is in an org the caller does not own or administer.
 */

interface DeleteRequest {
  user_id: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST" && req.method !== "DELETE") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST or DELETE method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();
    const caller = getUserFromRequest(req);
    if (!caller) return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);

    let body: DeleteRequest;
    try {
      body = await req.json();
    } catch {
      return errorResponse("INVALID_INPUT", "Invalid JSON body", 400);
    }

    const { user_id } = body;
    if (!user_id || typeof user_id !== "string") {
      return errorResponse("INVALID_INPUT", "user_id is required", 400);
    }

    // Gate
    if (!(await isAgencyUser(supabase, caller.userId))) {
      return errorResponse(
        "NOT_AGENCY_USER",
        "Only agency users can call V3 endpoints",
        403,
      );
    }

    if (user_id === caller.userId) {
      return errorResponse("INVALID_OPERATION", "You cannot delete your own account", 400);
    }

    // Confirm target exists.
    const { data: targetProfile } = await supabase
      .from("profiles")
      .select("id, role, full_name")
      .eq("id", user_id)
      .maybeSingle();
    if (!targetProfile) {
      return errorResponse("USER_NOT_FOUND", "User not found", 404);
    }

    // Fetch every org and figure out which ones the target belongs to.
    const { data: allOrgs, error: orgsErr } = await supabase
      .from("organizations")
      .select("id, owner_id, organization_members");
    if (orgsErr) {
      console.error("deleteUserV3: org fetch error", orgsErr);
      return errorResponse("FETCH_FAILED", "Failed to load organizations", 500);
    }

    const targetOwnedOrg = (allOrgs || []).find((o) => o.owner_id === user_id);
    if (targetOwnedOrg) {
      return errorResponse(
        "CANNOT_DELETE_OWNER",
        `User owns organization ${targetOwnedOrg.id}. Use transferOrganizationOwnership first.`,
        400,
      );
    }

    const targetOrgs = (allOrgs || []).filter((o) => {
      const members = Array.isArray(o.organization_members) ? o.organization_members : [];
      return members.some((m: any) => m?.member_uid === user_id);
    });

    // Per-org check: caller must be OWNER or ADMIN of every org the target is in.
    for (const org of targetOrgs) {
      const role = callerRoleOnOrg(org, caller.userId);
      if (role !== "OWNER" && role !== "ADMIN") {
        return errorResponse(
          "NO_DELETE_PERMISSION",
          `You must be OWNER or ADMIN of ${org.id} to delete this user`,
          403,
        );
      }
    }

    // Mutations
    const removed_from_organization_ids: string[] = [];
    for (const org of targetOrgs) {
      const members = Array.isArray(org.organization_members) ? org.organization_members : [];
      const updatedMembers = members.filter((m: any) => m?.member_uid !== user_id);
      const { error: updErr } = await supabase
        .from("organizations")
        .update({ organization_members: updatedMembers })
        .eq("id", org.id);
      if (updErr) {
        console.error(`deleteUserV3: failed to remove member from org ${org.id}`, updErr);
        continue;
      }
      removed_from_organization_ids.push(org.id);

      try {
        await createNotification({
          supabase,
          organizationId: org.id,
          notificationType: "USER_DELETED",
          title: "User Deleted",
          description: `User ${targetProfile.full_name || user_id} has been deleted`,
          targetRoles: ROLES.ALL,
          metadata: { user_id, deleted_by: caller.userId },
        });
      } catch (e) {
        console.error(`deleteUserV3: notification failed for ${org.id}`, e);
      }
    }

    // Delete profile row.
    const { error: profileDelErr } = await supabase.from("profiles").delete().eq("id", user_id);
    if (profileDelErr) {
      console.error("deleteUserV3: profile delete error", profileDelErr);
      // Continue to auth delete — partial state is better than leaving the auth user dangling.
    }

    // Delete auth user.
    const { error: authDelErr } = await supabase.auth.admin.deleteUser(user_id);
    if (authDelErr) {
      console.error("deleteUserV3: auth delete error — orphan profile/membership state possible", authDelErr);
      return errorResponse(
        "AUTH_DELETE_FAILED",
        "Profile and memberships removed but Supabase Auth user could not be deleted. Manual cleanup required.",
        500,
      );
    }

    return successResponse({
      status: "success",
      message: "User deleted",
      user_id,
      removed_from_organization_ids,
    }, 200);
  } catch (error) {
    console.error("Unexpected error in deleteUserV3:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500,
    );
  }
});
