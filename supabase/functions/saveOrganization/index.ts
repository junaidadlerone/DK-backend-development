import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import {
  createSupabaseClient,
  isValidEmail,
} from "../_shared/client.ts";
import type { SaveOrganizationRequest } from "../_shared/types.ts";

/**
 * Save Organization Edge Function
 * Allows ADMIN users to update their organization information
 *
 * Business Rules:
 * - Only authenticated users can access this endpoint
 * - Users can only update their own organization (where they are the owner)
 * - business_name, business_address, and business_email are mandatory
 * - Other fields are optional
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

    // Get the authorization header
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return errorResponse(
        "UNAUTHORIZED",
        "Authorization header is required",
        401
      );
    }

    // Extract the JWT token
    const token = authHeader.replace("Bearer ", "");

    // Verify the token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return errorResponse(
        "INVALID_TOKEN",
        "Invalid or expired token",
        401
      );
    }

    // Parse request body
    const body = await req.json() as SaveOrganizationRequest;
    const {
      business_name,
      registration_number,
      industry,
      business_address,
      business_email,
      phone_number,
      website_url,
    } = body;

    // Validate required fields
    if (!business_name || !business_address || !business_email) {
      return errorResponse(
        "INVALID_INPUT",
        "business_name, business_address, and business_email are required",
        400
      );
    }

    // Validate business email format
    if (!isValidEmail(business_email)) {
      return errorResponse(
        "INVALID_EMAIL",
        "Invalid business email format",
        400
      );
    }

    // Check if user's organization exists
    const { data: existingOrg, error: fetchError } = await supabase
      .from("organizations")
      .select("id")
      .eq("owner_id", user.id)
      .single();

    if (fetchError || !existingOrg) {
      return errorResponse(
        "ORGANIZATION_NOT_FOUND",
        "Organization not found. Please contact support.",
        404
      );
    }

    // Update the organization
    const { data: updatedOrg, error: updateError } = await supabase
      .from("organizations")
      .update({
        business_name,
        registration_number: registration_number || null,
        industry: industry || null,
        business_address,
        business_email,
        phone_number: phone_number || null,
        website_url: website_url || null,
      })
      .eq("owner_id", user.id)
      .select()
      .single();

    if (updateError) {
      console.error("Organization update error:", updateError);
      return errorResponse(
        "UPDATE_FAILED",
        "Failed to update organization",
        500
      );
    }

    // Return success response
    return successResponse({
      status: "success",
      message: "Organization updated successfully",
      data: updatedOrg,
    }, 200);

  } catch (error) {
    console.error("Unexpected error in saveOrganization:", error);

    // Don't leak internal error details to the client
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
