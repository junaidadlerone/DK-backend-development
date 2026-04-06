import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import {
  createSupabaseClient,
  isValidEmail,
  isValidRole,
  validatePassword,
  type UserRole,
} from "../_shared/client.ts";
import type { SignUpRequest, SignUpResponse } from "../_shared/types.ts";

/**
 * Sign Up Edge Function
 * Creates a new ADMIN user with Supabase Auth
 *
 * Business Rules:
 * - This endpoint is for public ADMIN user registration only
 * - Role is always set to ADMIN (cannot be changed)
 * - MARKETER and TECHNICIAN users must be created by ADMIN via /createUser endpoint
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
    const body = await req.json() as SignUpRequest;
    const { email, password, fullName, role } = body;

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

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return errorResponse(
        "WEAK_PASSWORD",
        passwordValidation.error || "Password does not meet requirements",
        400
      );
    }

    // Role is always ADMIN for signUp endpoint
    // If user provided a role and it's not ADMIN, return error
    if (role && role !== "ADMIN") {
      return errorResponse(
        "INVALID_ROLE",
        "signUp endpoint only creates ADMIN users. Use /createUser endpoint for MARKETER and TECHNICIAN roles.",
        400
      );
    }

    const assignedRole: UserRole = "ADMIN";

    // Create Supabase client with service role
    const supabase = createSupabaseClient();
    console.log("Starting user creation for email:", email);

    // Create the user with Supabase Auth
    const { data: authData, error: signUpError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: {
        full_name: fullName || null,
      },
    });

    if (signUpError) {
      // Handle specific Supabase Auth errors
      if (signUpError.message.includes("already registered")) {
        return errorResponse(
          "EMAIL_EXISTS",
          "An account with this email already exists",
          409
        );
      }

      console.error("Sign up error:", signUpError);
      return errorResponse(
        "SIGNUP_FAILED",
        signUpError.message || "Failed to create user account",
        400
      );
    }

    if (!authData.user) {
      return errorResponse(
        "SIGNUP_FAILED",
        "Failed to create user account",
        500
      );
    }

    console.log("Auth user created successfully, ID:", authData.user.id);

    // Insert profile with role
    console.log("Creating profile...");
    const { error: profileError } = await supabase
      .from("profiles")
      .insert({
        id: authData.user.id,
        role: assignedRole,
        full_name: fullName || null,
        is_super_admin: true,
      });

    if (profileError) {
      // If profile creation fails, delete the auth user to maintain consistency
      await supabase.auth.admin.deleteUser(authData.user.id);

      console.error("Profile creation error:", profileError);
      return errorResponse(
        "PROFILE_CREATION_FAILED",
        "Failed to create user profile",
        500
      );
    }

    console.log("Profile created successfully");

    // Create organization entry for the new ADMIN user
    console.log("Creating organization...");
    const { data: organization, error: orgError } = await supabase
      .from("organizations")
      .insert({
        owner_id: authData.user.id,
        business_email: email,
        organization_members: [],
      })
      .select()
      .single();

    if (orgError || !organization) {
      // If organization creation fails, rollback both profile and auth user
      await supabase.from("profiles").delete().eq("id", authData.user.id);
      await supabase.auth.admin.deleteUser(authData.user.id);

      console.error("Organization creation error:", orgError);
      return errorResponse(
        "ORGANIZATION_CREATION_FAILED",
        "Failed to create organization",
        500
      );
    }

    console.log("Organization created successfully, ID:", organization.id);

    // Set active org on profile so first login resolves instantly
    await supabase
      .from("profiles")
      .update({ active_organization_id: organization.id })
      .eq("id", authData.user.id);

    // Create default app content for the new organization
    console.log("Creating default app content...");
    try {
      const { error: appContentError } = await supabase.rpc(
        'create_default_app_content',
        { org_id: organization.id }
      );

      if (appContentError) {
        console.error("Error creating default app content:", appContentError);
        // Don't fail the signup, just log the error as app content will be created on first access
      }
    } catch (appContentError) {
      console.error("Error creating default app content:", appContentError);
      // Don't fail the signup, just log the error as app content will be created on first access
    }


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

    // Prepare success response
    const response: SignUpResponse = {
      status: "success",
      message: "User created successfully | OTP sent to your email",
      user: {
        id: authData.user.id,
        email: authData.user.email!,
        fullName: fullName || null,
        role: assignedRole,
      },
    };

    return successResponse(response, 201);

  } catch (error) {
    console.error("Unexpected error in signUp:", error);
    console.error("Error details:", JSON.stringify(error, null, 2));

    // Don't leak internal error details to the client
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
