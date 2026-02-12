import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseAnonClient, isValidEmail } from "../_shared/client.ts";
import type { ForgotPasswordRequest, MessageResponse } from "../_shared/types.ts";

/**
 * Forgot Password Edge Function
 * Sends a password reset email to the user
 *
 * Security Notes:
 * - Always returns success to prevent email enumeration
 * - Uses Supabase's built-in password reset flow
 * - Reset link is sent to user's email with a secure token
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
    const body = await req.json() as ForgotPasswordRequest;
    const { email } = body;

    // Validate required fields
    if (!email) {
      return errorResponse(
        "INVALID_INPUT",
        "Email is required",
        400
      );
    }

    // Validate email format
    if (!isValidEmail(email)) {
      return errorResponse(
        "INVALID_EMAIL",
        "Invalid email format",
        400
      );
    }

    // Create Supabase client with anon key
    const supabase = createSupabaseAnonClient();

    // Password reset redirect URL - points to frontend app
    const redirectUrl = "https://doorknocker.texasgrowthfactory.com/reset-password";

    // Send password reset email
    // Note: This will only send email if the user exists, but we don't expose that information
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl,
    });

    // Even if there's an error, we return success to prevent email enumeration
    // Only log the error internally
    if (resetError) {
      console.error("Password reset error:", resetError);
    }

    // Always return success response to prevent email enumeration attacks
    const response: MessageResponse = {
      status: "success",
      message: "If the email exists in our system, a password reset link has been sent",
    };

    return successResponse(response, 200);

  } catch (error) {
    console.error("Unexpected error in forgotPassword:", error);

    // Don't leak internal error details to the client
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
