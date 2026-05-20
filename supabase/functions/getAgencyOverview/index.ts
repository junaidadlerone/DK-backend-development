import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizations } from "../_shared/organization.ts";
import { isAgencyUser } from "../_shared/agencyGate.ts";

/**
 * getAgencyOverview — single-shot agency-dashboard rollup.
 *
 * For agency callers (gated by isAgencyUser), returns every org the caller
 * is OWNER or ADMIN of, with the full org row + that org's active campaigns +
 * lifetime QR scans + lifetime spend, plus a portfolio-wide summary.
 *
 * One request = four batched DB queries. No N+1.
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only GET method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();
    const caller = getUserFromRequest(req);
    if (!caller) return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);

    // Gate
    if (!(await isAgencyUser(supabase, caller.userId))) {
      return errorResponse(
        "NOT_AGENCY_USER",
        "Only agency users can call this endpoint. Use single-org endpoints otherwise.",
        403,
      );
    }

    // Resolve every org the caller can see, then keep only OWNER + ADMIN.
    const visibleOrgs = await getUserOrganizations(supabase, caller.userId);
    const adminableOrgs = visibleOrgs.filter(
      (o) => o.role === "OWNER" || o.role === "ADMIN",
    );

    if (adminableOrgs.length === 0) {
      return successResponse({
        status: "success",
        data: {
          organizations: [],
          summary: {
            organization_count: 0,
            total_active_campaigns: 0,
            total_qr_scans: 0,
            total_spend: 0,
          },
        },
      }, 200);
    }

    const orgIds = adminableOrgs.map((o) => o.id);
    const roleByOrgId = new Map<string, "OWNER" | "ADMIN">();
    for (const o of adminableOrgs) {
      roleByOrgId.set(o.id, o.role as "OWNER" | "ADMIN");
    }

    // Batched fetches in parallel.
    const [
      { data: fullOrgs, error: orgsErr },
      { data: activeCampaigns, error: activeErr },
      { data: allCampaignLeads, error: leadsErr },
      { data: paymentRows, error: payErr },
    ] = await Promise.all([
      supabase.from("organizations").select("*").in("id", orgIds),
      supabase.from("campaigns").select("*").in("organization_id", orgIds).eq(
        "status->>name",
        "Active",
      ),
      supabase.from("campaigns").select("organization_id, leads_gen").in(
        "organization_id",
        orgIds,
      ),
      supabase.from("payment_history").select("organization_id, amount_paid").in(
        "organization_id",
        orgIds,
      ),
    ]);

    if (orgsErr) {
      console.error("getAgencyOverview: orgs fetch error", orgsErr);
      return errorResponse("FETCH_FAILED", "Failed to load organizations", 500);
    }
    if (activeErr) {
      console.error("getAgencyOverview: active campaigns fetch error", activeErr);
      return errorResponse("FETCH_FAILED", "Failed to load active campaigns", 500);
    }
    if (leadsErr) {
      console.error("getAgencyOverview: campaigns scan-rollup fetch error", leadsErr);
      return errorResponse("FETCH_FAILED", "Failed to load campaign scan rollups", 500);
    }
    if (payErr) {
      console.error("getAgencyOverview: payment_history fetch error", payErr);
      return errorResponse("FETCH_FAILED", "Failed to load payment history", 500);
    }

    // Index org rows by id; strip organization_members for privacy.
    const orgById = new Map<string, any>();
    for (const o of fullOrgs ?? []) {
      const { organization_members: _omit, ...rest } = o;
      orgById.set(o.id, rest);
    }

    // Group active campaigns by org.
    const activeByOrg = new Map<string, any[]>();
    for (const c of activeCampaigns ?? []) {
      const arr = activeByOrg.get(c.organization_id) ?? [];
      arr.push(c);
      activeByOrg.set(c.organization_id, arr);
    }

    // Aggregate lifetime QR scans and total campaign count per org.
    const scansByOrg = new Map<string, number>();
    const campaignCountByOrg = new Map<string, number>();
    for (const row of allCampaignLeads ?? []) {
      scansByOrg.set(
        row.organization_id,
        (scansByOrg.get(row.organization_id) ?? 0) + (Number(row.leads_gen) || 0),
      );
      campaignCountByOrg.set(
        row.organization_id,
        (campaignCountByOrg.get(row.organization_id) ?? 0) + 1,
      );
    }

    // Aggregate spend per org from payment_history.
    const spendByOrg = new Map<string, number>();
    for (const row of paymentRows ?? []) {
      spendByOrg.set(
        row.organization_id,
        (spendByOrg.get(row.organization_id) ?? 0) + (Number(row.amount_paid) || 0),
      );
    }

    // Build the per-org payload in the same order as adminableOrgs.
    const organizations = adminableOrgs.map((o) => {
      const orgRow = orgById.get(o.id);
      if (!orgRow) return null; // org disappeared between Q0 and Q1; skip defensively
      const active = activeByOrg.get(o.id) ?? [];
      return {
        ...orgRow,
        role: roleByOrgId.get(o.id),
        active_campaigns: active,
        active_campaign_count: active.length,
        total_qr_scans: scansByOrg.get(o.id) ?? 0,
        total_spend: spendByOrg.get(o.id) ?? 0,
        total_campaign_count: campaignCountByOrg.get(o.id) ?? 0,
      };
    }).filter(Boolean);

    const summary = {
      organization_count: organizations.length,
      total_active_campaigns: organizations.reduce(
        (sum: number, o: any) => sum + o.active_campaign_count,
        0,
      ),
      total_qr_scans: organizations.reduce(
        (sum: number, o: any) => sum + o.total_qr_scans,
        0,
      ),
      total_spend: organizations.reduce(
        (sum: number, o: any) => sum + o.total_spend,
        0,
      ),
    };

    return successResponse({
      status: "success",
      data: { organizations, summary },
    }, 200);
  } catch (error) {
    console.error("Unexpected error in getAgencyOverview:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500,
    );
  }
});
