import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import {
  createSupabaseClient,
  getUserProfile,
  isAdmin,
} from "../_shared/client.ts";
import { getUserPreferences } from "../_shared/preferences.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";

/**
 * Get User Edge Function
 * Fetches the authenticated user's profile and role information
 *
 * Features:
 * - Returns current user's profile data by default
 * - ADMINs can fetch any user's data by passing user_id query parameter
 * - Requires valid JWT authentication
 * - Enforces role-based access control
 * - Returns enriched timezone information
 */
Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow GET requests
  if (req.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only GET method is allowed", 405);
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

    // Create Supabase client with service role
    const supabase = createSupabaseClient();

    // Verify the token and get authenticated user
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !authUser) {
      return errorResponse(
        "INVALID_TOKEN",
        "Invalid or expired token",
        401
      );
    }

    // Parse query parameters to check if requesting another user's data
    const url = new URL(req.url);
    const requestedUserId = url.searchParams.get("user_id");

    let targetUserId = authUser.id; // Default to authenticated user

    // If requesting another user's profile
    if (requestedUserId && requestedUserId !== authUser.id) {
      // Check if the authenticated user is an admin
      const userIsAdmin = await isAdmin(authUser.id);

      if (!userIsAdmin) {
        return errorResponse(
          "FORBIDDEN",
          "Only ADMIN users can view other users' profiles",
          403
        );
      }

      // ADMIN is allowed to view the requested user
      targetUserId = requestedUserId;
    }

    // Fetch the target user's auth data
    const { data: { user: targetAuthUser }, error: targetAuthError } =
      await supabase.auth.admin.getUserById(targetUserId);

    if (targetAuthError || !targetAuthUser) {
      return errorResponse(
        "USER_NOT_FOUND",
        "User not found",
        404
      );
    }

    // Fetch the target user's profile from profiles table
    const profile = await getUserProfile(targetUserId);

    if (!profile) {
      return errorResponse(
        "PROFILE_NOT_FOUND",
        "User profile not found. Please contact support.",
        404
      );
    }

    // Fetch user preferences for timezone enrichment
    // We use the *authenticated* user's preferences for formatting (the viewer), 
    // unless we want to show the target user's local time?
    // Standard practice for "viewing a user" is usually showing "created_at" in viewer's timezone
    // but here we might be mixing concepts. 
    // Wait, preferences are per-user. If I am Admin viewing User B, I probably want to see User B's creation time in MY timezone (Admin's timezone) OR UTC?
    // Or maybe User B's timezone?
    // The requirement is "reflected in each API response... modified as per user's selected timezone".
    // "User" here usually implies the *requesting* user (the client).
    // So we fetch preferences for `authUser.id` (the viewer).
    const preferences = await getUserPreferences(supabase, authUser.id);

    // Prepare success response with user data
    const response = {
      status: "success",
      data: {
        id: targetAuthUser.id,
        email: targetAuthUser.email!,
        role: profile.role,
        full_name: profile.full_name,
        created_at: targetAuthUser.created_at,
        created_at_tz: enrichTimestamp(targetAuthUser.created_at, preferences.timezone),
        onboarding: profile.onboarding,
      },
    };

    return successResponse(response, 200);

  } catch (error) {
    console.error("Unexpected error in getUser:", error);

    // Don't leak internal error details to the client
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
