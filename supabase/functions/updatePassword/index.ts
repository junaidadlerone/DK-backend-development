import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient, validatePassword } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import type { MessageResponse } from "../_shared/types.ts";

/**
 * Update Password Edge Function
 * Allows authenticated users to change their password
 *
 * Business Rules:
 * - User must be authenticated
 * - Old password must be verified before allowing change
 * - New password must meet strength requirements
 * - New password cannot be the same as old password
 * - Updates password in Supabase Auth
 * - Invalidates all existing sessions (signs out from all devices)
 * - Returns new access_token and refresh_token for immediate re-authentication
 *
 * Request body:
 * {
 *   "old_password": "OldPassword123!",
 *   "new_password": "NewPassword456!"
 * }
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

    const { old_password, new_password } = body;

    // Validate required fields
    if (!old_password || !new_password) {
      return errorResponse(
        "INVALID_INPUT",
        "old_password and new_password are required",
        400
      );
    }

    // Validate new password strength
    const passwordValidation = validatePassword(new_password);
    if (!passwordValidation.isValid) {
      return errorResponse(
        "WEAK_PASSWORD",
        passwordValidation.error || "Password does not meet requirements",
        400
      );
    }

    // Verify the old password is the same as new password
    if (old_password === new_password) {
      return errorResponse(
        "SAME_PASSWORD",
        "New password cannot be the same as your current password",
        400
      );
    }

    // Get user's email from auth
    const { data: { user: authUser }, error: authError } =
      await supabase.auth.admin.getUserById(user.userId);

    if (authError || !authUser) {
      console.error("Error fetching auth user:", authError);
      return errorResponse(
        "USER_NOT_FOUND",
        "User not found",
        404
      );
    }

    // Verify the old password by attempting to sign in
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: authUser.email!,
      password: old_password,
    });

    if (signInError) {
      return errorResponse(
        "INVALID_PASSWORD",
        "Old password is incorrect",
        401
      );
    }

    // Update the user's password using admin API
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      user.userId,
      { password: new_password }
    );

    if (updateError) {
      console.error("Password update error:", updateError);
      return errorResponse(
        "PASSWORD_UPDATE_FAILED",
        "Failed to update password. Please try again.",
        500
      );
    }

    // Sign out the user from all sessions (invalidates all existing tokens)
    const { error: signOutError } = await supabase.auth.admin.signOut(user.userId);

    if (signOutError) {
      console.error("Sign out error:", signOutError);
      // Don't fail the request - password was already updated
    }

    // Sign in with new password to get new tokens
    const { data: signInData, error: newSignInError } = await supabase.auth.signInWithPassword({
      email: authUser.email!,
      password: new_password,
    });

    if (newSignInError || !signInData.session) {
      console.error("Error generating new token:", newSignInError);
      return errorResponse(
        "TOKEN_GENERATION_FAILED",
        "Password updated but failed to generate new token. Please login again.",
        500
      );
    }

    // Prepare success response with new tokens
    return successResponse({
      status: "success",
      message: "Password updated successfully",
      access_token: signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
      expires_in: signInData.session.expires_in,
      expires_at: signInData.session.expires_at,
      user: {
        id: signInData.user.id,
        email: signInData.user.email,
      }
    }, 200);

  } catch (error) {
    console.error("Unexpected error in updatePassword:", error);

    // Don't leak internal error details to the client
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
