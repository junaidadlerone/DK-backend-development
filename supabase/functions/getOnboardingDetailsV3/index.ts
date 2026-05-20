import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Get Onboarding Details V3
 *
 * Returns all data the user filled during the V3 branched onboarding flow.
 * Shape depends on organization_type:
 *
 *   Business: { organization_type: "business", business: { ...details, address, branding } }
 *   Agency:   { organization_type: "agency",   agency: { ...details, branding },
 *                                              first_client: { ...details, address, branding } }
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST" && req.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST or GET method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();
    const user = getUserFromRequest(req);
    if (!user) return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);

    const primaryOrgId = await getUserOrganizationId(supabase, user.userId);
    if (!primaryOrgId) {
      return errorResponse(
        "NO_ORGANIZATION",
        "User is not associated with any organization",
        403,
      );
    }

    const { data: primaryOrg, error: orgErr } = await supabase
      .from("organizations")
      .select(
        "id, is_agency, business_name, industry, phone_number, business_address, website_url, branding_settings",
      )
      .eq("id", primaryOrgId)
      .single();
    if (orgErr || !primaryOrg) {
      return errorResponse("FETCH_FAILED", "Failed to fetch organization", 500);
    }

    const { data: primaryOnb } = await supabase
      .from("onboarding")
      .select(
        "country, street_address, city, state, zip, company_logo, first_client_org_id",
      )
      .eq("organization_id", primaryOrgId)
      .maybeSingle();

    const isAgency = primaryOrg.is_agency === true;

    if (!isAgency) {
      return successResponse({
        status: "success",
        data: {
          organization_type: "business",
          organization_id: primaryOrgId,
          business: {
            business_name: primaryOrg.business_name ?? null,
            business_type: primaryOrg.industry ?? null,
            business_phone_number: primaryOrg.phone_number ?? null,
            website_url: primaryOrg.website_url ?? null,
            country: primaryOnb?.country ?? null,
            street_address: primaryOnb?.street_address ?? null,
            city: primaryOnb?.city ?? null,
            state: primaryOnb?.state ?? null,
            zip_code: primaryOnb?.zip ?? null,
            business_address: primaryOrg.business_address ?? null,
            company_logo: primaryOrg.branding_settings?.logo ?? primaryOnb?.company_logo ?? null,
            theme: primaryOrg.branding_settings?.theme ?? null,
          },
        },
      }, 200);
    }

    // Agency
    const clientOrgId = primaryOnb?.first_client_org_id ?? null;

    let firstClient: any = null;
    if (clientOrgId) {
      const { data: clientOrg } = await supabase
        .from("organizations")
        .select(
          "id, business_name, industry, phone_number, business_address, website_url, branding_settings",
        )
        .eq("id", clientOrgId)
        .single();

      const { data: clientOnb } = await supabase
        .from("onboarding")
        .select("country, street_address, city, state, zip, company_logo")
        .eq("organization_id", clientOrgId)
        .maybeSingle();

      if (clientOrg) {
        firstClient = {
          organization_id: clientOrg.id,
          client_name: clientOrg.business_name ?? null,
          client_business_type: clientOrg.industry ?? null,
          client_phone_number: clientOrg.phone_number ?? null,
          client_website_url: clientOrg.website_url ?? null,
          client_country: clientOnb?.country ?? null,
          client_street_address: clientOnb?.street_address ?? null,
          client_city: clientOnb?.city ?? null,
          client_state: clientOnb?.state ?? null,
          client_zip_code: clientOnb?.zip ?? null,
          business_address: clientOrg.business_address ?? null,
          company_logo: clientOrg.branding_settings?.logo ?? clientOnb?.company_logo ?? null,
          theme: clientOrg.branding_settings?.theme ?? null,
        };
      }
    }

    return successResponse({
      status: "success",
      data: {
        organization_type: "agency",
        organization_id: primaryOrgId,
        agency: {
          agency_name: primaryOrg.business_name ?? null,
          agency_type: primaryOrg.industry ?? null,
          website_url: primaryOrg.website_url ?? null,
          agency_logo: primaryOrg.branding_settings?.logo ?? null,
        },
        first_client: firstClient,
      },
    }, 200);
  } catch (error: any) {
    console.error("Unexpected error in getOnboardingDetailsV3:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error?.message || String(error)}`,
      500,
    );
  }
});
