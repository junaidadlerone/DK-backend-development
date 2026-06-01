import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizations } from "../_shared/organization.ts";

/**
 * getOrganizationV3 — agency team listing with per-member org expansion.
 *
 * Returns every member across all orgs the caller is OWNER or ADMIN of —
 * the caller's agency org(s) PLUS every sub-org they own/admin. This ensures
 * users invited via createUserV3 with `grant_agency_access: false` (who land
 * only in sub-orgs and never in the agency org's organization_members) still
 * show up here. Each member is annotated with the full organization objects
 * they belong to (with `organization_members` stripped, same shape as
 * getUserV3's per-org rows).
 *
 * Gate: caller must be OWNER or ADMIN of at least one `is_agency = TRUE` org
 * (this is what makes them an "agency user" allowed to call V3 endpoints).
 * The member-set scope is wider than the gate.
 */

type Role = "OWNER" | "ADMIN" | "MARKETER" | "TECHNICIAN";

const ROLE_RANK: Record<Role, number> = {
  OWNER: 4,
  ADMIN: 3,
  MARKETER: 2,
  TECHNICIAN: 1,
};

function pickHigherRole(a: Role | null, b: Role | null): Role | null {
  if (!a) return b;
  if (!b) return a;
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only GET method is allowed", 405);
  }

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();
    const caller = getUserFromRequest(req);
    if (!caller) return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);

    // Gate + scope.
    // - agencyOrgIds: kept strictly for the gate (caller must be OWNER/ADMIN
    //   of at least one is_agency=true org) and for the response metadata.
    // - managedOrgIds: every org the caller is OWNER/ADMIN of, agency or sub.
    //   This is the wider scope used to collect members below so that users
    //   created via createUserV3 with grant_agency_access=false (in sub-orgs
    //   only) still appear here.
    const callerOrgs = await getUserOrganizations(supabase, caller.userId);
    const agencyOrgIds = callerOrgs
      .filter((o) => o.isAgencyAccount === true && (o.role === "OWNER" || o.role === "ADMIN"))
      .map((o) => o.id);
    if (agencyOrgIds.length === 0) {
      return errorResponse(
        "NOT_AGENCY_USER",
        "Only agency users (OWNER/ADMIN of an is_agency=true org) can call V3 endpoints",
        403,
      );
    }
    const managedOrgIds = callerOrgs
      .filter((o) => o.role === "OWNER" || o.role === "ADMIN")
      .map((o) => o.id);

    // Load every org the caller manages (agency + sub-orgs) to compute the member set.
    const { data: managedOrgRows, error: managedErr } = await supabase
      .from("organizations")
      .select("id, owner_id, organization_members, business_name, is_agency")
      .in("id", managedOrgIds);
    if (managedErr) {
      console.error("getOrganizationV3: managed orgs fetch error", managedErr);
      return errorResponse("FETCH_FAILED", "Failed to load organizations", 500);
    }

    // memberId -> { highest role across all managed orgs, origin org id }.
    // Prefer the agency org as the origin when the role is a tie (better UX
    // signal — keeps the agency_organization_id field meaningful when the user
    // sits in both the agency and a sub-org with the same role).
    const memberInfo = new Map<string, { role: Role; agencyOrgId: string }>();
    for (const org of managedOrgRows ?? []) {
      const considerCandidate = (uid: string, role: Role) => {
        const prev = memberInfo.get(uid);
        const winner = pickHigherRole(prev?.role ?? null, role);
        const winnerOrgId = winner === prev?.role && prev
          ? (org.is_agency === true ? org.id : prev.agencyOrgId)
          : org.id;
        if (winner !== prev?.role || winnerOrgId !== prev?.agencyOrgId) {
          memberInfo.set(uid, { role: winner!, agencyOrgId: winnerOrgId });
        }
      };
      if (org.owner_id) considerCandidate(org.owner_id, "OWNER");
      const members = Array.isArray(org.organization_members) ? org.organization_members : [];
      for (const m of members) {
        if (!m?.member_uid) continue;
        const role = m.member_role as Role;
        if (role !== "ADMIN" && role !== "MARKETER" && role !== "TECHNICIAN") continue;
        considerCandidate(m.member_uid, role);
      }
    }

    const memberIds = Array.from(memberInfo.keys());
    if (memberIds.length === 0) {
      return successResponse({
        status: "success",
        message: "Found 0 members across 0 managed org(s)",
        data: {
          agency_organization_ids: agencyOrgIds,
          managed_organization_ids: managedOrgIds,
          members: [],
        },
        metadata: { processingTimeMs: Date.now() - startTime },
      }, 200);
    }

    // Batch the rest: all orgs, all relevant profiles, all onboarding rows, all auth users (for email).
    const [
      { data: allOrgs, error: orgsErr },
      { data: profiles, error: profilesErr },
      { data: onboardingRows, error: onbErr },
      { data: authPage, error: authErr },
    ] = await Promise.all([
      supabase.from("organizations").select("*"),
      supabase.from("profiles").select("id, full_name, active_organization_id").in("id", memberIds),
      supabase.from("onboarding").select(
        "organization_id, business_name, street_address, company_logo, team_onboarding_completed",
      ),
      supabase.auth.admin.listUsers(),
    ]);
    if (orgsErr) {
      console.error("getOrganizationV3: orgs fetch error", orgsErr);
      return errorResponse("FETCH_FAILED", "Failed to load organizations", 500);
    }
    if (profilesErr) {
      console.error("getOrganizationV3: profiles fetch error", profilesErr);
      return errorResponse("FETCH_FAILED", "Failed to load profiles", 500);
    }
    if (onbErr) {
      console.error("getOrganizationV3: onboarding fetch error", onbErr);
      return errorResponse("FETCH_FAILED", "Failed to load onboarding rows", 500);
    }
    if (authErr) {
      console.error("getOrganizationV3: auth listUsers error", authErr);
      return errorResponse("FETCH_FAILED", "Failed to load auth users", 500);
    }

    const profileById = new Map<string, any>();
    for (const p of profiles ?? []) profileById.set(p.id, p);

    const emailByUserId = new Map<string, string>();
    for (const u of authPage?.users ?? []) {
      if (u?.email) emailByUserId.set(u.id, u.email);
    }

    const onboardingByOrg = new Map<string, any>();
    for (const row of onboardingRows ?? []) onboardingByOrg.set(row.organization_id, row);

    function onboardingStep(orgId: string): number {
      const ob = onboardingByOrg.get(orgId);
      if (!ob) return 0;
      if (ob.team_onboarding_completed) return 4;
      if (ob.company_logo) return 3;
      if (ob.street_address) return 2;
      if (ob.business_name) return 1;
      return 0;
    }

    // Build per-member organization list.
    const members = memberIds.map((uid) => {
      const info = memberInfo.get(uid)!;
      const profile = profileById.get(uid);
      const activeOrgId = profile?.active_organization_id ?? null;

      const organizations = [];
      for (const org of allOrgs ?? []) {
        let role: Role | null = null;
        if (org.owner_id === uid) {
          role = "OWNER";
        } else {
          const om = Array.isArray(org.organization_members) ? org.organization_members : [];
          const m = om.find((x: any) => x?.member_uid === uid);
          if (m) role = m.member_role as Role;
        }
        if (!role) continue;
        // Non-owners can't see orgs pending deletion.
        if (org.deletion_scheduled_at && role !== "OWNER") continue;

        const { organization_members: _omit, ...orgRest } = org;
        organizations.push({
          ...orgRest,
          role,
          is_active: org.id === activeOrgId,
          onboarding_step: onboardingStep(org.id),
        });
      }

      return {
        id: uid,
        email: emailByUserId.get(uid) ?? null,
        full_name: profile?.full_name ?? null,
        role_in_agency_org: info.role,
        agency_organization_id: info.agencyOrgId,
        organizations,
      };
    });

    return successResponse({
      status: "success",
      message: `Found ${members.length} member(s) across ${managedOrgIds.length} managed org(s) (${agencyOrgIds.length} agency)`,
      data: {
        agency_organization_ids: agencyOrgIds,
        managed_organization_ids: managedOrgIds,
        members,
      },
      metadata: {
        processingTimeMs: Date.now() - startTime,
      },
    }, 200);
  } catch (error: any) {
    console.error("Unexpected error in getOrganizationV3:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error?.message || String(error)}`,
      500,
    );
  }
});
