import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { getPreferences } from "../_shared/preferences.ts";

/**
 * Get Signature By ID Edge Function
 * Retrieves a specific signature record by its ID
 *
 * Business Rules:
 * - Requires signature ID in request body
 * - Organization-based authentication
 * - Returns signature details including proof URL
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

    const { id } = body;

    // Validate ID
    if (!id || typeof id !== "string") {
      return errorResponse(
        "INVALID_INPUT",
        "id is required and must be a string",
        400
      );
    }

    // Fetch signature by ID
    const { data: signature, error: signatureError } = await supabase
      .from("signatures")
      .select("*")
      .eq("id", id)
      .single();

    if (signatureError) {
      if (signatureError.code === "PGRST116") {
        return errorResponse(
          "SIGNATURE_NOT_FOUND",
          "Signature not found",
          404
        );
      }
      console.error("Error fetching signature:", signatureError);
      return errorResponse(
        "SIGNATURE_FETCH_FAILED",
        "Failed to fetch signature",
        500
      );
    }

    // Fetch user preferences
    const preferences = await getPreferences(supabase, user.userId);

    // Return success response
    return successResponse(
      {
        status: "success",
        message: "Signature retrieved successfully",
        data: {
          ...signature,
          created_at_tz: enrichTimestamp(signature.created_at, preferences.timezone),
        }
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in getSignatureById:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
