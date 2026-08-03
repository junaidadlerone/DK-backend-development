import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Update Company Logo Edge Function
 *
 * Accepts:
 *   - multipart/form-data with `company_logo` file field → replaces existing logo
 *   - application/json with `{ "company_logo": null }` → removes logo without replacement
 *
 * Business Rules:
 *   - Deletes the old logo file from CompanyLogos storage bucket (if one exists)
 *   - Uploads the new file (if provided) and saves the public URL
 *   - Clears onboarding.company_logo (and sets to null if removing)
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();

  if (req.method !== "POST" && req.method !== "PATCH") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST/PATCH methods are allowed", 405);
  }

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

    // ── 1. Fetch existing logo URL ──────────────────────────────────────────
    const { data: onboardingData } = await supabase
      .from("onboarding")
      .select("company_logo")
      .eq("organization_id", organizationId)
      .single();

    const existingLogoUrl: string | null = onboardingData?.company_logo ?? null;

    // ── 2. (moved) Old-file deletion now happens LAST — see step 5 ──────────
    // This used to delete the existing logo from storage HERE, before the request had even been
    // parsed. Any subsequent failure — no file field, a >25MB file, a failed upload, a failed DB
    // update — therefore returned an error with the old logo already destroyed, leaving the stored
    // record pointing at a deleted object (a permanently broken logo). The delete is only safe once
    // the replacement is committed.

    // ── 3. Handle new logo or removal ───────────────────────────────────────
    let newLogoUrl: string | null = null;
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      // Multipart upload — expect a `company_logo` file field
      const formData = await req.formData();
      const logoFile = formData.get("company_logo");

      if (!logoFile || !(logoFile instanceof File)) {
        return errorResponse(
          "INVALID_INPUT",
          "For multipart requests, provide a `company_logo` file field",
          400
        );
      }

      const maxSize = 25 * 1024 * 1024; // 25MB
      if (logoFile.size > maxSize) {
        return errorResponse(
          "INVALID_INPUT",
          `File "${logoFile.name}" exceeds 25MB size limit`,
          400
        );
      }

      const fileName = `${organizationId}/logo_${Date.now()}_${logoFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from("CompanyLogos")
        .upload(fileName, logoFile, { contentType: logoFile.type, upsert: true });

      if (uploadError) {
        console.error("Upload error:", uploadError);
        return errorResponse("UPLOAD_FAILED", "Failed to upload new logo", 500);
      }

      const { data: publicUrlData } = supabase.storage
        .from("CompanyLogos")
        .getPublicUrl(fileName);

      newLogoUrl = publicUrlData.publicUrl;
    } else {
      // JSON body — only valid use is `{ "company_logo": null }` to remove
      let body: any = {};
      try {
        body = await req.json();
      } catch {
        return errorResponse("INVALID_INPUT", "Invalid JSON body", 400);
      }

      if (body.company_logo !== null && body.company_logo !== undefined) {
        return errorResponse(
          "INVALID_INPUT",
          "To upload a new logo send multipart/form-data. To remove the logo send { \"company_logo\": null }",
          400
        );
      }
      // company_logo: null → removal only (newLogoUrl stays null)
    }

    // ── 4. Update onboarding table ──────────────────────────────────────────
    const { error: updateError } = await supabase
      .from("onboarding")
      .update({
        company_logo: newLogoUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", organizationId);

    if (updateError) {
      console.error("Failed to update onboarding:", updateError);
      return errorResponse("UPDATE_FAILED", "Failed to update company logo record", 500);
    }

    // ── 5. Only NOW delete the old file ─────────────────────────────────────
    // The replacement (or the deliberate removal) is committed, so the old object is genuinely
    // orphaned. Best-effort: a failure here leaves a stray file, which is harmless, whereas doing
    // this any earlier risked destroying a logo the record still referenced.
    if (existingLogoUrl && existingLogoUrl !== newLogoUrl) {
      try {
        const marker = "/CompanyLogos/";
        const markerIdx = existingLogoUrl.indexOf(marker);
        if (markerIdx !== -1) {
          const decodedPath = decodeURIComponent(existingLogoUrl.substring(markerIdx + marker.length));
          await supabase.storage.from("CompanyLogos").remove([decodedPath]);
        }
      } catch (deleteErr) {
        console.warn("Could not delete old logo from storage (new logo is already saved):", deleteErr);
      }
    }

    return successResponse({
      status: "success",
      message: newLogoUrl ? "Company logo updated successfully" : "Company logo removed successfully",
      company_logo: newLogoUrl,
    });

  } catch (error) {
    console.error("Unexpected error in updateCompanyLogo:", error);
    return errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});
