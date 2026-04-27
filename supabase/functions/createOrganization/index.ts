import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient, getUserProfile } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";

/**
 * Create Organization Edge Function
 * Creates a new blank organization for an existing Super Admin user.
 * Only callable when multi-org mode is enabled.
 *
 * After calling this endpoint, run completeOnboarding steps 1–4
 * with the returned organization_id to fill in org details and
 * assign team members, then call switchOrganization to auto-switch.
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
      return errorResponse("FORBIDDEN", "Only Super Admins can create organizations", 403);
    }

    if (!profile.multi_org_enabled) {
      return errorResponse(
        "MULTI_ORG_NOT_ENABLED",
        "Enable multi-org mode before creating additional organizations",
        403
      );
    }

    // Create a blank organization
    const { data: organization, error: orgError } = await supabase
      .from("organizations")
      .insert({
        owner_id: user.userId,
        organization_members: [],
        is_agency: false,
      })
      .select()
      .single();

    if (orgError || !organization) {
      console.error("createOrganization insert error:", orgError);
      return errorResponse("ORG_CREATION_FAILED", "Failed to create organization", 500);
    }

    // Create default app content for the new org
    try {
      const { error: appContentError } = await supabase.rpc("create_default_app_content", {
        org_id: organization.id,
      });
      if (appContentError) {
        console.error("create_default_app_content error:", appContentError);
      }
    } catch (e) {
      console.error("create_default_app_content exception:", e);
    }

    // Create blank onboarding row to track progress
    await supabase.from("onboarding").insert({ organization_id: organization.id });

    return successResponse({
      status: "success",
      message: "Organization created. Complete onboarding steps 1–4 to finish setup.",
      organization_id: organization.id,
    }, 201);

  } catch (error) {
    console.error("Unexpected error in createOrganization:", error);
    return errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});
