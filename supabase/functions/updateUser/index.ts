import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient, getUserProfile } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserPreferences } from "../_shared/preferences.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";

/**
 * Update User Edge Function
 * Updates the authenticated user's full name
 *
 * Business Rules:
 * - User can only update their own profile
 * - Requires valid JWT authentication
 * - Updates full_name in profiles table
 * - Returns updated user profile with enriched timestamps
 *
 * Request body:
 * {
 *   "full_name": "John Doe"
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

    const { full_name } = body;

    // Validate full_name
    if (!full_name) {
      return errorResponse(
        "INVALID_INPUT",
        "full_name is required",
        400
      );
    }

    if (typeof full_name !== "string" || full_name.trim().length === 0) {
      return errorResponse(
        "INVALID_INPUT",
        "full_name must be a non-empty string",
        400
      );
    }

    // Update the user's profile in profiles table
    const { data: updatedProfile, error: updateError } = await supabase
      .from("profiles")
      .update({
        full_name: full_name.trim(),
        updated_at: new Date().toISOString()
      })
      .eq("id", user.userId)
      .select()
      .single();

    if (updateError || !updatedProfile) {
      console.error("Profile update error:", updateError);
      return errorResponse(
        "UPDATE_FAILED",
        "Failed to update user profile",
        500
      );
    }

    // Fetch user preferences for timezone enrichment
    const preferences = await getUserPreferences(supabase, user.userId);

    // Fetch auth user data for email
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

    // Return success response with updated user data
    return successResponse({
      status: "success",
      message: "User profile updated successfully",
      data: {
        id: updatedProfile.id,
        email: authUser.email!,
        role: updatedProfile.role,
        full_name: updatedProfile.full_name,
        created_at: updatedProfile.created_at,
        updated_at: updatedProfile.updated_at,
        created_at_tz: enrichTimestamp(updatedProfile.created_at, preferences.timezone),
        updated_at_tz: enrichTimestamp(updatedProfile.updated_at, preferences.timezone)
      }
    }, 200);

  } catch (error) {
    console.error("Unexpected error in updateUser:", error);

    // Don't leak internal error details to the client
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
