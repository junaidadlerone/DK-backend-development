import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseAnonClient } from "../_shared/client.ts";

/**
 * Sign Up with Google Edge Function
 * This function initiates the Google OAuth flow.
 * It is used for both Sign Up and Sign In as Supabase handles strict upserts for OAuth users.
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
    const supabase = createSupabaseAnonClient();

    // Initiate Google OAuth sign up
    // Redirect URL is controlled by Supabase project's Site URL setting
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
    });

    if (error) {
      console.error("Google OAuth error:", error);
      return errorResponse("GOOGLE_SIGNUP_FAILED", error.message || "Failed to initiate Google sign up", 500);
    }

    if (!data.url) {
        console.error("No URL returned from signInWithOAuth");
        return errorResponse("GOOGLE_SIGNUP_FAILED", "Failed to generate authorization URL", 500);
    }

    // Return the OAuth URL for the frontend to redirect to
    const response = {
      status: "success",
      message: "Google OAuth URL generated",
      url: data.url,
    };

    return successResponse(response, 200);

  } catch (error) {
    console.error("Unexpected error in signUpWithGoogle:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
