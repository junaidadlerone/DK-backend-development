import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseAnonClient } from "../_shared/client.ts";

/**
 * Generate OTP Edge Function
 * Sends a one-time password to the user's email address.
 * Use verifyOtp to verify the code and sign the user in.
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
    const { email } = await req.json();

    if (!email) {
      return errorResponse("INVALID_INPUT", "Email is required", 400);
    }

    const supabase = createSupabaseAnonClient();

    // Send OTP to email
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
      }
    });

    if (error) {
      console.error("Generate OTP error:", error);
      return errorResponse("OTP_GENERATION_FAILED", error.message || "Failed to send OTP", 500);
    }

    return successResponse({
      status: "success",
      message: "OTP sent successfully. Please check your email.",
    }, 200);

  } catch (error) {
    console.error("Unexpected error in generateOtp:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
