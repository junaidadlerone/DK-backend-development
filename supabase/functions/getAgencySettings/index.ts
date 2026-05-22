import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { callerRoleOnOrg } from "../_shared/agencyGate.ts";

/**
 * getAgencySettings — read counterpart to /editAgencySettings.
 *
 * Returns the same `agency` payload shape that /editAgencySettings returns
 * after a successful update, so the frontend can use one schema for both
 * the initial fetch and the post-edit refresh.
 *
 * Target org: defaults to caller's active org. Optional ?organization_id=...
 * query param targets a specific agency org the caller owns/admins.
 *
 * Gate: target org must have is_agency = true AND caller must be OWNER or
 * ADMIN of it (mirrors editAgencySettings).
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only GET method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();
    const caller = getUserFromRequest(req);
    if (!caller) return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);

    const url = new URL(req.url);
    let orgId: string | null = url.searchParams.get("organization_id");
    if (!orgId) orgId = await getUserOrganizationId(supabase, caller.userId);
    if (!orgId) {
      return errorResponse("NO_ORGANIZATION", "User has no active organization", 403);
    }

    const { data: org, error: orgErr } = await supabase
      .from("organizations")
      .select(
        "id, owner_id, organization_members, is_agency, business_name, industry, website_url, branding_settings, updated_at",
      )
      .eq("id", orgId)
      .single();
    if (orgErr || !org) {
      return errorResponse("ORG_NOT_FOUND", "Organization not found", 404);
    }
    if (org.is_agency !== true) {
      return errorResponse(
        "NOT_AGENCY_ORG",
        "Target organization is not an agency",
        400,
      );
    }
    const callerRole = callerRoleOnOrg(org, caller.userId);
    if (callerRole !== "OWNER" && callerRole !== "ADMIN") {
      return errorResponse(
        "NO_VIEW_PERMISSION",
        "You must be OWNER or ADMIN of this agency to view its settings",
        403,
      );
    }

    return successResponse({
      status: "success",
      agency: {
        organization_id: org.id,
        agency_name: org.business_name ?? null,
        industry: org.industry ?? null,
        agency_website_url: org.website_url ?? null,
        logo: (org.branding_settings as any)?.logo ?? null,
        branding_settings: org.branding_settings ?? null,
        updated_at: org.updated_at,
      },
    }, 200);
  } catch (error) {
    console.error("Unexpected error in getAgencySettings:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500,
    );
  }
});
