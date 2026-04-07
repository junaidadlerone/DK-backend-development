import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient, getUserProfile } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { validateOrganizationAccess } from "../_shared/organization.ts";

/**
 * Switch Organization Edge Function
 * Updates the user's active organization context.
 * Logs the switch for auditing. Fails closed — if anything
 * goes wrong the user's active org is not changed.
 *
 * Request body:
 * { "organization_id": "uuid" }
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
    try {
      const body = await req.json();
      organization_id = body.organization_id;
    } catch {
      return errorResponse("INVALID_INPUT", "Invalid JSON body", 400);
    }

    if (!organization_id) {
      return errorResponse("MISSING_ORG_ID", "organization_id is required", 400);
    }

    // Validate access
    const hasAccess = await validateOrganizationAccess(supabase, organization_id, user.userId);
    if (!hasAccess) {
      return errorResponse("FORBIDDEN", "You do not have access to this organization", 403);
    }

    // Fetch target org to check deletion status
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", organization_id)
      .single();

    if (orgError || !org) {
      return errorResponse("ORG_NOT_FOUND", "Organization not found", 404);
    }

    if (org.deletion_scheduled_at) {
      return errorResponse(
        "ORG_PENDING_DELETION",
        "This organization is scheduled for deletion and cannot be switched to",
        409
      );
    }

    // Read current active org for the audit log (before changing it)
    const profile = await getUserProfile(user.userId);
    const previousOrgId = profile?.active_organization_id ?? null;

    // Update active org — fail closed (don't log if update fails)
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ active_organization_id: organization_id })
      .eq("id", user.userId);

    if (updateError) {
      console.error("switchOrganization update error:", updateError);
      return errorResponse("SWITCH_FAILED", "Failed to switch organization. Your active org is unchanged.", 500);
    }

    // Log the switch
    await supabase.from("org_switch_log").insert({
      user_id: user.userId,
      from_org_id: previousOrgId,
      to_org_id: organization_id,
    });

    return successResponse({
      status: "success",
      switched: true,
      organization: org,
    });

  } catch (error) {
    console.error("Unexpected error in switchOrganization:", error);
    return errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});
