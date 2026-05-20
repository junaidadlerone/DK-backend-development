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
 *   - agency:   5 steps (agency details → first client details → client return address → branding for client)
 *
 * Branding (logo + theme) writes to `organizations.branding_settings`.
 * For agency flow, step 3 creates a client sub-org; its id is stored on the agency's
 * `onboarding.first_client_org_id` so steps 4–5 are resumable.
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

  // Step 3 — business
  country?: string;
  street_address?: string;
  city?: string;
  state?: string;
  zip_code?: string;

  // Step 3 — agency (first client)
  client_name?: string;
  client_business_type?: string;
  client_phone_number?: string;
  client_website_url?: string;

  // Step 4 — business (branding) / Step 5 — agency (branding)
  company_logo?: string;
  theme?: Theme;

  // Step 4 — agency (client address)
  client_country?: string;
  client_street_address?: string;
  client_city?: string;
  client_state?: string;
  client_zip_code?: string;
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
    if (![1, 2, 3, 4, 5].includes(step)) {
      return errorResponse("INVALID_INPUT", "step must be 1, 2, 3, 4, or 5", 400);
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
      // can later use createOrganization / switchOrganization to add more clients past
      // the first one we create in step 3. Mirrors what enableMultiOrg sets.
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
    // Step 3 — business return address OR agency first-client details
    // ──────────────────────────────────────────────────────────────────────
    if (step === 3) {
      if (isAgency) {
        const { client_name, client_business_type, client_phone_number, client_website_url } =
          body;
        if (!client_name || !client_business_type) {
          return errorResponse(
            "INVALID_INPUT",
            "client_name and client_business_type are required",
            400,
          );
        }

        // Check if the agency's onboarding row already has first_client_org_id (idempotency).
        const { data: agencyOnb } = await supabase
          .from("onboarding")
          .select("first_client_org_id")
          .eq("organization_id", primaryOrgId)
          .single();

        let clientOrgId: string | null = agencyOnb?.first_client_org_id || null;

        if (clientOrgId) {
          // Update existing sub-org.
          const { error: updErr } = await supabase
            .from("organizations")
            .update({
              business_name: client_name,
              industry: client_business_type,
              phone_number: client_phone_number || null,
              website_url: client_website_url || null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", clientOrgId);
          if (updErr) throw updErr;

          await supabase
            .from("onboarding")
            .update({
              business_name: client_name,
              business_industry: client_business_type,
              business_phone_number: client_phone_number || null,
              website_url: client_website_url || null,
              updated_at: new Date().toISOString(),
            })
            .eq("organization_id", clientOrgId);
        } else {
          // Create new sub-org.
          const { data: newOrg, error: insErr } = await supabase
            .from("organizations")
            .insert({
              owner_id: user.userId,
              organization_members: [],
              is_agency: false,
              business_name: client_name,
              industry: client_business_type,
              phone_number: client_phone_number || null,
              website_url: client_website_url || null,
            })
            .select()
            .single();
          if (insErr || !newOrg) {
            console.error("V3 step 3 insert error:", insErr);
            return errorResponse(
              "ORG_CREATION_FAILED",
              "Failed to create client sub-org",
              500,
            );
          }
          clientOrgId = newOrg.id;

          // Default app content for the new sub-org (mirrors createOrganization).
          try {
            await supabase.rpc("create_default_app_content", { org_id: clientOrgId });
          } catch (e) {
            console.error("create_default_app_content exception:", e);
          }

          // Create blank onboarding row for the sub-org.
          await supabase.from("onboarding").insert({
            organization_id: clientOrgId,
            business_name: client_name,
            business_industry: client_business_type,
            business_phone_number: client_phone_number || null,
            website_url: client_website_url || null,
          });

          // Store first_client_org_id on the agency's onboarding row.
          await supabase
            .from("onboarding")
            .update({
              first_client_org_id: clientOrgId,
              updated_at: new Date().toISOString(),
            })
            .eq("organization_id", primaryOrgId);
        }

        return successResponse({
          status: "success",
          message: "Step 3 (first client details) complete",
          step: 3,
          organization_type: orgType,
          organization_id: primaryOrgId,
          client_organization_id: clientOrgId,
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
    // Step 4 — business branding (FINAL) OR agency client address
    // ──────────────────────────────────────────────────────────────────────
    if (step === 4) {
      if (isAgency) {
        // Agency: client address — needs first_client_org_id.
        const { data: agencyOnb } = await supabase
          .from("onboarding")
          .select("first_client_org_id")
          .eq("organization_id", primaryOrgId)
          .single();
        const clientOrgId = agencyOnb?.first_client_org_id;
        if (!clientOrgId) {
          return errorResponse(
            "INVALID_STATE",
            "Step 3 (first client) must be completed before step 4",
            400,
          );
        }

        const {
          client_country,
          client_street_address,
          client_city,
          client_state,
          client_zip_code,
        } = body;
        if (
          !client_country || !client_street_address || !client_city ||
          !client_state || !client_zip_code
        ) {
          return errorResponse(
            "INVALID_INPUT",
            "All client address fields are required",
            400,
          );
        }
        const business_address = buildAddress(
          client_street_address,
          client_city,
          client_state,
          client_zip_code,
          client_country,
        );

        await supabase
          .from("onboarding")
          .update({
            country: client_country,
            street_address: client_street_address,
            city: client_city,
            state: client_state,
            zip: client_zip_code,
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", clientOrgId);

        const { error: clientOrgErr } = await supabase
          .from("organizations")
          .update({ business_address, updated_at: new Date().toISOString() })
          .eq("id", clientOrgId);
        if (clientOrgErr) throw clientOrgErr;

        return successResponse({
          status: "success",
          message: "Step 4 (client return address) complete",
          step: 4,
          organization_type: orgType,
          organization_id: primaryOrgId,
          client_organization_id: clientOrgId,
        }, 200);
      }

      // Business — branding (FINAL step for business)
      const { company_logo, theme } = body;
      const logoUrl = await uploadLogo(supabase, primaryOrgId, company_logo);

      const { data: curOrg } = await supabase
        .from("organizations")
        .select("branding_settings")
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

    // ──────────────────────────────────────────────────────────────────────
    // Step 5 — agency only: branding for first client sub-org (FINAL)
    // ──────────────────────────────────────────────────────────────────────
    if (step === 5) {
      if (!isAgency) {
        return errorResponse(
          "INVALID_STATE",
          "Step 5 is only valid for the agency flow",
          400,
        );
      }

      const { data: agencyOnb } = await supabase
        .from("onboarding")
        .select("first_client_org_id")
        .eq("organization_id", primaryOrgId)
        .single();
      const clientOrgId = agencyOnb?.first_client_org_id;
      if (!clientOrgId) {
        return errorResponse(
          "INVALID_STATE",
          "Step 3 (first client) must be completed before step 5",
          400,
        );
      }

      const { company_logo, theme } = body;
      const logoUrl = await uploadLogo(supabase, clientOrgId, company_logo);

      const { data: curClientOrg } = await supabase
        .from("organizations")
        .select("branding_settings")
        .eq("id", clientOrgId)
        .single();

      const nextBranding: any = { ...(curClientOrg?.branding_settings || {}) };
      if (logoUrl) nextBranding.logo = logoUrl;
      if (theme) nextBranding.theme = theme;

      const { error: clientBrandErr } = await supabase
        .from("organizations")
        .update({ branding_settings: nextBranding, updated_at: new Date().toISOString() })
        .eq("id", clientOrgId);
      if (clientBrandErr) throw clientBrandErr;

      if (logoUrl) {
        await supabase
          .from("onboarding")
          .update({ company_logo: logoUrl, updated_at: new Date().toISOString() })
          .eq("organization_id", clientOrgId);
      }

      await supabase
        .from("profiles")
        .update({ onboarding: true, updated_at: new Date().toISOString() })
        .eq("id", user.userId);

      return successResponse({
        status: "success",
        message: "Step 5 (client branding) complete — onboarding finished",
        step: 5,
        organization_type: orgType,
        organization_id: primaryOrgId,
        client_organization_id: clientOrgId,
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
