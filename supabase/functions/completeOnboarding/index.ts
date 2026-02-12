import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

/**
 * Complete Onboarding Edge Function
 * Handles the 3-step onboarding process
 */

interface OnboardingRequest {
  step: number;
  // Step 1 fields
  business_name?: string;
  industry?: string;
  business_phone_number?: string;
  website_url?: string;
  // Step 2 fields
  country?: string;
  street_address?: string;
  city?: string;
  state?: string;
  zip?: string;
  // Step 3 fields
  company_logo?: string; // Base64 string or URL
  theme?: {
    colors: {
      primary: string;
      secondary: string;
      accent: string;
    };
    fonts: {
      primary: { name: string };
      body: { name: string };
    };
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed", 405);
  }

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();
    const user = getUserFromRequest(req);
    
    if (!user) {
      return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);
    }

    const organizationId = await getUserOrganizationId(supabase, user.userId);
    if (!organizationId) {
      return errorResponse("NO_ORGANIZATION", "User is not associated with any organization", 403);
    }

    let body: OnboardingRequest;
    try {
      body = await req.json();
    } catch {
      return errorResponse("INVALID_INPUT", "Invalid JSON body", 400);
    }

    const { step } = body;

    // Check if onboarding entry exists, if not create it
    const { data: existingOnboarding } = await supabase
      .from("onboarding")
      .select("id")
      .eq("organization_id", organizationId)
      .single();

    if (!existingOnboarding) {
      await supabase.from("onboarding").insert({ organization_id: organizationId });
    }

    if (step === 1) {
      // Step 1: Business Information
      const { business_name, industry, business_phone_number, website_url } = body;

      if (!business_name || !industry) {
        return errorResponse("INVALID_INPUT", "business_name and industry are required", 400);
      }

      // Check if industry exists in job_types (optional validation)
      // const { data: jobType } = await supabase.from("job_types").select("id").eq("name", industry).single();
      // if (!jobType) return errorResponse("INVALID_INPUT", "Invalid industry", 400);

      // Update onboarding
      const { error: onboardingError } = await supabase
        .from("onboarding")
        .update({
          business_name,
          business_industry: industry,
          business_phone_number: business_phone_number || null,
          website_url: website_url || null,
          updated_at: new Date().toISOString()
        })
        .eq("organization_id", organizationId);

      if (onboardingError) throw onboardingError;

      // Update organization
      const { error: orgError } = await supabase
        .from("organizations")
        .update({
          business_name,
          industry,
          phone_number: business_phone_number || null,
          website_url: website_url || null,
          updated_at: new Date().toISOString()
        })
        .eq("id", organizationId);

      if (orgError) throw orgError;

    } else if (step === 2) {
      // Step 2: Address Information
      const { country, street_address, city, state, zip } = body;

      if (!country || !street_address || !city || !state || !zip) {
        return errorResponse("INVALID_INPUT", "All address fields are required", 400);
      }

      // Validate state belongs to country (simple check if country and state exist)
      // Ideally we query world_states join countries, but for now we trust the input or do a quick check
      // Let's simple check if country exists
      // const { data: countryData } = await supabase.from("countries").select("id").ilike("name", country).single();
      // if (!countryData) return errorResponse("INVALID_INPUT", "Invalid country", 400);

      const business_address = `${street_address}, ${city}, ${state} ${zip}, ${country}`;

      // Update onboarding
      const { error: onboardingError } = await supabase
        .from("onboarding")
        .update({
          country,
          street_address,
          city,
          state,
          zip,
          updated_at: new Date().toISOString()
        })
        .eq("organization_id", organizationId);

      if (onboardingError) throw onboardingError;

      // Update organization
      const { error: orgError } = await supabase
        .from("organizations")
        .update({
          business_address,
          updated_at: new Date().toISOString()
        })
        .eq("id", organizationId);

      if (orgError) throw orgError;

    } else if (step === 3) {
      // Step 3: Branding & Logo
      const { company_logo, theme } = body;

      let logoUrl = null;

      if (company_logo) {
        // Assume base64 string
        try {
          // Check if it's a data URL "data:image/png;base64,..."
          const matches = company_logo.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
          let fileData: Uint8Array;
          let contentType = "image/png";
          let extension = "png";

          if (matches && matches.length === 3) {
            contentType = matches[1];
            fileData = decode(matches[2]);
            // Extract extension from mime type
            const mime = contentType.split("/")[1];
            if (mime) extension = mime;
          } else {
            // Raw base64
            fileData = decode(company_logo);
          }

          const fileName = `${organizationId}/logo_${Date.now()}.${extension}`;

          const { data: uploadData, error: uploadError } = await supabase.storage
            .from("CompanyLogos")
            .upload(fileName, fileData, {
              contentType,
              upsert: true
            });

          if (uploadError) {
            console.error("Upload error:", uploadError);
            return errorResponse("UPLOAD_FAILED", "Failed to upload logo", 500);
          }

          // Get public URL
          const { data: publicUrlData } = supabase.storage
            .from("CompanyLogos")
            .getPublicUrl(fileName);
          
          logoUrl = publicUrlData.publicUrl;

        } catch (e) {
          console.error("Logo processing error:", e);
          return errorResponse("INVALID_INPUT", "Invalid logo format", 400);
        }
      }

      // Update onboarding with logo URL
      if (logoUrl) {
         await supabase
          .from("onboarding")
          .update({
            company_logo: logoUrl,
            updated_at: new Date().toISOString()
          })
          .eq("organization_id", organizationId);
      }

      // Update branding settings and set onboarding=true in profiles
      if (theme) {
         await supabase
          .from("profiles")
          .update({
            branding_settings: { theme },
            onboarding: true,
            updated_at: new Date().toISOString()
          })
          .eq("id", user.userId);
      } else {
        // Even if no theme, complete onboarding
        await supabase
          .from("profiles")
          .update({
            onboarding: true,
            updated_at: new Date().toISOString()
          })
          .eq("id", user.userId);
      }

    } else {
      return errorResponse("INVALID_INPUT", "Invalid step number", 400);
    }

    const processingTimeMs = Date.now() - startTime;

    return successResponse({
      status: "success",
      message: `Step ${step} completed successfully`,
      processingTimeMs
    });

  } catch (error) {
    console.error("Unexpected error:", error);
    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
});
