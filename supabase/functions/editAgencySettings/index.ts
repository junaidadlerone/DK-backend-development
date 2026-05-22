import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { callerRoleOnOrg } from "../_shared/agencyGate.ts";
import { uploadLogo } from "../_shared/logoUpload.ts";

/**
 * editAgencySettings — update agency-level settings that were originally
 * captured by `completeOnboardingV3` step 2 (the agency flow).
 *
 * Editable fields (all optional — only fields present in the body are touched):
 *   - agency_name       → organizations.business_name + onboarding.business_name
 *   - industry          → organizations.industry      + onboarding.business_industry
 *   - agency_website_url → organizations.website_url + onboarding.website_url
 *   - logo (base64/URL) → uploaded to CompanyLogos, URL stored on
 *                          organizations.branding_settings.logo
 *
 * Target org: defaults to the caller's active organization. The caller may
 * pass `organization_id` to target an explicit agency org they own/admin (useful
 * when an agency owner manages multiple agencies, edge case).
 *
 * Gate: target org must have `is_agency = true` AND caller must be OWNER or
 * ADMIN of it.
 */

interface EditAgencyRequest {
  organization_id?: string;
  agency_name?: string | null;
  industry?: string | null;
  agency_website_url?: string | null;
  logo?: string | null; // base64, URL, or null to clear
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST" && req.method !== "PATCH") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST or PATCH allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();
    const caller = getUserFromRequest(req);
    if (!caller) return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);

    let body: EditAgencyRequest;
    try {
      body = await req.json();
    } catch {
      return errorResponse("INVALID_INPUT", "Invalid JSON body", 400);
    }

    // Determine which fields were actually provided in the request payload.
    // A field is "provided" iff its key is present (undefined means absent).
    // Empty string is treated as "no change" except for logo, where null
    // explicitly means "clear the logo".
    const provided = {
      agency_name: body.agency_name !== undefined,
      industry: body.industry !== undefined,
      agency_website_url: body.agency_website_url !== undefined,
      logo: body.logo !== undefined,
    };
    if (!provided.agency_name && !provided.industry && !provided.agency_website_url && !provided.logo) {
      return errorResponse(
        "INVALID_INPUT",
        "At least one of agency_name, industry, agency_website_url, logo must be provided",
        400,
      );
    }

    // Resolve target org.
    let orgId: string | null = body.organization_id ?? null;
    if (!orgId) orgId = await getUserOrganizationId(supabase, caller.userId);
    if (!orgId) {
      return errorResponse("NO_ORGANIZATION", "User has no active organization", 403);
    }

    // Load org + verify it's an agency and caller has OWNER/ADMIN.
    const { data: org, error: orgErr } = await supabase
      .from("organizations")
      .select("id, owner_id, organization_members, is_agency, branding_settings")
      .eq("id", orgId)
      .single();
    if (orgErr || !org) {
      return errorResponse("ORG_NOT_FOUND", "Organization not found", 404);
    }
    if (org.is_agency !== true) {
      return errorResponse(
        "NOT_AGENCY_ORG",
        "Target organization is not an agency. Use a regular org-edit endpoint instead.",
        400,
      );
    }
    const callerRole = callerRoleOnOrg(org, caller.userId);
    if (callerRole !== "OWNER" && callerRole !== "ADMIN") {
      return errorResponse(
        "NO_EDIT_PERMISSION",
        "You must be OWNER or ADMIN of this agency to edit its settings",
        403,
      );
    }

    // Build the org-level update payload.
    const orgUpdate: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    const onboardingUpdate: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (provided.agency_name) {
      const val = body.agency_name === "" ? null : body.agency_name ?? null;
      orgUpdate.business_name = val;
      onboardingUpdate.business_name = val;
    }
    if (provided.industry) {
      const val = body.industry === "" ? null : body.industry ?? null;
      orgUpdate.industry = val;
      onboardingUpdate.business_industry = val;
    }
    if (provided.agency_website_url) {
      const val = body.agency_website_url === "" ? null : body.agency_website_url ?? null;
      orgUpdate.website_url = val;
      onboardingUpdate.website_url = val;
    }

    // Logo handling — explicit null clears; non-null uploads (or passes through if already a URL).
    let newLogoUrl: string | null | undefined = undefined;
    if (provided.logo) {
      if (body.logo === null || body.logo === "") {
        newLogoUrl = null;
      } else {
        try {
          newLogoUrl = await uploadLogo(supabase, orgId, body.logo);
        } catch (e: any) {
          console.error("editAgencySettings: logo upload failed", e);
          return errorResponse(
            "LOGO_UPLOAD_FAILED",
            e?.message || "Failed to upload logo",
            500,
          );
        }
      }

      // Merge into existing branding_settings (don't clobber theme).
      const currentBranding = (org.branding_settings as any) || {};
      const nextBranding = { ...currentBranding };
      if (newLogoUrl === null) {
        delete nextBranding.logo;
      } else {
        nextBranding.logo = newLogoUrl;
      }
      orgUpdate.branding_settings = nextBranding;
    }

    // Apply org-level update.
    const { error: updErr } = await supabase
      .from("organizations")
      .update(orgUpdate)
      .eq("id", orgId);
    if (updErr) {
      console.error("editAgencySettings: org update failed", updErr);
      return errorResponse("UPDATE_FAILED", "Failed to update agency", 500);
    }

    // Mirror to onboarding row if one exists (keeps V3 onboarding-step inference happy).
    if (Object.keys(onboardingUpdate).length > 1) { // more than just updated_at
      await supabase
        .from("onboarding")
        .update(onboardingUpdate)
        .eq("organization_id", orgId);
    }

    // Return updated agency state.
    const { data: updated } = await supabase
      .from("organizations")
      .select("id, business_name, industry, website_url, is_agency, branding_settings, updated_at")
      .eq("id", orgId)
      .single();

    return successResponse({
      status: "success",
      message: "Agency settings updated",
      agency: {
        organization_id: updated?.id,
        agency_name: updated?.business_name ?? null,
        industry: updated?.industry ?? null,
        agency_website_url: updated?.website_url ?? null,
        logo: (updated?.branding_settings as any)?.logo ?? null,
        branding_settings: updated?.branding_settings ?? null,
        updated_at: updated?.updated_at,
      },
    }, 200);
  } catch (error) {
    console.error("Unexpected error in editAgencySettings:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500,
    );
  }
});
