import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { logReferralHistory, getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { createNotification, ROLES } from "../_shared/notifications.ts";

/**
 * Update Referral By ID Edge Function
 * Updates a specific referral by its ID with proper validation
 *
 * Business Rules:
 * - Requires referral ID as URL parameter
 * - Can update any field except ID
 * - Validates nested JSON structures (address, job_details, status)
 * - Status can be passed as string "Draft" or JSON object, OR auto-determined if not provided
 * - Smart status determination: Status auto-set to "Ready" if ALL conditions met:
 *   - All mandatory fields filled (name, address, job_type.id)
 *   - hasOwnerConsent is true
 *   - signature_id is provided (not null)
 * - Status set to "Draft" if any condition not met (when auto-determining)
 * - Updates the updated_at timestamp automatically
 * - Includes image_url field with first image from gallery (empty string if no images)
 */
Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow PATCH/PUT requests
  if (req.method !== "PATCH" && req.method !== "PUT") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only PATCH or PUT methods are allowed", 405);
  }

  try {
    // Parse request body
    let body: any;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      return errorResponse(
        "INVALID_INPUT",
        "Invalid JSON format in request body",
        400
      );
    }

    const { id, ...updateData } = body;

    // Validate required ID
    if (!id) {
      return errorResponse(
        "INVALID_INPUT",
        "Referral ID is required",
        400
      );
    }

    // Validate that there's something to update
    if (Object.keys(updateData).length === 0) {
      return errorResponse(
        "INVALID_INPUT",
        "No update data provided",
        400
      );
    }

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

    // First, fetch the existing referral (must be in user's organization)
    const { data: existingReferral, error: fetchError } = await supabase
      .from("referrals")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .single();

    if (fetchError) {
      if (fetchError.code === "PGRST116") {
        return errorResponse(
          "REFERRAL_NOT_FOUND",
          "Referral not found",
          404
        );
      }
      console.error("Error fetching referral:", fetchError);
      return errorResponse(
        "FETCH_FAILED",
        "Failed to fetch referral",
        500
      );
    }

    // Prepare update object
    const updatedFields: any = {};

    // Handle home_owner_info updates
    if (updateData.name !== undefined || updateData.phone !== undefined ||
        updateData.email !== undefined || updateData.address !== undefined ||
        updateData.street !== undefined || updateData.city !== undefined ||
        updateData.state !== undefined || updateData.zip !== undefined) {

      const currentHomeOwnerInfo = existingReferral.home_owner_info || {
        name: "",
        address: { street: "", city: "", state: { name: "", abbreviation: "" }, zip: "" },
        phone: "",
        email: ""
      };

      updatedFields.home_owner_info = { ...currentHomeOwnerInfo };

      // Update top-level home_owner_info fields
      if (updateData.name !== undefined) {
        updatedFields.home_owner_info.name = updateData.name;
      }
      if (updateData.phone !== undefined) {
        updatedFields.home_owner_info.phone = updateData.phone;
      }
      if (updateData.email !== undefined) {
        updatedFields.home_owner_info.email = updateData.email;
      }

      // Handle address updates
      if (updateData.address !== undefined) {
        // Validate that address is an object
        if (typeof updateData.address !== 'object' || Array.isArray(updateData.address)) {
          return errorResponse(
            "INVALID_INPUT",
            "Address must be a JSON object",
            400
          );
        }
        updatedFields.home_owner_info.address = {
          ...currentHomeOwnerInfo.address,
          ...updateData.address
        };
      } else {
        // Handle individual address fields
        if (updateData.street !== undefined) {
          updatedFields.home_owner_info.address.street = updateData.street;
        }
        if (updateData.city !== undefined) {
          updatedFields.home_owner_info.address.city = updateData.city;
        }
        if (updateData.state !== undefined) {
          // State can be string or object
          if (typeof updateData.state === 'string') {
            // If string, treat as abbreviation
            updatedFields.home_owner_info.address.state = {
              name: "",
              abbreviation: updateData.state
            };
          } else if (typeof updateData.state === 'object') {
            updatedFields.home_owner_info.address.state = updateData.state;
          } else {
            return errorResponse(
              "INVALID_INPUT",
              "State must be a string or JSON object",
              400
            );
          }
        }
        if (updateData.zip !== undefined) {
          updatedFields.home_owner_info.address.zip = updateData.zip;
        }
      }
    }

    // Handle job_details updates
    if (updateData.job_type !== undefined || updateData.value !== undefined ||
        updateData.currency !== undefined || updateData.referral_percentage !== undefined ||
        updateData.notes !== undefined || updateData.job_details !== undefined) {

      const currentJobDetails = existingReferral.job_details || {
        job_type: { id: null, name: "" },
        value: 0,
        currency: "USD",
        referral_percentage: 0,
        notes: ""
      };

      updatedFields.job_details = { ...currentJobDetails };

      if (updateData.job_details !== undefined) {
        // Validate that job_details is an object
        if (typeof updateData.job_details !== 'object' || Array.isArray(updateData.job_details)) {
          return errorResponse(
            "INVALID_INPUT",
            "job_details must be a JSON object",
            400
          );
        }
        updatedFields.job_details = {
          ...currentJobDetails,
          ...updateData.job_details
        };
      } else {
        // Handle individual job_details fields
        if (updateData.job_type !== undefined) {
          // Validate that job_type is an object
          if (typeof updateData.job_type !== 'object' || Array.isArray(updateData.job_type)) {
            return errorResponse(
              "INVALID_INPUT",
              "job_type must be a JSON object with id and name",
              400
            );
          }
          updatedFields.job_details.job_type = updateData.job_type;
        }
        if (updateData.value !== undefined) {
          updatedFields.job_details.value = updateData.value;
        }
        if (updateData.currency !== undefined) {
          updatedFields.job_details.currency = updateData.currency;
        }
        if (updateData.referral_percentage !== undefined) {
          updatedFields.job_details.referral_percentage = updateData.referral_percentage;
        }
        if (updateData.notes !== undefined) {
          updatedFields.job_details.notes = updateData.notes;
        }
      }
    }

    // Handle hasOwnerConsent updates
    if (updateData.hasOwnerConsent !== undefined) {
      updatedFields.hasOwnerConsent = updateData.hasOwnerConsent === true;
    }

    // Handle signature_id updates
    if (updateData.signature_id !== undefined) {
      // If signature_id is provided (not null), verify it exists
      if (updateData.signature_id !== null) {
        const { data: signature, error: signatureError } = await supabase
          .from("signatures")
          .select("id")
          .eq("id", updateData.signature_id)
          .single();

        if (signatureError || !signature) {
          return errorResponse(
            "SIGNATURE_NOT_FOUND",
            "Signature not found",
            404
          );
        }

        // HOT FIX: If signature_id is being set (not null), automatically set hasOwnerConsent to true
        // Only do this if hasOwnerConsent is not explicitly provided in the update
        if (updateData.hasOwnerConsent === undefined) {
          updatedFields.hasOwnerConsent = true;
          console.log('[HOT FIX v2 UPDATE] Auto-setting hasOwnerConsent to true because signature_id is provided');
        }
      }
      updatedFields.signature_id = updateData.signature_id;
    }

    // Smart status determination (only if status is NOT explicitly provided)
    if (updateData.status === undefined) {
      // Get the final values after updates (merge existing with updates)
      const finalHomeOwnerInfo = updatedFields.home_owner_info || existingReferral.home_owner_info || {};
      const finalJobDetails = updatedFields.job_details || existingReferral.job_details || {};
      const finalHasOwnerConsent = updatedFields.hasOwnerConsent !== undefined
        ? updatedFields.hasOwnerConsent
        : (existingReferral.hasOwnerConsent || false);
      const finalSignatureId = updatedFields.signature_id !== undefined
        ? updatedFields.signature_id
        : (existingReferral.signature_id || null);

      // Check if all conditions are met for "Ready" status
      const isReadyForSubmission =
        finalHomeOwnerInfo.name && finalHomeOwnerInfo.name.trim() !== "" &&
        finalHomeOwnerInfo.address?.street && finalHomeOwnerInfo.address.street.trim() !== "" &&
        finalHomeOwnerInfo.address?.city && finalHomeOwnerInfo.address.city.trim() !== "" &&
        finalHomeOwnerInfo.address?.state?.name && finalHomeOwnerInfo.address.state.name.trim() !== "" &&
        finalHomeOwnerInfo.address?.zip && finalHomeOwnerInfo.address.zip.trim() !== "" &&
        finalJobDetails.job_type?.id !== null &&
        finalHasOwnerConsent === true &&
        finalSignatureId !== null;

      // Determine which status to use based on all conditions
      const statusName = isReadyForSubmission ? "Ready" : "Draft";

      // Fetch the status from job_status_types by name (not hardcoded UUID)
      const { data: jobStatus, error: statusError } = await supabase
        .from("job_status_types")
        .select("id, name")
        .eq("name", statusName)
        .single();

      if (statusError || !jobStatus) {
        console.error(`Error fetching ${statusName} status:`, statusError);
        return errorResponse(
          "STATUS_FETCH_FAILED",
          `Failed to fetch ${statusName} status`,
          500
        );
      }

      // Set the auto-determined status
      updatedFields.status = {
        id: jobStatus.id,
        name: jobStatus.name
      };
    }

    // Handle explicit status updates (overrides auto-determination)
    if (updateData.status !== undefined) {
      if (typeof updateData.status === 'string') {
        // If status is a string, fetch the status from job_status_types
        const { data: statusData, error: statusError } = await supabase
          .from("job_status_types")
          .select("id, name")
          .eq("name", updateData.status)
          .single();

        if (statusError || !statusData) {
          return errorResponse(
            "INVALID_STATUS",
            `Invalid status: ${updateData.status}`,
            400
          );
        }

        updatedFields.status = {
          id: statusData.id,
          name: statusData.name
        };
      } else if (typeof updateData.status === 'object' && !Array.isArray(updateData.status)) {
        // If status is an object, use it directly
        updatedFields.status = updateData.status;
      } else {
        return errorResponse(
          "INVALID_INPUT",
          "Status must be a string or JSON object",
          400
        );
      }
    }

    // Add updated_at timestamp
    updatedFields.updated_at = new Date().toISOString();

    // Build change descriptions for history logging
    const changes: string[] = [];
    if (updateData.name !== undefined) {
      changes.push("changed homeowner name");
    }
    if (updateData.phone !== undefined) {
      changes.push("changed homeowner phone");
    }
    if (updateData.email !== undefined) {
      changes.push("changed homeowner email");
    }
    if (updateData.address !== undefined || updateData.street !== undefined ||
        updateData.city !== undefined || updateData.state !== undefined ||
        updateData.zip !== undefined) {
      changes.push("changed homeowner address");
    }
    if (updateData.job_type !== undefined) {
      changes.push("changed job type");
    }
    if (updateData.value !== undefined) {
      changes.push("changed job value");
    }
    if (updateData.referral_percentage !== undefined) {
      changes.push("changed referral percentage");
    }
    if (updateData.notes !== undefined) {
      changes.push("changed job notes");
    }
    if (updateData.hasOwnerConsent !== undefined) {
      changes.push(`changed owner consent to ${updateData.hasOwnerConsent}`);
    }
    if (updateData.signature_id !== undefined) {
      if (updateData.signature_id === null) {
        changes.push("removed signature");
      } else {
        changes.push("added signature");
      }
    }
    if (updateData.status !== undefined) {
      const newStatus = typeof updateData.status === 'string' ? updateData.status : updateData.status.name;
      changes.push(`changed status to ${newStatus}`);
    } else if (updatedFields.status !== undefined) {
      // Auto-determined status change
      changes.push(`auto-updated status to ${updatedFields.status.name}`);
    }
    if (updateData.job_details !== undefined && changes.length === 0) {
      changes.push("updated job details");
    }

    // Update the referral
    const { data: updatedReferral, error: updateError } = await supabase
      .from("referrals")
      .update(updatedFields)
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating referral:", updateError);
      return errorResponse(
        "UPDATE_FAILED",
        "Failed to update referral",
        500
      );
    }

    // Log referral history
    if (changes.length > 0) {
      const action = changes.join(", ");
      await logReferralHistory(
        supabase,
        id,
        user.userId,
        user.userName,
        action
      );
    }

    // Create notification for status change (for all roles)
    if (updateData.status !== undefined) {
      const newStatus = typeof updateData.status === 'string' ? updateData.status : updateData.status.name;
      const referralName = existingReferral.job_details?.name || `Referral ${id.substring(0, 8)}`;

      await createNotification({
        supabase,
        organizationId,
        notificationType: "REFERRAL_STATUS_CHANGED",
        title: "Referral Status Changed",
        description: `Referral "${referralName}" status changed to "${newStatus}"`,
        targetRoles: ROLES.ALL,
        metadata: {
          referral_id: id,
          referral_name: referralName,
          old_status: existingReferral.status?.name || "Unknown",
          new_status: newStatus
        }
      });
    }

    // Fetch gallery for this referral to get image_url
    const { data: gallery } = await supabase
      .from("gallery")
      .select("images")
      .eq("referral_id", id)
      .single();

    // Get first image URL from gallery (if exists)
    let image_url = "";
    if (gallery && gallery.images && Array.isArray(gallery.images) && gallery.images.length > 0) {
      image_url = gallery.images[0].url || "";
    }

    // Return the updated referral with image_url
    return successResponse(
      {
        status: "success",
        message: "Referral updated successfully",
        data: {
          ...updatedReferral,
          image_url
        },
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in updateReferralById:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
