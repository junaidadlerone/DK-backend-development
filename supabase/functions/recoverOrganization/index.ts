import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";

/**
 * Recover Organization Edge Function
 * Cancels a scheduled deletion, restoring the organization to active status.
 * Only callable within the 30-day recovery window.
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
      return errorResponse("INVALID_INPUT", "organization_id is required", 400);
    }

    // Fetch the org
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("id, owner_id, deletion_scheduled_at")
      .eq("id", organization_id)
      .single();

    if (orgError || !org) {
      return errorResponse("ORG_NOT_FOUND", "Organization not found", 404);
    }

    // Only the owner can recover
    if (org.owner_id !== user.userId) {
      return errorResponse("FORBIDDEN", "Only the organization owner can recover it", 403);
    }

    // Not scheduled for deletion
    if (!org.deletion_scheduled_at) {
      return errorResponse("NOT_SCHEDULED", "This organization is not scheduled for deletion", 400);
    }

    // Recovery window expired
    if (new Date() > new Date(org.deletion_scheduled_at)) {
      return errorResponse(
        "RECOVERY_WINDOW_EXPIRED",
        "The 30-day recovery window has passed. This organization cannot be recovered.",
        410
      );
    }

    // Clear the scheduled deletion
    const { error: updateError } = await supabase
      .from("organizations")
      .update({ deletion_scheduled_at: null })
      .eq("id", organization_id);

    if (updateError) {
      console.error("recoverOrganization update error:", updateError);
      return errorResponse("UPDATE_FAILED", "Failed to recover organization", 500);
    }

    return successResponse({
      status: "success",
      recovered: true,
      message: "Organization successfully recovered",
    });

  } catch (error) {
    console.error("Unexpected error in recoverOrganization:", error);
    return errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});
