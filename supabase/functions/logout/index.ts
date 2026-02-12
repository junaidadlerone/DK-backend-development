import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import type { MessageResponse } from "../_shared/types.ts";

/**
 * Logout Edge Function
 * Invalidates the user's current session
 *
 * Note:
 * - Requires a valid JWT token in the Authorization header
 * - Signs out the user and invalidates their session
 * - Client should also clear local storage/cookies
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

    if (!token) {
      return errorResponse(
        "INVALID_TOKEN",
        "Invalid authorization token",
        401
      );
    }

    // Create Supabase client with the user's access token
    // This creates a session-aware client that can sign out
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    // Sign out using the user's session
    const { error: signOutError } = await userClient.auth.signOut();

    if (signOutError) {
      console.error("Sign out error:", signOutError);
      return errorResponse(
        "LOGOUT_FAILED",
        "Failed to logout. Please try again.",
        500
      );
    }

    // Prepare success response
    const response: MessageResponse = {
      status: "success",
      message: "Logout successful",
    };

    return successResponse(response, 200);

  } catch (error) {
    console.error("Unexpected error in logout:", error);

    // Don't leak internal error details to the client
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
