import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId, validateOrganizationAccess } from "../_shared/organization.ts";
import { decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

/**
 * Complete Onboarding Edge Function
 * Handles the 3-step onboarding process
 */

interface OnboardingRequest {
  step: number;
  organization_id?: string; // Optional — targets a specific org (multi-org creation flow)
  // Step 1 fields
  business_name?: string;
  industry?: string;
  business_phone_number?: string;
  business_email?: string;
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
  // Step 4 fields
  team_member_ids?: string[]; // Existing user IDs to grant access to this org
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

    const contentType = req.headers.get("content-type") || "";
    let step: number;
    let body: OnboardingRequest = {} as OnboardingRequest;

    if (contentType.includes("multipart/form-data")) {
      // Handle Multipart Form Data (Step 3 with File Upload)
      const formData = await req.formData();
      const stepStr = formData.get("step");

      if (!stepStr) {
         return errorResponse("INVALID_INPUT", "Step is required", 400);
      }
      step = parseInt(stepStr.toString());

      // Extract organization_id from FormData if provided
      const orgIdFromForm = formData.get("organization_id");
      if (orgIdFromForm) body.organization_id = orgIdFromForm.toString();

      if (step === 3) {
        // Extract Step 3 specific fields from FormData
        const logoFile = formData.get("company_logo");
        const themeStr = formData.get("theme");

        if (logoFile && logoFile instanceof File) {
          // Upload File directly
          const fileName = `${organizationId}/logo_${Date.now()}_${logoFile.name}`;
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from("CompanyLogos")
            .upload(fileName, logoFile, {
              contentType: logoFile.type,
              upsert: true
            });

          if (uploadError) {
             console.error("Upload error:", uploadError);
             return errorResponse("UPLOAD_FAILED", "Failed to upload logo", 500);
          }

          const { data: publicUrlData } = supabase.storage
            .from("CompanyLogos")
            .getPublicUrl(fileName);
          
          body.company_logo = publicUrlData.publicUrl; // Use this to update DB later
        }

        if (themeStr) {
          try {
            body.theme = JSON.parse(themeStr.toString());
          } catch {
             return errorResponse("INVALID_INPUT", "Invalid theme JSON", 400);
          }
        }
      } else {
        return errorResponse("INVALID_INPUT", "Multipart only supported for Step 3", 400);
      }

    } else {
      // Handle JSON (Steps 1, 2, 3, and 4)
      try {
        body = await req.json();
        step = body.step;
      } catch {
        return errorResponse("INVALID_INPUT", "Invalid JSON body", 400);
      }
    }

    // Resolve organization — use provided org_id if given, else fall back to active org
    let organizationId: string | null = null;
    if (body.organization_id) {
      const hasAccess = await validateOrganizationAccess(supabase, body.organization_id, user.userId);
      if (!hasAccess) {
        return errorResponse("FORBIDDEN", "You do not have access to this organization", 403);
      }
      organizationId = body.organization_id;
    } else {
      organizationId = await getUserOrganizationId(supabase, user.userId);
    }

    if (!organizationId) {
      return errorResponse("NO_ORGANIZATION", "User is not associated with any organization", 403);
    }

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
      const { business_name, industry, business_phone_number, business_email, website_url } = body;

      if (!business_name || !industry) {
        return errorResponse("INVALID_INPUT", "business_name and industry are required", 400);
      }

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
      const orgUpdateData: any = {
        business_name,
        industry,
        phone_number: business_phone_number || null,
        website_url: website_url || null,
        updated_at: new Date().toISOString()
      };

      if (business_email !== undefined) {
        orgUpdateData.business_email = business_email || null;
      }

      const { error: orgError } = await supabase
        .from("organizations")
        .update(orgUpdateData)
        .eq("id", organizationId);

      if (orgError) throw orgError;
    } else if (step === 2) {
      // Step 2: Address Information
      const { country, street_address, city, state, zip } = body;

      if (!country || !street_address || !city || !state || !zip) {
        return errorResponse("INVALID_INPUT", "All address fields are required", 400);
      }

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

      let logoUrl = company_logo; // If coming from Multipart, this is already the URL

      // Handle Base64 (Backward Compatibility or JSON request)
      if (company_logo && company_logo.startsWith("data:")) {
         try {
          const matches = company_logo.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
          let fileData: Uint8Array;
          let contentType = "image/png";
          let extension = "png";

          if (matches && matches.length === 3) {
            contentType = matches[1];
            fileData = decode(matches[2]);
            const mime = contentType.split("/")[1];
            if (mime) extension = mime;
          } else {
            fileData = decode(company_logo);
          }

          const fileName = `${organizationId}/logo_${Date.now()}.${extension}`;

          const { error: uploadError } = await supabase.storage
            .from("CompanyLogos")
            .upload(fileName, fileData, {
              contentType,
              upsert: true
            });

          if (uploadError) {
            console.error("Upload error:", uploadError);
            return errorResponse("UPLOAD_FAILED", "Failed to upload logo", 500);
          }

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
        await supabase
          .from("profiles")
          .update({
            onboarding: true,
            updated_at: new Date().toISOString()
          })
          .eq("id", user.userId);
      }

    } else if (step === 4) {
      // Step 4: Assign team members to the organization
      const { team_member_ids } = body;

      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .select("organization_members")
        .eq("id", organizationId)
        .single();

      if (orgError || !org) {
        return errorResponse("ORG_NOT_FOUND", "Organization not found", 404);
      }

      const existingMembers: any[] = org.organization_members || [];
      const newMembers: any[] = [];

      if (team_member_ids && team_member_ids.length > 0) {
        const { data: memberProfiles } = await supabase
          .from("profiles")
          .select("id, role")
          .in("id", team_member_ids);

        for (const mp of memberProfiles || []) {
          const alreadyMember = existingMembers.some((m: any) => m?.member_uid === mp.id);
          if (!alreadyMember) {
            newMembers.push({ member_uid: mp.id, member_role: mp.role });
          }
        }
      }

      const { error: updateError } = await supabase
        .from("organizations")
        .update({ organization_members: [...existingMembers, ...newMembers] })
        .eq("id", organizationId);

      if (updateError) {
        return errorResponse("UPDATE_FAILED", "Failed to update team members", 500);
      }

      return successResponse({
        status: "success",
        message: "Team members assigned to organization",
        members_added: newMembers.length,
      });

    } else {
      return errorResponse("INVALID_INPUT", "Invalid step number. Must be 1, 2, 3, or 4", 400);
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
