import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import {
  createSupabaseAnonClient,
  getUserProfile,
  isValidEmail,
} from "../_shared/client.ts";
import type { LoginRequest, LoginResponse } from "../_shared/types.ts";

/**
 * Login Edge Function
 * Authenticates a user with email and password using Supabase Auth
 *
 * Returns:
 * - JWT access token
 * - User information including role
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
    const body = await req.json() as LoginRequest;
    const { email, password } = body;

    // Validate required fields
    if (!email || !password) {
      return errorResponse(
        "INVALID_INPUT",
        "Email and password are required",
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

    // Create Supabase client with anon key for user authentication
    const supabase = createSupabaseAnonClient();

    // Attempt to sign in
    const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !authData.user || !authData.session) {
      // Generic error message to prevent user enumeration
      return errorResponse(
        "INVALID_CREDENTIALS",
        "Invalid email or password",
        401
      );
    }

    // Check if email is verified
    if (!authData.user.email_confirmed_at) {
      return errorResponse(
        "EMAIL_NOT_VERIFIED",
        "Please verify your email address to login",
        403
      );
    }

    // Get user's profile to retrieve role
    const profile = await getUserProfile(authData.user.id);

    if (!profile) {
      return errorResponse(
        "PROFILE_NOT_FOUND",
        "User profile not found. Please contact support.",
        404
      );
    }

    // Prepare success response
    const response: LoginResponse = {
      status: "success",
      message: "Login successful",
      token: authData.session.access_token,
      refreshToken: authData.session.refresh_token,
      expiresIn: authData.session.expires_in || 3600, // Default to 1 hour if not provided
      role: profile.role,
      onboarding: profile.onboarding || false,
      user: {
        id: authData.user.id,
        email: authData.user.email!,
        fullName: profile.full_name,
        is_verified: !!authData.user.email_confirmed_at,
      },
    };

    return successResponse(response, 200);

  } catch (error) {
    console.error("Unexpected error in login:", error);

    // Don't leak internal error details to the client
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
