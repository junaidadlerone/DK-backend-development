import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient, getUserProfile } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";

/**
 * Transfer Organization Ownership Edge Function
 * Transfers ownership of an org to an existing member.
 * The old owner is added back as a member with their current profile role.
 * Used during "Disable Multi-Org" cleanup when the user wants to keep
 * an org running under a different owner.
 *
 * Request body:
 * {
 *   "organization_id": "uuid",
 *   "new_owner_id": "uuid"
 * }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();

  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();
    const user = getUserFromRequest(req);

    if (!user) {
      return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);
    }

    let organization_id: string | undefined;
    let new_owner_id: string | undefined;

    try {
      const body = await req.json();
      organization_id = body.organization_id;
      new_owner_id = body.new_owner_id;
    } catch {
      return errorResponse("INVALID_INPUT", "Invalid JSON body", 400);
    }

    if (!organization_id || !new_owner_id) {
      return errorResponse("INVALID_INPUT", "organization_id and new_owner_id are required", 400);
    }

    if (new_owner_id === user.userId) {
      return errorResponse("SAME_OWNER", "Cannot transfer ownership to yourself", 400);
    }

    // Fetch the org
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("id, owner_id, organization_members")
      .eq("id", organization_id)
      .single();

    if (orgError || !org) {
      return errorResponse("ORG_NOT_FOUND", "Organization not found", 404);
    }

    // Only the current owner can transfer
    if (org.owner_id !== user.userId) {
      return errorResponse("FORBIDDEN", "Only the current owner can transfer ownership", 403);
    }

    // Validate new owner is an existing member of this org
    const currentMembers: any[] = org.organization_members || [];
    const newOwnerMember = currentMembers.find((m: any) => m?.member_uid === new_owner_id);

    if (!newOwnerMember) {
      return errorResponse(
        "NOT_A_MEMBER",
        "The specified user is not a member of this organization",
        400
      );
    }

    // Fetch old owner's profile role to use when adding them as a member
    const oldOwnerProfile = await getUserProfile(user.userId);
    const oldOwnerRole = oldOwnerProfile?.role ?? "ADMIN";

    // Build updated members list:
    // - Remove new owner (they become the owner, not a member)
    // - Add old owner as a member
    const updatedMembers = currentMembers
      .filter((m: any) => m?.member_uid !== new_owner_id)
      .concat([{ member_uid: user.userId, member_role: oldOwnerRole }]);

    const { error: updateError } = await supabase
      .from("organizations")
      .update({
        owner_id: new_owner_id,
        organization_members: updatedMembers,
      })
      .eq("id", organization_id);

    if (updateError) {
      console.error("transferOrganizationOwnership update error:", updateError);
      return errorResponse("UPDATE_FAILED", "Failed to transfer ownership", 500);
    }

    return successResponse({
      status: "success",
      transferred: true,
      new_owner_id,
    });

  } catch (error) {
    console.error("Unexpected error in transferOrganizationOwnership:", error);
    return errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});
