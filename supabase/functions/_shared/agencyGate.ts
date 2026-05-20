// Shared agency-gate helper used by V3 user-management endpoints
// (createUserV3, getUserV3, revokeUserAccessV3, deleteUserV3).
//
// The V3 surface is for agency users only. A caller passes the gate if and
// only if they have OWNER or ADMIN role on at least one organization where
// `is_agency = TRUE`. The signal mirrors what `getUserOrganizations()`
// returns as `isAgencyAccount` — we just query the table directly here to
// keep this helper lightweight.

import { getUserOrganizations } from "./organization.ts";

export async function isAgencyUser(supabase: any, userId: string): Promise<boolean> {
  const orgs = await getUserOrganizations(supabase, userId);
  return orgs.some((o) => o.isAgencyAccount === true && (o.role === "OWNER" || o.role === "ADMIN"));
}

// Resolve the caller's role on a specific organization given a fully-loaded org row.
// Returns "OWNER" | "ADMIN" | "MARKETER" | "TECHNICIAN" | null.
export function callerRoleOnOrg(
  org: { owner_id: string; organization_members?: any[] | null },
  userId: string,
): "OWNER" | "ADMIN" | "MARKETER" | "TECHNICIAN" | null {
  if (org.owner_id === userId) return "OWNER";
  const members = Array.isArray(org.organization_members) ? org.organization_members : [];
  const match = members.find((m: any) => m?.member_uid === userId);
  if (!match) return null;
  const role = match.member_role;
  if (role === "ADMIN" || role === "MARKETER" || role === "TECHNICIAN") return role;
  return null;
}
