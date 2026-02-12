import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { logReferralHistory, getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Upload Image Edge Function
 * Uploads single or multiple images to a gallery (optionally linked to a referral)
 *
 * Business Rules:
 * - referral_id is optional in request body
 * - If referral_id is provided: validates referral and links images to referral's gallery
 * - If referral_id is NOT provided: creates a standalone gallery for the organization
 * - If no gallery exists, creates one
 * - Uploads images to Supabase Storage in folder: gallery/{gallery_id}
 * - Default image type is "none"
 * - Supports multipart/form-data with 'images' or 'image' field(s) and optional 'referral_id' field
 * - Maximum file size per image: 4MB
 * - Supported formats: JPEG, PNG, WebP, HEIC, HEIF
 * - Can upload multiple images in a single request
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
    const referralId = formData.get("referral_id");

    // Validate referral_id if provided
    if (referralId && typeof referralId !== "string") {
      return errorResponse(
        "INVALID_INPUT",
        "referral_id must be a string",
        400
      );
    }

    // Collect all image files from form data
    // Support both 'images' (multiple) and 'image' (single) field names
    const imageFiles: File[] = [];

    // Get all values with key 'images' or 'image'
    for (const [key, value] of formData.entries()) {
      if ((key === "images" || key === "image") && value instanceof File) {
        imageFiles.push(value);
      }
    }

    // Validate at least one image file
    if (imageFiles.length === 0) {
      return errorResponse(
        "INVALID_INPUT",
        "At least one image file is required",
        400
      );
    }

    // Validate file types and sizes
    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif"
    ];
    const maxSize = 4 * 1024 * 1024; // 4MB

    for (const imageFile of imageFiles) {
      // Validate file type
      if (!allowedTypes.includes(imageFile.type)) {
        return errorResponse(
          "INVALID_INPUT",
          `File "${imageFile.name}" has invalid type. Only JPEG, PNG, WebP, HEIC, HEIF are allowed`,
          400
        );
      }

      // Validate file size
      if (imageFile.size > maxSize) {
        return errorResponse(
          "INVALID_INPUT",
          `File "${imageFile.name}" exceeds 4MB size limit`,
          400
        );
      }
    }

    // Only check referral if referral_id is provided
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
          "Referral not found",
          404
        );
      }
    }

    // Check if gallery exists (for referral or organization-level)
    let gallery = null;
    let galleryError = null;

    if (referralId) {
      // Look for referral-level gallery
      const result = await supabase
        .from("gallery")
        .select("*")
        .eq("referral_id", referralId)
        .single();

      gallery = result.data;
      galleryError = result.error;
    } else {
      // Look for organization-level gallery
      const result = await supabase
        .from("gallery")
        .select("*")
        .eq("organization_id", organizationId)
        .is("referral_id", null)
        .single();

      gallery = result.data;
      galleryError = result.error;
    }

    // If no gallery exists, create one
    if (galleryError?.code === "PGRST116" || !gallery) {
      const galleryData = referralId
        ? { referral_id: referralId, organization_id: null, images: [] }
        : { organization_id: organizationId, referral_id: null, images: [] };

      const { data: newGallery, error: createError } = await supabase
        .from("gallery")
        .insert(galleryData)
        .select()
        .single();

      if (createError) {
        console.error("Error creating gallery:", createError);
        return errorResponse(
          "GALLERY_CREATE_FAILED",
          `Failed to create gallery: ${createError.message}`,
          500
        );
      }

      gallery = newGallery;
    } else if (galleryError) {
      console.error("Error fetching gallery:", galleryError);
      return errorResponse(
        "GALLERY_FETCH_FAILED",
        `Failed to fetch gallery: ${galleryError.message}`,
        500
      );
    }

    // Upload all images and collect results
    const uploadedImages = [];
    const failedUploads = [];
    const uploadedFilePaths = [];

    for (const imageFile of imageFiles) {
      try {
        // Generate unique image ID and filename
        const imageId = crypto.randomUUID();
        const fileExtension = imageFile.name.split(".").pop() || "jpg";
        const fileName = `${imageId}.${fileExtension}`;
        const filePath = `gallery/${gallery.id}/${fileName}`;

        // Upload image to Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase
          .storage
          .from("images")
          .upload(filePath, imageFile, {
            contentType: imageFile.type,
            upsert: false
          });

        if (uploadError) {
          console.error(`Error uploading ${imageFile.name}:`, uploadError);
          failedUploads.push({
            filename: imageFile.name,
            error: uploadError.message
          });
          continue;
        }

        // Get public URL for the uploaded image
        const { data: urlData } = supabase
          .storage
          .from("images")
          .getPublicUrl(filePath);

        // Add to uploaded images
        const newImage = {
          id: imageId,
          url: urlData.publicUrl,
          type: "none"
        };

        uploadedImages.push(newImage);
        uploadedFilePaths.push(filePath);
      } catch (error) {
        console.error(`Unexpected error uploading ${imageFile.name}:`, error);
        failedUploads.push({
          filename: imageFile.name,
          error: "Unexpected error during upload"
        });
      }
    }

    // If all uploads failed, return error
    if (uploadedImages.length === 0) {
      return errorResponse(
        "UPLOAD_FAILED",
        "All image uploads failed",
        500
      );
    }

    // Add uploaded images to gallery's images array
    const currentImages = gallery.images || [];
    const updatedImages = [...currentImages, ...uploadedImages];

    // Update gallery with new images
    const { data: updatedGallery, error: updateError } = await supabase
      .from("gallery")
      .update({
        images: updatedImages,
        updated_at: new Date().toISOString()
      })
      .eq("id", gallery.id)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating gallery:", updateError);
      // Try to delete all uploaded images since we couldn't update the gallery
      await supabase.storage.from("images").remove(uploadedFilePaths);
      return errorResponse(
        "GALLERY_UPDATE_FAILED",
        "Failed to update gallery",
        500
      );
    }

    // Build response message
    let message = `${uploadedImages.length} image(s) uploaded successfully`;
    if (failedUploads.length > 0) {
      message += `, ${failedUploads.length} failed`;
    }

    // Log referral history only if referral_id was provided
    if (uploadedImages.length > 0 && referralId) {
      const photoText = uploadedImages.length === 1 ? "photo" : "photos";
      await logReferralHistory(
        supabase,
        referralId,
        user.userId,
        user.userName,
        `uploaded ${uploadedImages.length} ${photoText} to this referral`
      );
    }

    // Return success response
    return successResponse(
      {
        status: "success",
        message: message,
        data: {
          gallery: updatedGallery,
          uploaded_images: uploadedImages,
          failed_uploads: failedUploads.length > 0 ? failedUploads : undefined,
          summary: {
            total_attempted: imageFiles.length,
            successful: uploadedImages.length,
            failed: failedUploads.length
          }
        }
      },
      201
    );
  } catch (error) {
    console.error("Unexpected error in uploadImage:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
