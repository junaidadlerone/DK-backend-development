import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * Gets the organization ID for the authenticated user
 * Checks if user is owner or member of an organization
 *
 * @param supabase - Supabase client
 * @param userId - User ID from JWT token
 * @returns Organization ID or null if not found
 */
export async function getUserOrganizationId(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  try {
    // Fire owner-check and member-scan in parallel to avoid two sequential round-trips
    const [
      { data: ownerOrg, error: ownerError },
      { data: memberOrgs, error: memberError }
    ] = await Promise.all([
      supabase
        .from("organizations")
        .select("id")
        .eq("owner_id", userId)
        .maybeSingle(),

      supabase
        .from("organizations")
        .select("id, organization_members")
        .not("organization_members", "is", null)
    ]);

    // Prefer owner result (fastest path)
    if (!ownerError && ownerOrg) {
      return ownerOrg.id;
    }

    // Fall back to member scan
    if (memberError || !memberOrgs || memberOrgs.length === 0) {
      return null;
    }

    // Find organization where user is a member
    for (const org of memberOrgs) {
      const members = org.organization_members || [];

      if (Array.isArray(members)) {
        // Check if user is in organization_members array
        // organization_members contains objects with member_uid and member_role
        const isMember = members.some((member: any) =>
          member && typeof member === 'object' && member.member_uid === userId
        );

        if (isMember) {
          return org.id;
        }
      }
    }

    return null;
  } catch (error) {
    console.error("[getUserOrganizationId] Error:", error);
    return null;
  }
}

/**
 * Validates if the user has access to perform actions in the organization
 * Strictly checks for OWNER, ADMIN, or MARKETER roles
 * 
 * @param supabase - Supabase client
 * @param organizationId - ID of the organization
 * @param userId - ID of the user requesting access
 * @returns boolean - True if user has valid access, false otherwise
 */
export async function validateOrganizationAccess(
  supabase: SupabaseClient,
  organizationId: string,
  userId: string
): Promise<boolean> {
  try {
    const { data: org, error } = await supabase
      .from("organizations")
      .select("owner_id, organization_members")
      .eq("id", organizationId)
      .single();

    if (error || !org) {
      return false;
    }

    // Check if user is the owner
    if (org.owner_id === userId) {
      return true;
    }

    // Check if user is an ADMIN or MARKETER in organization_members
    if (org.organization_members && Array.isArray(org.organization_members)) {
      const members = org.organization_members as Array<{member_uid: string, member_role: string}>;
      const member = members.find(m => m.member_uid === userId);
      
      if (member && (member.member_role === "ADMIN" || member.member_role === "MARKETER")) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error("[validateOrganizationAccess] Error:", error);
    return false;
  }
}
