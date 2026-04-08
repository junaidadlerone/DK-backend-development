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
      // Use a simple membership check (any role) — not validateOrganizationAccess
      // which excludes TECHNICIAN and would cause an unnecessary fallback scan.
      const { data: org } = await supabase
        .from("organizations")
        .select("owner_id, organization_members")
        .eq("id", profile.active_organization_id)
        .maybeSingle();

      if (org) {
        const isOwner = org.owner_id === userId;
        const members: any[] = Array.isArray(org.organization_members) ? org.organization_members : [];
        const isMember = members.some((m: any) => m?.member_uid === userId);
        if (isOwner || isMember) return profile.active_organization_id;
      }
    }

    // 2. Fallback: scan all orgs for ownership or membership.
    // Client-side filtering is used because JSONB array @> containment queries
    // on nested objects are unreliable via PostgREST .contains().
    const { data: allOrgs, error: allOrgsError } = await supabase
      .from("organizations")
      .select("id, owner_id, organization_members");

    if (allOrgsError || !allOrgs) return null;

    let foundOrgId: string | null = null;

    for (const org of allOrgs) {
      if (org.owner_id === userId) {
        foundOrgId = org.id;
        break;
      }
      const members: any[] = Array.isArray(org.organization_members) ? org.organization_members : [];
      if (members.some((m: any) => m?.member_uid === userId)) {
        foundOrgId = org.id;
        break;
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
  onboarding_step: number;
}>> {
  try {
    const [{ data: orgs, error }, { data: onboardingRows }] = await Promise.all([
      supabase
        .from("organizations")
        .select("id, business_name, business_email, owner_id, organization_members, deletion_scheduled_at"),
      supabase
        .from("onboarding")
        .select("organization_id, business_name, street_address, company_logo"),
    ]);

    if (error || !orgs) return [];

    // Build a lookup map for onboarding data keyed by org id
    const onboardingMap = new Map<string, any>();
    for (const row of onboardingRows ?? []) {
      onboardingMap.set(row.organization_id, row);
    }

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

      // Compute onboarding step for this org from the onboarding table
      const ob = onboardingMap.get(org.id);
      let onboarding_step = 0;
      if (ob) {
        if (ob.company_logo) onboarding_step = 3;
        else if (ob.street_address) onboarding_step = 2;
        else if (ob.business_name) onboarding_step = 1;
      }

      result.push({
        id: org.id,
        business_name: org.business_name ?? null,
        business_email: org.business_email ?? null,
        role,
        is_active: org.id === activeOrgId,
        deletion_scheduled_at: org.deletion_scheduled_at ?? null,
        onboarding_step,
      });
    }

    return result;
  } catch (error) {
    console.error("[getUserOrganizations] Error:", error);
    return [];
  }
}
