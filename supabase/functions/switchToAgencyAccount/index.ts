import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { uploadLogo } from "../_shared/logoUpload.ts";

/**
 * switchToAgencyAccount — self-service business → agency promotion.
 *
 * Creates a NEW agency-manager org on top of the caller's existing business
 * and wires up V3 invariants so the agency is fully usable in one round trip.
 * The existing business org becomes the agency's first client.
 *
 * Request body mirrors `completeOnboardingV3` step 2 (agency flow):
 *   agency_name, agency_type, agency_logo, website_url — all optional.
 *   Missing fields inherit from the existing business.
 *
 * Optional `organization_id` lets the caller pick which owned business becomes
 * the first client (rare; defaults to active org).
 *
 * Rejects if the caller already owns an org with `is_agency = true`.
 */

interface SwitchRequest {
  agency_name?: string | null;
  agency_type?: string | null;
  agency_logo?: string | null;
  website_url?: string | null;
  organization_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();
    const caller = getUserFromRequest(req);
    if (!caller) return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);

    let body: SwitchRequest = {};
    try {
      // Tolerate empty body (Content-Type may be absent / 0-length).
      const text = await req.text();
      if (text && text.trim().length > 0) body = JSON.parse(text);
    } catch {
      return errorResponse("INVALID_INPUT", "Invalid JSON body", 400);
    }

    // 1. Reject if already an agency owner.
    const { data: existingAgency, error: agencyCheckErr } = await supabase
      .from("organizations")
      .select("id, business_name")
      .eq("owner_id", caller.userId)
      .eq("is_agency", true)
      .limit(1)
      .maybeSingle();
    if (agencyCheckErr) {
      console.error("switchToAgencyAccount: agency check error", agencyCheckErr);
      return errorResponse("FETCH_FAILED", "Failed to verify account state", 500);
    }
    if (existingAgency) {
      return errorResponse(
        "ALREADY_AGENCY",
        `Caller already owns an agency org (${existingAgency.id}). Cannot switch again.`,
        400,
      );
    }

    // 2. Resolve the business org that becomes the first client.
    let clientOrgId: string | null = body.organization_id ?? null;
    if (clientOrgId) {
      // Validate: must be owned by caller and not already an agency.
      const { data: org, error: orgErr } = await supabase
        .from("organizations")
        .select("id, owner_id, is_agency")
        .eq("id", clientOrgId)
        .maybeSingle();
      if (orgErr) {
        console.error("switchToAgencyAccount: client org fetch error", orgErr);
        return errorResponse("FETCH_FAILED", "Failed to load specified organization", 500);
      }
      if (!org || org.owner_id !== caller.userId || org.is_agency === true) {
        return errorResponse(
          "INVALID_FIRST_CLIENT_ORG",
          "organization_id must reference a non-agency org you own",
          400,
        );
      }
    } else {
      clientOrgId = await getUserOrganizationId(supabase, caller.userId);
    }
    if (!clientOrgId) {
      return errorResponse(
        "NO_BUSINESS_ORG",
        "Caller has no business organization to convert",
        403,
      );
    }

    // 3. Load fields we'll inherit from the client org.
    const { data: client, error: clientErr } = await supabase
      .from("organizations")
      .select("id, business_name, industry, business_address, website_url, branding_settings")
      .eq("id", clientOrgId)
      .single();
    if (clientErr || !client) {
      console.error("switchToAgencyAccount: client load error", clientErr);
      return errorResponse("FETCH_FAILED", "Failed to load existing business", 500);
    }

    // 4. Resolve final field values: body override → inherit → null.
    const final_agency_name = body.agency_name != null && body.agency_name !== ""
      ? body.agency_name
      : client.business_name
        ? `${client.business_name} Agency`
        : null;
    const final_agency_type = body.agency_type != null && body.agency_type !== ""
      ? body.agency_type
      : client.industry ?? null;
    const final_website_url = body.website_url != null && body.website_url !== ""
      ? body.website_url
      : client.website_url ?? null;

    // Logo: upload if new payload provided, else inherit the existing URL.
    let final_logo: string | null = null;
    if (body.agency_logo != null && body.agency_logo !== "") {
      try {
        // We don't have new_org_id yet — use the client's org id as the
        // storage path prefix. Public URL is stable either way.
        final_logo = await uploadLogo(supabase, client.id, body.agency_logo);
      } catch (e: any) {
        console.error("switchToAgencyAccount: logo upload failed", e);
        return errorResponse(
          "LOGO_UPLOAD_FAILED",
          e?.message || "Failed to upload agency_logo",
          500,
        );
      }
    } else {
      final_logo = (client.branding_settings as any)?.logo ?? null;
    }

    // 5. Build branding_settings preserving any theme from the client + applying the resolved logo.
    const inheritedBranding = (client.branding_settings as any) || {};
    const nextBranding: Record<string, unknown> = { ...inheritedBranding };
    if (final_logo) {
      nextBranding.logo = final_logo;
    } else {
      delete nextBranding.logo;
    }
    const brandingForInsert = Object.keys(nextBranding).length > 0 ? nextBranding : null;

    // 6. Insert the new agency org.
    const { data: newAgency, error: insErr } = await supabase
      .from("organizations")
      .insert({
        owner_id: caller.userId,
        is_agency: true,
        organization_members: [],
        business_name: final_agency_name,
        industry: final_agency_type,
        website_url: final_website_url,
        branding_settings: brandingForInsert,
      })
      .select()
      .single();
    if (insErr || !newAgency) {
      console.error("switchToAgencyAccount: agency insert error", insErr);
      return errorResponse("INSERT_FAILED", "Failed to create agency organization", 500);
    }
    const newAgencyId = newAgency.id;

    // 7. Seed app_content for the new org (non-fatal — mirrors createOrganization).
    try {
      const { error: rpcErr } = await supabase.rpc("create_default_app_content", {
        org_id: newAgencyId,
      });
      if (rpcErr) {
        console.error("create_default_app_content error:", rpcErr);
      }
    } catch (e) {
      console.error("create_default_app_content exception:", e);
    }

    // 8. Insert the agency's onboarding row with first_client_org_id pointing to the existing business.
    const { error: onbErr } = await supabase.from("onboarding").insert({
      organization_id: newAgencyId,
      first_client_org_id: client.id,
      business_name: final_agency_name,
      business_industry: final_agency_type,
      website_url: final_website_url,
      company_logo: final_logo,
    });
    if (onbErr) {
      console.error("switchToAgencyAccount: onboarding insert error", onbErr);
      // Non-fatal — agency exists and is usable; just log.
    }

    // 9. Update the caller's profile flags.
    const { error: profErr } = await supabase
      .from("profiles")
      .update({
        is_super_admin: true,
        multi_org_enabled: true,
        active_organization_id: newAgencyId,
        onboarding: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", caller.userId);
    if (profErr) {
      console.error("switchToAgencyAccount: profile update error", profErr);
      // Non-fatal — agency exists and the caller still owns it.
    }

    return successResponse({
      status: "success",
      message: "Switched to agency account",
      agency: {
        organization_id: newAgencyId,
        agency_name: newAgency.business_name ?? null,
        industry: newAgency.industry ?? null,
        agency_website_url: newAgency.website_url ?? null,
        logo: (newAgency.branding_settings as any)?.logo ?? null,
        branding_settings: newAgency.branding_settings ?? null,
        is_agency: true,
        created_at: newAgency.created_at,
      },
      first_client: {
        organization_id: client.id,
        business_name: client.business_name ?? null,
        industry: client.industry ?? null,
        business_address: client.business_address ?? null,
        website_url: client.website_url ?? null,
      },
      profile: {
        is_super_admin: true,
        multi_org_enabled: true,
        active_organization_id: newAgencyId,
      },
    }, 201);
  } catch (error) {
    console.error("Unexpected error in switchToAgencyAccount:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500,
    );
  }
});
