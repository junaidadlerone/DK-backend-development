import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { deriveOnboardingStepCount, getUserOrganizations } from "../_shared/organization.ts";

/**
 * getOrganizationV3 — agency team listing with per-member org expansion.
 *
 * Returns every member of the caller's agency org(s), each annotated with the
 * full organization objects the member belongs to (with `organization_members`
 * stripped, same shape as getUserV3's per-org rows).
 *
 * Gate: caller must be OWNER or ADMIN of at least one `is_agency = TRUE` org.
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

    // Gate
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

    // Load the agency org rows to compute the member set.
    const { data: agencyOrgRows, error: agencyErr } = await supabase
      .from("organizations")
      .select("id, owner_id, organization_members, business_name")
      .in("id", agencyOrgIds);
    if (agencyErr) {
      console.error("getOrganizationV3: agency orgs fetch error", agencyErr);
      return errorResponse("FETCH_FAILED", "Failed to load agency organizations", 500);
    }

    // memberId -> { role in highest agency org, agencyOrgId that produced it }
    const memberInfo = new Map<string, { role: Role; agencyOrgId: string }>();
    for (const org of agencyOrgRows ?? []) {
      const considerCandidate = (uid: string, role: Role) => {
        const prev = memberInfo.get(uid);
        const winner = pickHigherRole(prev?.role ?? null, role);
        if (winner !== prev?.role) {
          memberInfo.set(uid, { role: winner!, agencyOrgId: org.id });
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
        message: "Found 0 members across 0 agency org(s)",
        data: { agency_organization_ids: agencyOrgIds, members: [] },
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
        "organization_id, business_name, street_address, company_logo, team_onboarding_completed, team_members_invited",
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

    // Uses the shared helper + per-org cap (3 for agency, 4 for business) so
    // this endpoint stays aligned with getUser / getUserV3 / getOnboardingStepV3.
    function onboardingStep(org: any): number {
      const finalStep = org.is_agency === true ? 3 : 4;
      return Math.min(deriveOnboardingStepCount(onboardingByOrg.get(org.id)), finalStep);
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
          onboarding_step: onboardingStep(org),
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
      message: `Found ${members.length} member(s) across ${agencyOrgIds.length} agency org(s)`,
      data: {
        agency_organization_ids: agencyOrgIds,
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
