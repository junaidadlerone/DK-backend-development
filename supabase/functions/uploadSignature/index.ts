import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Upload Signature Edge Function
 * Uploads a signature (base64) and proof document for a referral
 *
 * Business Rules:
 * - Requires signature (base64 text) in request body
 * - Requires proof file upload (image or PDF)
 * - referral_id is optional - can create standalone signatures
 * - Uploads proof to Supabase Storage in 'signatures' bucket
 * - Supported proof formats: PDF, JPEG, PNG, WebP, HEIC, HEIF
 * - Maximum file size: 10MB
 * - Creates entry in signatures table with signature text, proof_id, proof_url, and optional referral_id
 */
Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow POST requests
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed", 405);
  }

  try {
    // Create Supabase client
    const supabase = createSupabaseClient();

    // Get user from request
    const user = getUserFromRequest(req);
    if (!user) {
      return errorResponse(
        "UNAUTHORIZED",
        "Unable to authenticate user",
        401
      );
    }

    // Get user's organization
    const organizationId = await getUserOrganizationId(supabase, user.userId);
    if (!organizationId) {
      return errorResponse(
        "NO_ORGANIZATION",
        "User is not associated with any organization",
        403
      );
    }

    // Parse multipart form data
    const formData = await req.formData();
    const signature = formData.get("signature");
    const proofFile = formData.get("proof");
    const referralId = formData.get("referral_id");

    // At least one of signature or proof must be provided
    const hasSignature = signature && typeof signature === "string" && signature.trim() !== "";
    const hasProof = proofFile && proofFile instanceof File;

    if (!hasSignature && !hasProof) {
      return errorResponse(
        "INVALID_INPUT",
        "At least one of signature or proof must be provided",
        400
      );
    }

    // Validate signature if provided
    if (signature && typeof signature !== "string") {
      return errorResponse(
        "INVALID_INPUT",
        "signature must be a string",
        400
      );
    }

    // Validate proof file if provided
    if (proofFile && !(proofFile instanceof File)) {
      return errorResponse(
        "INVALID_INPUT",
        "proof must be a valid file",
        400
      );
    }

    // Validate referral_id if provided
    if (referralId && typeof referralId !== "string") {
      return errorResponse(
        "INVALID_INPUT",
        "referral_id must be a string",
        400
      );
    }

    // Validate file type and size if proof is provided
    if (hasProof) {
      const allowedTypes = [
        "application/pdf",
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
        "image/heic",
        "image/heif"
      ];

      if (!allowedTypes.includes(proofFile.type)) {
        return errorResponse(
          "INVALID_INPUT",
          `File "${proofFile.name}" has invalid type. Only PDF, JPEG, PNG, WebP, HEIC, HEIF are allowed`,
          400
        );
      }

      // Validate file size (10MB max)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (proofFile.size > maxSize) {
        return errorResponse(
          "INVALID_INPUT",
          `File "${proofFile.name}" exceeds 10MB size limit`,
          400
        );
      }
    }

    // If referral_id is provided, verify it exists in user's organization
    if (referralId) {
      const { data: referral, error: referralError } = await supabase
        .from("referrals")
        .select("id")
        .eq("id", referralId)
        .eq("organization_id", organizationId)
        .single();

      if (referralError || !referral) {
        return errorResponse(
          "REFERRAL_NOT_FOUND",
          "Referral not found in your organization",
          404
        );
      }
    }

    // Initialize proof variables
    let proofId = null;
    let proofUrl = null;
    let filePath = null;

    // Upload proof to Supabase Storage only if proof is provided
    if (hasProof) {
      proofId = crypto.randomUUID();
      const fileExtension = proofFile.name.split(".").pop() || "pdf";
      const fileName = `${proofId}.${fileExtension}`;
      filePath = `proofs/${fileName}`;

      const { data: uploadData, error: uploadError } = await supabase
        .storage
        .from("signatures")
        .upload(filePath, proofFile, {
          contentType: proofFile.type,
          upsert: false
        });

      if (uploadError) {
        console.error("Error uploading proof:", uploadError);
        return errorResponse(
          "UPLOAD_FAILED",
          `Failed to upload proof: ${uploadError.message}`,
          500
        );
      }

      // Get public URL for the uploaded proof
      const { data: urlData } = supabase
        .storage
        .from("signatures")
        .getPublicUrl(filePath);

      proofUrl = urlData.publicUrl;
    }

    // Create signature entry in database
    const { data: signatureRecord, error: createError } = await supabase
      .from("signatures")
      .insert({
        signature: hasSignature ? signature.trim() : null,
        proof_id: proofId,
        proof_url: proofUrl,
        referral_id: referralId || null
      })
      .select()
      .single();

    if (createError) {
      console.error("Error creating signature record:", createError);
      // Try to delete uploaded file since we couldn't create the record (only if file was uploaded)
      if (filePath) {
        await supabase.storage.from("signatures").remove([filePath]);
      }
      return errorResponse(
        "CREATE_FAILED",
        "Failed to create signature record",
        500
      );
    }

    // Return success response
    return successResponse(
      {
        status: "success",
        message: "Signature uploaded successfully",
        data: signatureRecord
      },
      201
    );
  } catch (error) {
    console.error("Unexpected error in uploadSignature:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
