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
    // 1. Check active org pointer on profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("active_organization_id")
      .eq("id", userId)
      .maybeSingle();

    if (profile?.active_organization_id) {
      const hasAccess = await validateOrganizationAccess(
        supabase,
        profile.active_organization_id,
        userId
      );
      if (hasAccess) return profile.active_organization_id;
    }

    // 2. Fallback: find org by ownership or membership
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

    let foundOrgId: string | null = null;

    if (!ownerError && ownerOrg) {
      foundOrgId = ownerOrg.id;
    } else if (!memberError && memberOrgs && memberOrgs.length > 0) {
      for (const org of memberOrgs) {
        const members = org.organization_members || [];
        if (
          Array.isArray(members) &&
          members.some((m: any) => m && typeof m === "object" && m.member_uid === userId)
        ) {
          foundOrgId = org.id;
          break;
        }
      }
    }

    // 3. Persist so next call skips the scan
    if (foundOrgId) {
      await supabase
        .from("profiles")
        .update({ active_organization_id: foundOrgId })
        .eq("id", userId);
    }

    return foundOrgId;
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

/**
 * Returns all organizations accessible to the user (owned + member).
 * Each entry includes the user's role and pending deletion status.
 *
 * @param supabase - Supabase client
 * @param userId - User ID from JWT token
 * @param activeOrgId - Currently active org id (used to mark is_active)
 */
export async function getUserOrganizations(
  supabase: SupabaseClient,
  userId: string,
  activeOrgId?: string | null
): Promise<Array<{
  id: string;
  business_name: string | null;
  business_email: string | null;
  role: "OWNER" | "ADMIN" | "MARKETER" | "TECHNICIAN";
  is_active: boolean;
  deletion_scheduled_at: string | null;
}>> {
  try {
    const { data: orgs, error } = await supabase
      .from("organizations")
      .select("id, business_name, business_email, owner_id, organization_members, deletion_scheduled_at");

    if (error || !orgs) return [];

    const result = [];

    for (const org of orgs) {
      let role: "OWNER" | "ADMIN" | "MARKETER" | "TECHNICIAN" | null = null;

      if (org.owner_id === userId) {
        role = "OWNER";
      } else {
        const members = org.organization_members || [];
        const member = Array.isArray(members)
          ? members.find((m: any) => m?.member_uid === userId)
          : null;
        if (member) {
          role = member.member_role;
        }
      }

      if (!role) continue;

      // Non-owners do not see orgs pending deletion
      if (org.deletion_scheduled_at && role !== "OWNER") continue;

      result.push({
        id: org.id,
        business_name: org.business_name ?? null,
        business_email: org.business_email ?? null,
        role,
        is_active: org.id === activeOrgId,
        deletion_scheduled_at: org.deletion_scheduled_at ?? null,
      });
    }

    return result;
  } catch (error) {
    console.error("[getUserOrganizations] Error:", error);
    return [];
  }
}
