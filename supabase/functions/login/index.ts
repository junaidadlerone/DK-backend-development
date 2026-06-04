import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import {
  createSupabaseAnonClient,
  createSupabaseClient,
  getUserProfile,
  isValidEmail,
} from "../_shared/client.ts";
import { getUserOrganizationId, getUserOrganizations } from "../_shared/organization.ts";
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

    if (signInError) {
      if (signInError.message.includes("Email not confirmed")) {
        return errorResponse(
          "EMAIL_NOT_VERIFIED",
          "Please verify your email address to login",
          403
        );
      }
      return errorResponse(
        "INVALID_CREDENTIALS",
        "Invalid email or password",
        401
      );
    }

    if (!authData.user || !authData.session) {
      return errorResponse(
        "INVALID_CREDENTIALS",
        "Invalid email or password",
        401
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

    const supabaseService = createSupabaseClient();

    // Block login if the user's organization is scheduled for deletion.
    // Only the org owner may still log in during the deletion window (e.g. to
    // recover the organization); all other members are locked out.
    const organizationId = await getUserOrganizationId(
      supabaseService,
      authData.user.id
    );
    if (organizationId) {
      const { data: org } = await supabaseService
        .from("organizations")
        .select("business_name, owner_id, deletion_scheduled_at")
        .eq("id", organizationId)
        .maybeSingle();

      if (org?.deletion_scheduled_at && org.owner_id !== authData.user.id) {
        return errorResponse(
          "ORGANIZATION_SCHEDULED_FOR_DELETION",
          `Login is not allowed because your organization${
            org.business_name ? ` "${org.business_name}"` : ""
          } is scheduled for deletion (scheduled at ${org.deletion_scheduled_at}). Only the organization owner can log in during this period. Please contact your organization owner or support if you believe this is a mistake.`,
          403
        );
      }
    }

    // Fetch all orgs the user can access for the org dropdown
    const organizations = await getUserOrganizations(
      supabaseService,
      authData.user.id,
      profile.active_organization_id
    );

    // Prepare success response
    const response: LoginResponse = {
      status: "success",
      message: "Login successful",
      token: authData.session.access_token,
      refreshToken: authData.session.refresh_token,
      expiresIn: authData.session.expires_in || 3600, // Default to 1 hour if not provided
      role: profile.role,
      onboarding: profile.onboarding || false,
      is_super_admin: profile.is_super_admin || false,
      multi_org_enabled: profile.multi_org_enabled || false,
      active_organization_id: profile.active_organization_id || null,
      organizations,
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
