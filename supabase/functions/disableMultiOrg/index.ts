import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient, getUserProfile } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";

/**
 * Disable Multi-Org Edge Function
 * Allows Super Admins to disable multi-org mode.
 * Blocked if more than one active (non-deleted) org exists — user must
 * delete or transfer extra orgs first.
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
      return errorResponse("FORBIDDEN", "Only Super Admins can disable multi-org mode", 403);
    }

    // Idempotent — already disabled
    if (!profile.multi_org_enabled) {
      return successResponse({ status: "success", message: "Multi-org mode already disabled", multi_org_enabled: false });
    }

    // Count active orgs owned by this user which have not been deleted yet.
    const now = new Date().toISOString();

    const { data: ownedOrgs, error: orgsError } = await supabase
      .from("organizations")
      .select("id, business_name")
      .eq("owner_id", user.userId)
      .or(`deletion_scheduled_at.is.null,deletion_scheduled_at.gt.${now}`);

    if (orgsError) {
      console.error("disableMultiOrg orgs fetch error:", orgsError);
      return errorResponse("FETCH_FAILED", "Failed to fetch organizations", 500);
    }

    const activeOrgs = ownedOrgs || [];

    if (activeOrgs.length > 1) {
      // User must clean up before disabling
      const extraOrgs = activeOrgs.slice(1).map((o: any) => ({
        id: o.id,
        business_name: o.business_name,
      }));

      return new Response(
        JSON.stringify({
          error: "CLEANUP_REQUIRED",
          message: "You must delete or transfer ownership of extra organizations before disabling multi-org mode",
          extra_organizations: extraOrgs,
        }),
        {
          status: 409,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept",
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          },
        }
      );
    }

    // Safe to disable
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ multi_org_enabled: false })
      .eq("id", user.userId);

    if (updateError) {
      console.error("disableMultiOrg update error:", updateError);
      return errorResponse("UPDATE_FAILED", "Failed to disable multi-org mode", 500);
    }

    return successResponse({
      status: "success",
      message: "Multi-org mode disabled",
      multi_org_enabled: false,
    });

  } catch (error) {
    console.error("Unexpected error in disableMultiOrg:", error);
    return errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});
