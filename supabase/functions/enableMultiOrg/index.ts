import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient, getUserProfile } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";

/**
 * Enable Multi-Org Edge Function
 * Allows Super Admins to enable multi-org mode.
 * Optionally saves intent questionnaire answers.
 *
 * Request body:
 * {
 *   "reason_for_multiple_orgs": "string | null",
 *   "expected_org_count": "string | null",
 *   "teammate_overlap": "string | null"
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

    const profile = await getUserProfile(user.userId);

    if (!profile) {
      return errorResponse("PROFILE_NOT_FOUND", "User profile not found", 404);
    }

    if (!profile.is_super_admin) {
      return errorResponse("FORBIDDEN", "Only Super Admins can enable multi-org mode", 403);
    }

    // Idempotent — already enabled
    if (profile.multi_org_enabled) {
      return successResponse({ status: "success", message: "Multi-org mode already enabled", multi_org_enabled: true });
    }

    // Parse optional intent answers
    let reason_for_multiple_orgs: string | null = null;
    let expected_org_count: string | null = null;
    let teammate_overlap: string | null = null;

    try {
      const body = await req.json();
      reason_for_multiple_orgs = body.reason_for_multiple_orgs ?? null;
      expected_org_count = body.expected_org_count ?? null;
      teammate_overlap = body.teammate_overlap ?? null;
    } catch {
      // Body is optional — no error if missing or empty
    }

    // Save intent answers if any were provided
    if (reason_for_multiple_orgs || expected_org_count || teammate_overlap) {
      await supabase.from("multi_org_intent").insert({
        user_id: user.userId,
        reason_for_multiple_orgs,
        expected_org_count,
        teammate_overlap,
      });
    }

    // Enable multi-org
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ multi_org_enabled: true })
      .eq("id", user.userId);

    if (updateError) {
      console.error("enableMultiOrg update error:", updateError);
      return errorResponse("UPDATE_FAILED", "Failed to enable multi-org mode", 500);
    }

    return successResponse({
      status: "success",
      message: "Multi-org mode enabled",
      multi_org_enabled: true,
    });

  } catch (error) {
    console.error("Unexpected error in enableMultiOrg:", error);
    return errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});
