import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId, validateOrganizationAccess } from "../_shared/organization.ts";
import { uploadLogo } from "../_shared/logoUpload.ts";

/**
 * Complete Onboarding V3 Edge Function
 *
 * Branched onboarding by organization_type:
 *   - business: 4 steps (details → return address → branding)
 *       1. Choose type
 *       2. Business details
 *       3. Return address
 *       4. Branding (FINAL)
 *   - agency:   3 steps
 *       1. Choose type
 *       2. Agency details (incl. agency_logo)
 *       3. Invite team members — body must include team_members_invited: true (FINAL)
 *
 * Agency step 3 only flips `onboarding.team_members_invited = TRUE` and marks
 * `profiles.onboarding = TRUE`. Actual invites are sent by the frontend via
 * separate createUserV3 calls.
 *
 * Branding (logo + theme) writes to `organizations.branding_settings`.
 *
 * V1 `completeOnboarding` is preserved unchanged.
 */

type Theme = {
  colors: { primary: string; secondary: string; accent: string };
  fonts: { primary: { name: string }; body: { name: string } };
};

interface V3Request {
  step: number;
  organization_id?: string;
  organization_type?: "business" | "agency"; // required on step 1

  // Step 2 — business
  business_name?: string;
  business_type?: string;
  business_phone_number?: string;
  website_url?: string;

  // Step 2 — agency
  agency_name?: string;
  agency_type?: string;
  agency_logo?: string; // base64 or URL

  // Step 3 — business (return address)
  country?: string;
  street_address?: string;
  city?: string;
  state?: string;
  zip_code?: string;

  // Step 3 — agency (invite team)
  team_members_invited?: boolean;

  // Step 4 — business (branding)
  company_logo?: string;
  theme?: Theme;
}

async function ensureOnboardingRow(supabase: any, organizationId: string) {
  const { data: existing } = await supabase
    .from("onboarding")
    .select("id")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!existing) {
    await supabase.from("onboarding").insert({ organization_id: organizationId });
  }
}

