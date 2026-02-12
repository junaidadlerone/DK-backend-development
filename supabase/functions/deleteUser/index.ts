import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import {
  createSupabaseClient,
  isAdmin,
} from "../_shared/client.ts";
import { getUserFromRequest, getUserProfile } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Delete User Edge Function
 * Allows ADMIN users to delete ADMIN, MARKETER, and TECHNICIAN users
 *
 * Business Rules:
 * - Only ADMIN users can access this endpoint
 * - Can delete ADMIN, MARKETER, or TECHNICIAN users
 * - Admin cannot delete themselves (safety measure)
 * - User must belong to the same organization as the admin
 * - Deletes user from Supabase Auth (which cascades to profiles table)
 * - Removes user from organization_members array
 * - Requires valid JWT token from an authenticated ADMIN user
 *
 * Request body:
 * {
 *   "userId": "uuid"
 * }
 */

interface DeleteUserRequest {
  userId: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow DELETE or POST requests
  if (req.method !== "DELETE" && req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only DELETE and POST methods are allowed", 405);
  }

  const startTime = Date.now();

  try {
    // Create Supabase client
    const supabase = createSupabaseClient();

    // Get user from request (admin making the request)
    const adminUser = getUserFromRequest(req);
    if (!adminUser) {
      return errorResponse(
        "UNAUTHORIZED",
        "Unable to authenticate user",
        401
      );
    }

    // Check if the authenticated user is an admin
    const isUserAdmin = await isAdmin(adminUser.userId);
    if (!isUserAdmin) {
      return errorResponse(
        "FORBIDDEN",
        "Only ADMIN users can delete users",
        403
      );
    }

    // Get admin's organization
    const adminOrgId = await getUserOrganizationId(supabase, adminUser.userId);
    if (!adminOrgId) {
      return errorResponse(
        "NO_ORGANIZATION",
        "Admin user is not associated with any organization",
        403
      );
    }

    // Parse request body
    let requestBody: DeleteUserRequest;
    try {
      requestBody = await req.json();
    } catch (parseError) {
      return errorResponse(
        "INVALID_INPUT",
        "Invalid JSON in request body",
        400
      );
    }

    // Validate required fields
    const { userId } = requestBody;

    if (!userId || typeof userId !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "userId is required and must be a string",
        400
      );
    }

    // Prevent admin from deleting themselves
    if (userId === adminUser.userId) {
      return errorResponse(
        "INVALID_OPERATION",
        "You cannot delete your own account",
        400
      );
    }

    // Get the user profile to be deleted
    const userProfile = await getUserProfile(supabase, userId);
    if (!userProfile) {
      return errorResponse(
        "USER_NOT_FOUND",
        "User not found",
        404
      );
    }

    // Get the user's organization to verify they belong to the same org as admin
    const userOrgId = await getUserOrganizationId(supabase, userId);
    if (!userOrgId || userOrgId !== adminOrgId) {
      return errorResponse(
        "FORBIDDEN",
        "User does not belong to your organization",
        403
      );
    }

    // Remove user from organization_members array
    const { data: organization, error: orgFetchError } = await supabase
      .from("organizations")
      .select("organization_members")
      .eq("id", adminOrgId)
      .single();

    if (orgFetchError || !organization) {
      console.error("Error fetching organization:", orgFetchError);
      return errorResponse(
        "ORGANIZATION_NOT_FOUND",
        "Organization not found",
        404
      );
    }

    // Filter out the user from organization_members
    const updatedMembers = (organization.organization_members || []).filter(
      (member: any) => member.member_uid !== userId
    );

    // Update organization
    const { error: orgUpdateError } = await supabase
      .from("organizations")
      .update({
        organization_members: updatedMembers,
        updated_at: new Date().toISOString()
      })
      .eq("id", adminOrgId);

    if (orgUpdateError) {
      console.error("Error updating organization:", orgUpdateError);
      return errorResponse(
        "ORGANIZATION_UPDATE_FAILED",
        "Failed to remove user from organization",
        500
      );
    }

    // Delete user from Supabase Auth (this will cascade to profiles table)
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);

    if (deleteError) {
      console.error("Error deleting user from auth:", deleteError);
      return errorResponse(
        "USER_DELETE_FAILED",
        `Failed to delete user: ${deleteError.message}`,
        500
      );
    }

    const processingTimeMs = Date.now() - startTime;

    return successResponse({
      status: "success",
      message: "User deleted successfully",
      deletedUser: {
        id: userId,
        email: userProfile.email,
        fullName: userProfile.full_name,
        role: userProfile.role
      },
      processingTimeMs
    }, 200);

  } catch (error) {
    console.error("Unexpected error in deleteUser:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
