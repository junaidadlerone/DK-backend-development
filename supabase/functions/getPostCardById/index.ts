import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Get PostCard By ID Edge Function
 * Retrieves a postcard from PostGrid API by its ID
 *
 * Business Rules:
 * - Requires PostGrid API key and postcard ID in request body
 * - Returns complete postcard details from PostGrid
 * - Organization-scoped (user must be in organization)
 * - All PostGrid response data is passed through
 *
 * Request body:
 * {
 *   "postgridApiKey": string (required),
 *   "postcardId": string (required)
 * }
 */

interface RequestBody {
  postgridApiKey: string;
  postcardId: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow POST requests
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed", 405);
  }

  const startTime = Date.now();

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
    let requestBody: RequestBody;
    try {
      requestBody = await req.json();
    } catch (parseError) {
      return errorResponse(
        "INVALID_INPUT",
        "Invalid JSON in request body",
        400
      );
    }

    // Validate required fields
    const { postgridApiKey, postcardId } = requestBody;

    if (!postgridApiKey || typeof postgridApiKey !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "postgridApiKey is required and must be a string",
        400
      );
    }

    if (!postcardId || typeof postcardId !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "postcardId is required and must be a string",
        400
      );
    }

    // Call PostGrid API to get postcard
    let postgridResponse: Response;
    try {
      postgridResponse = await fetch(
        `https://api.postgrid.com/print-mail/v1/postcards/${postcardId}`,
        {
          method: 'GET',
          headers: {
            'x-api-key': postgridApiKey
          }
        }
      );
    } catch (fetchError) {
      console.error("Error calling PostGrid API:", fetchError);
      return errorResponse(
        "POSTGRID_API_ERROR",
        "Failed to connect to PostGrid API",
        500
      );
    }

    if (!postgridResponse.ok) {
      const errorText = await postgridResponse.text();
      console.error("PostGrid API error:", errorText);
      return errorResponse(
        "POSTGRID_API_ERROR",
        `PostGrid API returned error: ${postgridResponse.status} - ${errorText}`,
        postgridResponse.status
      );
    }

    let postcardData: any;
    try {
      postcardData = await postgridResponse.json();
    } catch (jsonError) {
      console.error("Error parsing PostGrid response:", jsonError);
      return errorResponse(
        "POSTGRID_RESPONSE_ERROR",
        "Failed to parse PostGrid API response",
        500
      );
    }

    const processingTimeMs = Date.now() - startTime;

    // Build response
    const response = {
      status: "success",
      message: "Postcard retrieved successfully",
      postcard: postcardData,
      processingTimeMs
    };

    return successResponse(response, 200);

  } catch (error) {
    console.error("Unexpected error in getPostCardById:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
