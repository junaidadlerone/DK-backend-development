import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Delete Organization Edge Function
 * Soft-deletes an organization by scheduling it for permanent deletion
 * after a 30-day recovery window. Requires type-to-confirm safety check.
 *
 * Request body:
 * {
 *   "organization_id": "uuid",
 *   "confirm_name": "Exact Org Name"
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
    let confirm_name: string | undefined;

    try {
      const body = await req.json();
      organization_id = body.organization_id;
      confirm_name = body.confirm_name;
    } catch {
      return errorResponse("INVALID_INPUT", "Invalid JSON body", 400);
    }

    if (!organization_id || !confirm_name) {
      return errorResponse("INVALID_INPUT", "organization_id and confirm_name are required", 400);
    }

    // Fetch the org
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("id, business_name, owner_id, deletion_scheduled_at")
      .eq("id", organization_id)
      .single();

    if (orgError || !org) {
      return errorResponse("ORG_NOT_FOUND", "Organization not found", 404);
    }

    // Only the owner can delete
    if (org.owner_id !== user.userId) {
      return errorResponse("FORBIDDEN", "Only the organization owner can delete it", 403);
    }

    // Already scheduled
    if (org.deletion_scheduled_at) {
      return errorResponse("ALREADY_SCHEDULED", "Deletion is already scheduled for this organization", 409);
    }

    // Type-to-confirm check
    if (org.business_name !== null && confirm_name !== org.business_name) {
      return errorResponse(
        "NAME_MISMATCH",
        "Confirmation name does not match the organization name",
        400
      );
    }

    // Schedule deletion 30 days from now
    const scheduledAt = new Date();
    scheduledAt.setDate(scheduledAt.getDate() + 30);

    const { error: updateError } = await supabase
      .from("organizations")
      .update({ deletion_scheduled_at: scheduledAt.toISOString() })
      .eq("id", organization_id);

    if (updateError) {
      console.error("deleteOrganization update error:", updateError);
      return errorResponse("UPDATE_FAILED", "Failed to schedule deletion", 500);
    }

    // If this was the user's active org, switch them to their next available org
    const { data: profile } = await supabase
      .from("profiles")
      .select("active_organization_id")
      .eq("id", user.userId)
      .single();

    if (profile?.active_organization_id === organization_id) {
      const nextOrgId = await getUserOrganizationId(supabase, user.userId);
      await supabase
        .from("profiles")
        .update({ active_organization_id: nextOrgId })
        .eq("id", user.userId);
    }

    return successResponse({
      status: "success",
      message: "Organization scheduled for deletion",
      scheduled_deletion_at: scheduledAt.toISOString(),
      recover_before: scheduledAt.toISOString(),
    });

  } catch (error) {
    console.error("Unexpected error in deleteOrganization:", error);
    return errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});
