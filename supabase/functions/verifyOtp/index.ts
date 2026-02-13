import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseAnonClient } from "../_shared/client.ts";

/**
 * Verify OTP Edge Function
 * Verifies the one-time password sent to the user's email.
 * If successful, returns the session and user data.
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
    const { email, token, type = 'email' } = await req.json();

    if (!email || !token) {
      return errorResponse("INVALID_INPUT", "Email and token are required", 400);
    }

    const supabase = createSupabaseAnonClient();

    // Verify OTP
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type,
    });

    if (error) {
      console.error("Verify OTP error:", error);
      return errorResponse("OTP_VERIFICATION_FAILED", error.message || "Failed to verify OTP", 401);
    }

    if (!data.session) {
       return errorResponse("OTP_VERIFICATION_FAILED", "Failed to create session", 500);
    }

    return successResponse({
      status: "success",
      message: "OTP verified successfully",
      session: data.session,
      user: data.user,
    }, 200);

  } catch (error) {
    console.error("Unexpected error in verifyOtp:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
