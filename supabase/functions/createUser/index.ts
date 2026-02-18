import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import {
  createSupabaseClient,
  isAdmin,
  isValidEmail,
  isValidRole,
  type UserRole,
} from "../_shared/client.ts";
import { getUserProfile } from "../_shared/history.ts";
import type { SignUpResponse } from "../_shared/types.ts";
import { createNotification, ROLES } from "../_shared/notifications.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Create User Edge Function
 * Allows ADMIN users to create ADMIN, MARKETER, and TECHNICIAN users
 *
 * Business Rules:
 * - Only ADMIN users can access this endpoint
 * - Can create ADMIN, MARKETER, or TECHNICIAN roles
 * - No password required - user receives invitation email to set their own password
 * - Tracks who created the user via created_by field
 * - Requires valid JWT token from an authenticated ADMIN user
 *
 * Request body:
 * {
 *   "email": "user@example.com",
 *   "fullName": "John Doe",
 *   "role": "ADMIN" | "MARKETER" | "TECHNICIAN"
 * }
 */

interface CreateUserRequest {
  email: string;
  fullName?: string;
  role: UserRole;
}
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

    // Get the authorization header to verify admin
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return errorResponse(
        "UNAUTHORIZED",
        "Authorization header is required. Only ADMIN users can create users.",
        401
      );
    }

    // Extract the JWT token
    const token = authHeader.replace("Bearer ", "");

    // Verify the token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return errorResponse(
        "INVALID_TOKEN",
        "Invalid or expired token",
        401
      );
    }

    // Check if the authenticated user is an admin
    const isUserAdmin = await isAdmin(user.id);

    if (!isUserAdmin) {
      return errorResponse(
        "FORBIDDEN",
        "Only ADMIN users can create new users",
        403
      );
    }

    // Get admin user profile for created_by field
    const adminProfile = await getUserProfile(supabase, user.id);
    if (!adminProfile) {
      return errorResponse(
        "ADMIN_PROFILE_NOT_FOUND",
        "Admin user profile not found",
        404
      );
    }

    // Parse request body
    const body = await req.json() as CreateUserRequest;
    const { email, fullName, role } = body;

    // Validate required fields (password removed)
    if (!email || !role) {
      return errorResponse(
        "INVALID_INPUT",
        "Email and role are required",
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

    // Validate role (now includes ADMIN)
    if (!isValidRole(role)) {
      return errorResponse(
        "INVALID_ROLE",
        "Invalid role. Must be ADMIN, MARKETER, or TECHNICIAN",
        400
      );
    }

    // Create the user with Supabase Auth (invitation flow)
    // The invitation email will be sent automatically with a link to set password
    const { data: authData, error: createError } = await supabase.auth.admin.inviteUserByEmail(
      email,
      {
        data: {
          full_name: fullName || null,
        },
        redirectTo: "https://doorknocker.texasgrowthfactory.com/reset-password",
      }
    );

    if (createError) {
      // Handle specific Supabase Auth errors
      if (createError.message.includes("already registered") || createError.message.includes("already been registered")) {
        return errorResponse(
          "EMAIL_EXISTS",
          "An account with this email already exists",
          409
        );
      }

      console.error("User invitation error:", createError);
      return errorResponse(
        "USER_INVITATION_FAILED",
        createError.message || "Failed to send user invitation",
        400
      );
    }

    if (!authData.user) {
      return errorResponse(
        "USER_INVITATION_FAILED",
        "Failed to send user invitation",
        500
      );
    }

    // Insert profile with role and created_by
    const { error: profileError } = await supabase
      .from("profiles")
      .insert({
        id: authData.user.id,
        role: role,
        full_name: fullName || null,
        created_by: adminProfile,
        onboarding: true,
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

    // Get the admin's organization
    const { data: adminOrg, error: orgFetchError } = await supabase
      .from("organizations")
      .select("organization_members")
      .eq("owner_id", user.id)
      .single();

    if (orgFetchError || !adminOrg) {
      // If admin's organization not found, rollback user creation
      await supabase.from("profiles").delete().eq("id", authData.user.id);
      await supabase.auth.admin.deleteUser(authData.user.id);

      console.error("Admin organization not found:", orgFetchError);
      return errorResponse(
        "ORGANIZATION_NOT_FOUND",
        "Admin's organization not found. Please contact support.",
        500
      );
    }

    // Add the new user to organization_members
    const currentMembers = adminOrg.organization_members || [];
    const newMember = {
      member_uid: authData.user.id,
      member_role: role,
    };
    const updatedMembers = [...currentMembers, newMember];

    // Update the organization with the new member
    const { error: orgUpdateError } = await supabase
      .from("organizations")
      .update({ organization_members: updatedMembers })
      .eq("owner_id", user.id);

    if (orgUpdateError) {
      // If organization update fails, rollback user creation
      await supabase.from("profiles").delete().eq("id", authData.user.id);
      await supabase.auth.admin.deleteUser(authData.user.id);

      console.error("Organization update error:", orgUpdateError);
      return errorResponse(
        "ORGANIZATION_UPDATE_FAILED",
        "Failed to add user to organization",
        500
      );
    }

    // Get organization ID for notification
    const organizationId = await getUserOrganizationId(supabase, user.id);

    // Create notification for all roles
    if (organizationId) {
      await createNotification({
        supabase,
        organizationId,
        notificationType: "NEW_USER_ADDED",
        title: "New User Added",
        description: `New ${role} user "${fullName || authData.user.email}" has been added to your organization`,
        targetRoles: ROLES.ALL,
        metadata: {
          user_id: authData.user.id,
          user_email: authData.user.email,
          user_name: fullName || null,
          user_role: role,
          created_by: adminProfile
        }
      });
    }

    // Prepare success response
    const response: SignUpResponse = {
      status: "success",
      message: `User invitation sent successfully. ${authData.user.email} will receive an email to set their password.`,
      user: {
        id: authData.user.id,
        email: authData.user.email!,
        fullName: fullName || null,
        role: role,
      },
    };

    return successResponse(response, 201);

  } catch (error) {
    console.error("Unexpected error in createUser:", error);

    // Don't leak internal error details to the client
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
