import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient, validatePassword } from "../_shared/client.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import type { ResetPasswordRequest, MessageResponse } from "../_shared/types.ts";

/**
 * Reset Password Edge Function
 * Resets user's password using the access token from the reset link
 *
 * Flow:
 * 1. User clicks reset link from email (contains access_token)
 * 2. Frontend extracts the access_token and sends it with new password
 * 3. This function verifies the token and updates the password
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
    const body = await req.json() as ResetPasswordRequest;
    const { access_token, newPassword } = body;

    // Validate required fields
    if (!access_token || !newPassword) {
      return errorResponse(
        "INVALID_INPUT",
        "Access token and new password are required",
        400
      );
    }

    // Validate new password strength
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      return errorResponse(
        "WEAK_PASSWORD",
        passwordValidation.error || "Password does not meet requirements",
        400
      );
    }

    // Create Supabase client with service role
    const supabase = createSupabaseClient();

    // Verify the access token and get user
    const { data: { user }, error: authError } = await supabase.auth.getUser(access_token);

    if (authError || !user) {
      return errorResponse(
        "INVALID_TOKEN",
        "Invalid or expired reset token",
        401
      );
    }

    // Block the reset if the user's organization is scheduled for deletion.
    // A scheduled org is on its way out (30-day recovery window or already
    // elapsed and pending the cleanup cron), so we don't let its users set a
    // new password.
    const organizationId = await getUserOrganizationId(supabase, user.id);
    if (organizationId) {
      const { data: org } = await supabase
        .from("organizations")
        .select("business_name, deletion_scheduled_at")
        .eq("id", organizationId)
        .maybeSingle();

      if (org?.deletion_scheduled_at) {
        return errorResponse(
          "ORGANIZATION_SCHEDULED_FOR_DELETION",
          `Password reset is not allowed because your organization${
            org.business_name ? ` "${org.business_name}"` : ""
          } is scheduled for deletion (scheduled at ${org.deletion_scheduled_at}). Please contact support if you believe this is a mistake.`,
          403
        );
      }
    }

    // Check if the new password is the same as the current password
    // We do this by attempting to sign in with the new password
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email!,
      password: newPassword,
    });

    // If sign in succeeds, it means the password is the same
    if (!signInError) {
      return errorResponse(
        "SAME_PASSWORD",
        "New password cannot be the same as your current password",
        400
      );
    }

    // Update the user's password
    // We need to use the admin API to update password without requiring the old password
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      user.id,
      { password: newPassword }
    );

    if (updateError) {
      console.error("Password update error:", updateError);
      return errorResponse(
        "PASSWORD_UPDATE_FAILED",
        "Failed to update password. Please try again.",
        500
      );
    }

    // Prepare success response
    const response: MessageResponse = {
      status: "success",
      message: "Password has been reset successfully",
    };

    return successResponse(response, 200);

  } catch (error) {
    console.error("Unexpected error in resetPassword:", error);

    // Don't leak internal error details to the client
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
