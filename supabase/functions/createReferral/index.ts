import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { logReferralHistory, getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Create Referral Edge Function
 * Creates a new referral with status based on mandatory fields
 *
 * Business Rules:
 * - Creates a referral with empty/default values if no data is passed
 * - Status is automatically set to "Ready" if ALL conditions are met:
 *   - home_owner_info.name (non-empty)
 *   - home_owner_info.address.street (non-empty)
 *   - home_owner_info.address.city (non-empty)
 *   - home_owner_info.address.state.name (non-empty)
 *   - home_owner_info.address.zip (non-empty)
 *   - job_details.job_type.id (not null)
 *   - hasOwnerConsent is true
 *   - signature_id is provided (not null)
 * - Status is set to "Draft" if any condition is not met
 * - signature_id is optional - if provided, links the referral to a signature record
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
    // Create Supabase client with service role
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

    // Parse request body (optional - can be empty)
    let body: any = {};
    try {
      const text = await req.text();
      if (text && text.trim()) {
        body = JSON.parse(text);

        // Validate that body is an object (not string, array, etc.)
        if (typeof body !== 'object' || Array.isArray(body)) {
          return errorResponse(
            "INVALID_INPUT",
            "Request body must be a JSON object or empty {}",
            400
          );
        }

        // Validate home_owner_info if provided
        if (body.home_owner_info !== undefined) {
          if (typeof body.home_owner_info !== 'object' || Array.isArray(body.home_owner_info)) {
            return errorResponse(
              "INVALID_INPUT",
              "home_owner_info must be a JSON object",
              400
            );
          }
          // Validate address if provided
          if (body.home_owner_info.address !== undefined) {
            if (typeof body.home_owner_info.address !== 'object' || Array.isArray(body.home_owner_info.address)) {
              return errorResponse(
                "INVALID_INPUT",
                "home_owner_info.address must be a JSON object",
                400
              );
            }
          }
        }

        // Validate job_details if provided
        if (body.job_details !== undefined) {
          if (typeof body.job_details !== 'object' || Array.isArray(body.job_details)) {
            return errorResponse(
              "INVALID_INPUT",
              "job_details must be a JSON object",
              400
            );
          }
          // Validate job_type if provided
          if (body.job_details.job_type !== undefined) {
            if (typeof body.job_details.job_type !== 'object' || Array.isArray(body.job_details.job_type)) {
              return errorResponse(
                "INVALID_INPUT",
                "job_details.job_type must be a JSON object with id and name",
                400
              );
            }
          }
        }

        // Reject if only invalid fields are provided
        const validFields = ['home_owner_info', 'job_details', 'hasOwnerConsent', 'signature_id'];
        const providedFields = Object.keys(body).filter(key => key !== 'id' && key !== 'status');
        const hasInvalidFields = providedFields.some(field => !validFields.includes(field));

        if (hasInvalidFields && providedFields.length > 0) {
          return errorResponse(
            "INVALID_INPUT",
            "Invalid fields in request body. Only home_owner_info, job_details, hasOwnerConsent, and signature_id are accepted. Please pass {} for empty referral or proper body structure.",
            400
          );
        }
      }
    } catch (error) {
      // If parsing fails, return error
      return errorResponse(
        "INVALID_INPUT",
        "Invalid JSON format. Request body must be valid JSON object or empty {}",
        400
      );
    }

    // Prepare default values
    const defaultHomeOwnerInfo = {
      name: "",
      address: {
        street: "",
        city: "",
        state: { name: "", abbreviation: "" },
        zip: ""
      },
      phone: "",
      email: ""
    };

    const defaultJobDetails = {
      job_type: { id: null, name: "" },
      value: 0,
      currency: "USD",
      referral_percentage: 0,
      notes: ""
    };

    // Merge provided data with defaults
    const homeOwnerInfo = body.home_owner_info ? {
      ...defaultHomeOwnerInfo,
      ...body.home_owner_info,
      address: body.home_owner_info.address ? {
        ...defaultHomeOwnerInfo.address,
        ...body.home_owner_info.address,
        state: body.home_owner_info.address.state ? {
          ...defaultHomeOwnerInfo.address.state,
          ...body.home_owner_info.address.state
        } : defaultHomeOwnerInfo.address.state
      } : defaultHomeOwnerInfo.address
    } : defaultHomeOwnerInfo;

    const jobDetails = body.job_details ? {
      ...defaultJobDetails,
      ...body.job_details,
      job_type: body.job_details.job_type ? {
        ...defaultJobDetails.job_type,
        ...body.job_details.job_type
      } : defaultJobDetails.job_type
    } : defaultJobDetails;

    // Extract signature_id from body (optional)
    const signatureId = body.signature_id || null;

    // If signature_id is provided, verify it exists
    if (signatureId) {
      const { data: signature, error: signatureError } = await supabase
        .from("signatures")
        .select("id")
        .eq("id", signatureId)
        .single();

      if (signatureError || !signature) {
        return errorResponse(
          "SIGNATURE_NOT_FOUND",
          "Signature not found",
          404
        );
      }
    }

    // HOT FIX: If signature_id is provided, automatically set hasOwnerConsent to true
    // Otherwise use the value from body (default to false)
    const hasOwnerConsent = signatureId ? true : (body.hasOwnerConsent === true);
    console.log('[HOT FIX v2] signatureId:', signatureId, 'hasOwnerConsent:', hasOwnerConsent);

    // Check if all conditions are met for "Ready" status
    const isReadyForSubmission =
      homeOwnerInfo.name && homeOwnerInfo.name.trim() !== "" &&
      homeOwnerInfo.address.street && homeOwnerInfo.address.street.trim() !== "" &&
      homeOwnerInfo.address.city && homeOwnerInfo.address.city.trim() !== "" &&
      homeOwnerInfo.address.state.name && homeOwnerInfo.address.state.name.trim() !== "" &&
      homeOwnerInfo.address.zip && homeOwnerInfo.address.zip.trim() !== "" &&
      jobDetails.job_type.id !== null &&
      hasOwnerConsent === true &&
      signatureId !== null;

    // Determine which status to use based on all conditions
    const statusName = isReadyForSubmission ? "Ready" : "Draft";

    // Fetch the status from job_status_types
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

    // Prepare referral data
    const referralData: any = {
      organization_id: organizationId,
      home_owner_info: homeOwnerInfo,
      job_details: jobDetails,
      hasOwnerConsent: hasOwnerConsent,
      signature_id: signatureId,
      status: {
        id: jobStatus.id,
        name: jobStatus.name
      }
    };

    // Insert the new referral
    const { data: newReferral, error: insertError } = await supabase
      .from("referrals")
      .insert(referralData)
      .select()
      .single();

    if (insertError) {
      console.error("Error creating referral:", insertError);
      return errorResponse(
        "CREATE_FAILED",
        "Failed to create referral",
        500
      );
    }

    // Log referral history
    await logReferralHistory(
      supabase,
      newReferral.id,
      user.userId,
      user.userName,
      "created this referral"
    );

    // Return the created referral
    return successResponse(
      {
        status: "success",
        message: "Referral created successfully",
        data: newReferral,
      },
      201
    );
  } catch (error) {
    console.error("Unexpected error in createReferral:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
