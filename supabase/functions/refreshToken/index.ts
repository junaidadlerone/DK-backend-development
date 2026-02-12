import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import type { RefreshTokenRequest, RefreshTokenResponse } from "../_shared/types.ts";

/**
 * Refresh Token Edge Function
 * Exchanges a refresh token for a new access token
 *
 * Business Rules:
 * - No authentication required (uses refresh token instead)
 * - Refresh tokens have longer lifetime than access tokens
 * - Returns new access token and refresh token pair
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
    // Parse request body
    const body = await req.json() as RefreshTokenRequest;
    const { refreshToken } = body;

    // Validate required fields
    if (!refreshToken) {
      return errorResponse(
        "INVALID_INPUT",
        "Refresh token is required",
        400
      );
    }

    // Create Supabase client with service role
    const supabase = createSupabaseClient();

    // Refresh the session using the refresh token
    const { data: authData, error: refreshError } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (refreshError || !authData.session) {
      console.error("Token refresh error:", refreshError);
      return errorResponse(
        "INVALID_TOKEN",
        "Invalid or expired refresh token",
        401
      );
    }

    // Prepare success response
    const response: RefreshTokenResponse = {
      status: "success",
      message: "Token refreshed successfully",
      token: authData.session.access_token,
      refreshToken: authData.session.refresh_token,
      expiresIn: authData.session.expires_in || 3600,
    };

    return successResponse(response, 200);

  } catch (error) {
    console.error("Unexpected error in refreshToken:", error);

    // Don't leak internal error details to the client
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