function buildAddress(
  street: string,
  city: string,
  state: string,
  zip: string,
  country: string,
): string {
  return `${street}, ${city}, ${state} ${zip}, ${country}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();
    const user = getUserFromRequest(req);
    if (!user) return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);

    let body: V3Request;
    try {
      body = await req.json();
    } catch {
      return errorResponse("INVALID_INPUT", "Invalid JSON body", 400);
    }

    const step = body.step;
    if (![1, 2, 3, 4].includes(step)) {
      return errorResponse("INVALID_INPUT", "step must be 1, 2, 3, or 4", 400);
    }

    // Resolve the user's primary org (agency org for agencies, the only org for business).
    let primaryOrgId: string | null = null;
    if (body.organization_id) {
      const hasAccess = await validateOrganizationAccess(
        supabase,
        body.organization_id,
        user.userId,
      );
      if (!hasAccess) {
        return errorResponse("FORBIDDEN", "You do not have access to this organization", 403);
      }
      primaryOrgId = body.organization_id;
    } else {
      primaryOrgId = await getUserOrganizationId(supabase, user.userId);
    }

    if (!primaryOrgId) {
      return errorResponse(
        "NO_ORGANIZATION",
        "User is not associated with any organization",
        403,
      );
    }

    await ensureOnboardingRow(supabase, primaryOrgId);

    // ──────────────────────────────────────────────────────────────────────
    // Step 1 — pick organization_type
    // ──────────────────────────────────────────────────────────────────────
    if (step === 1) {
      const orgType = body.organization_type;
      if (orgType !== "business" && orgType !== "agency") {
        return errorResponse(
          "INVALID_INPUT",
          "organization_type must be 'business' or 'agency'",
          400,
        );
      }

      const { error: orgErr } = await supabase
        .from("organizations")
        .update({ is_agency: orgType === "agency", updated_at: new Date().toISOString() })
        .eq("id", primaryOrgId);
      if (orgErr) throw orgErr;

      // Agency owners need is_super_admin + multi_org_enabled on their profile so they
      // can later use createOrganization / switchOrganization to add clients post-onboarding.
      if (orgType === "agency") {
        const { error: profileErr } = await supabase
          .from("profiles")
          .update({
            is_super_admin: true,
            multi_org_enabled: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", user.userId);
        if (profileErr) {
          console.error("V3 step 1: failed to set agency profile flags", profileErr);
          throw profileErr;
        }
      }

      return successResponse({
        status: "success",
        message: "Step 1 complete",
        step: 1,
        organization_type: orgType,
        organization_id: primaryOrgId,
      }, 200);
    }

    // For steps 2+, read is_agency to know which flow to run.
    const { data: primaryOrg, error: orgFetchErr } = await supabase
      .from("organizations")
      .select("id, is_agency")
      .eq("id", primaryOrgId)
      .single();
    if (orgFetchErr || !primaryOrg) {
      return errorResponse("FETCH_FAILED", "Failed to fetch organization", 500);
    }
    const isAgency = primaryOrg.is_agency === true;
    const orgType: "business" | "agency" = isAgency ? "agency" : "business";

    // Branched step validity. Agency flow is 3 steps; step 4 is business-only now.
    if (isAgency && step === 4) {
      return errorResponse(
        "INVALID_STEP_FOR_AGENCY",
        "Agency onboarding is 3 steps; step 4 is no longer valid.",
        400,
      );
    }

    // ──────────────────────────────────────────────────────────────────────
    // Step 2 — business details OR agency details
    // ──────────────────────────────────────────────────────────────────────
    if (step === 2) {
      if (isAgency) {
        const { agency_name, agency_type, website_url, agency_logo } = body;
        if (!agency_name || !agency_type) {
          return errorResponse(
            "INVALID_INPUT",
            "agency_name and agency_type are required",
            400,
          );
        }

        const agencyLogoUrl = await uploadLogo(supabase, primaryOrgId, agency_logo);

        const { error: onbErr } = await supabase
          .from("onboarding")
          .update({
            business_name: agency_name,
            business_industry: agency_type,
            website_url: website_url || null,
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", primaryOrgId);
        if (onbErr) throw onbErr;

        // Merge agency logo into branding_settings if uploaded.
        const orgUpdate: any = {
          business_name: agency_name,
          industry: agency_type,
          website_url: website_url || null,
          updated_at: new Date().toISOString(),
        };
        if (agencyLogoUrl) {
          const { data: cur } = await supabase
            .from("organizations")
            .select("branding_settings")
            .eq("id", primaryOrgId)
            .single();
          orgUpdate.branding_settings = {
            ...(cur?.branding_settings || {}),
            logo: agencyLogoUrl,
          };
        }

        const { error: orgErr2 } = await supabase
          .from("organizations")
          .update(orgUpdate)
          .eq("id", primaryOrgId);
        if (orgErr2) throw orgErr2;

        return successResponse({
          status: "success",
          message: "Step 2 (agency details) complete",
          step: 2,
          organization_type: orgType,
          organization_id: primaryOrgId,
          agency_logo_url: agencyLogoUrl,
        }, 200);
      }

      // Business
      const { business_name, business_type, business_phone_number, website_url } = body;
      if (!business_name || !business_type) {
        return errorResponse(
          "INVALID_INPUT",
          "business_name and business_type are required",
          400,
        );
      }

      const { error: onbErr } = await supabase
        .from("onboarding")
        .update({
          business_name,
          business_industry: business_type,
          business_phone_number: business_phone_number || null,
          website_url: website_url || null,
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", primaryOrgId);
      if (onbErr) throw onbErr;

      const { error: orgErr3 } = await supabase
        .from("organizations")
        .update({
          business_name,
          industry: business_type,
          phone_number: business_phone_number || null,
          website_url: website_url || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", primaryOrgId);
      if (orgErr3) throw orgErr3;

      return successResponse({
        status: "success",
        message: "Step 2 (business details) complete",
        step: 2,
        organization_type: orgType,
        organization_id: primaryOrgId,
      }, 200);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Step 3 — business return address OR agency invite-team (FINAL for agency)
    // ──────────────────────────────────────────────────────────────────────
    if (step === 3) {
      if (isAgency) {
        // Agency step 3 (FINAL): invite team members. Frontend handles the
        // actual invites via createUserV3; this endpoint only marks completion.
        if (body.team_members_invited !== true) {
          return errorResponse(
            "INVALID_INPUT",
            "team_members_invited must be true to complete step 3",
            400,
          );
        }

        const { error: onbErr } = await supabase
          .from("onboarding")
          .update({
            team_members_invited: true,
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", primaryOrgId);
        if (onbErr) {
          console.error("V3 agency step 3 onboarding update error", onbErr);
          return errorResponse("DATABASE_ERROR", "Failed to mark team-invite step complete", 500);
        }

        const { error: profErr } = await supabase
          .from("profiles")
          .update({ onboarding: true, updated_at: new Date().toISOString() })
          .eq("id", user.userId);
        if (profErr) {
          console.error("V3 agency step 3 profile update error", profErr);
          return errorResponse("DATABASE_ERROR", "Failed to mark profile onboarding complete", 500);
        }

        return successResponse({
          status: "success",
          message: "Agency onboarding complete",
          step: 3,
          organization_type: orgType,
          organization_id: primaryOrgId,
          team_members_invited: true,
          onboarding: true,
        }, 200);
      }

      // Business — return address
      const { country, street_address, city, state, zip_code } = body;
      if (!country || !street_address || !city || !state || !zip_code) {
        return errorResponse("INVALID_INPUT", "All address fields are required", 400);
      }
      const business_address = buildAddress(street_address, city, state, zip_code, country);

      const { error: onbErr2 } = await supabase
        .from("onboarding")
        .update({
          country,
          street_address,
          city,
          state,
          zip: zip_code,
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", primaryOrgId);
      if (onbErr2) throw onbErr2;

      const { error: orgErr4 } = await supabase
        .from("organizations")
        .update({ business_address, updated_at: new Date().toISOString() })
        .eq("id", primaryOrgId);
      if (orgErr4) throw orgErr4;

      return successResponse({
        status: "success",
        message: "Step 3 (return address) complete",
        step: 3,
        organization_type: orgType,
        organization_id: primaryOrgId,
      }, 200);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Step 4 — business branding (FINAL, business-only)
    // ──────────────────────────────────────────────────────────────────────
    if (step === 4) {
      // isAgency=true was already rejected above; only the business path reaches here.
      const { company_logo, theme } = body;
      const logoUrl = await uploadLogo(supabase, primaryOrgId, company_logo);

      const { data: curOrg } = await supabase
        .from("organizations")
        .select("owner_id, branding_settings")
        .eq("id", primaryOrgId)
        .single();

      const nextBranding: any = { ...(curOrg?.branding_settings || {}) };
      if (logoUrl) nextBranding.logo = logoUrl;
      if (theme) nextBranding.theme = theme;

      const { error: orgErr5 } = await supabase
        .from("organizations")
        .update({ branding_settings: nextBranding, updated_at: new Date().toISOString() })
        .eq("id", primaryOrgId);
      if (orgErr5) throw orgErr5;

      // The theme must ALSO land on the org OWNER's profile row (2026-07-31 fix).
      // getAppContent — the endpoint that actually serves branding to the app — reads the theme
      // from `profiles.branding_settings` of `organizations.owner_id`, NOT from
      // `organizations.branding_settings`. Writing only the organization row meant a theme chosen
      // during onboarding was stored but never rendered anywhere, so the user's branding looked as
      // though it had not saved at all. Merge rather than replace, so an existing profile-level
      // logo/other keys survive.
      if (theme) {
        const ownerId = curOrg?.owner_id ?? user.userId;
        const { data: ownerProfile } = await supabase
          .from("profiles")
          .select("branding_settings")
          .eq("id", ownerId)
          .single();
        const { error: brandErr } = await supabase
          .from("profiles")
          .update({
            branding_settings: { ...(ownerProfile?.branding_settings || {}), theme },
            updated_at: new Date().toISOString(),
          })
          .eq("id", ownerId);
        // Fail loudly: silently swallowing this is exactly how the branding loss went unnoticed.
        if (brandErr) throw brandErr;
      }

      if (logoUrl) {
        await supabase
          .from("onboarding")
          .update({ company_logo: logoUrl, updated_at: new Date().toISOString() })
          .eq("organization_id", primaryOrgId);
      }

      await supabase
        .from("profiles")
        .update({ onboarding: true, updated_at: new Date().toISOString() })
        .eq("id", user.userId);

      return successResponse({
        status: "success",
        message: "Step 4 (branding) complete — onboarding finished",
        step: 4,
        organization_type: orgType,
        organization_id: primaryOrgId,
        company_logo: logoUrl,
        theme: theme || null,
      }, 200);
    }

    return errorResponse("INVALID_INPUT", "Unhandled step", 400);
  } catch (error: any) {
    console.error("Unexpected error in completeOnboardingV3:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error?.message || String(error)}`,
      500,
    );
  }
});
