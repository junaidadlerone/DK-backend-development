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

    // ── Query params ───────────────────────────────────────────────
    const url = new URL(req.url);
    const pageParam = url.searchParams.get("page");
    const limitParam = url.searchParams.get("limit");
    let page = pageParam ? parseInt(pageParam, 10) : 1;
    let limit = limitParam ? parseInt(limitParam, 10) : 10;
    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1) limit = 10;
    if (limit > 100) limit = 100;

    // status filter — category match so it works against the
    // computed status strings ("Active" / "Setup N of N" / "Deleting in N days").
    // Accepts: 'active' | 'setup' | 'deleting' | 'all' (case-insensitive).
    const rawStatusFilter = url.searchParams.get("status");
    const statusFilter = rawStatusFilter ? rawStatusFilter.toLowerCase() : null;
    if (statusFilter && !["active", "setup", "deleting", "all"].includes(statusFilter)) {
      return errorResponse(
        "INVALID_STATUS",
        "status must be one of: active, setup, deleting, all",
        400,
      );
    }

    const parseNum = (k: string): number | null => {
      const v = url.searchParams.get(k);
      if (v == null || v === "") return null;
      const n = Number(v);
      return isNaN(n) ? null : n;
    };
    const minScans = parseNum("min_scans");
    const maxScans = parseNum("max_scans");
    const minSpend = parseNum("min_spend");
    const maxSpend = parseNum("max_spend");

    // Free-text search across business_name + business_email (case-insensitive substring).
    const rawSearch = url.searchParams.get("search");
    const search = rawSearch && rawSearch.trim() ? rawSearch.trim().toLowerCase() : null;

    // Gate
    if (!(await isAgencyUser(supabase, caller.userId))) {
      return errorResponse(
        "NOT_AGENCY_USER",
        "Only agency users can call this endpoint. Use single-org endpoints otherwise.",
        403,
      );
    }

    // Resolve every org the caller can see, then keep only OWNER + ADMIN.
    // Exclude the agency org itself — this endpoint is the agency's portfolio
    // view of its CLIENT sub-orgs, so the agency-account row would just clutter
    // the list.
    const visibleOrgs = await getUserOrganizations(supabase, caller.userId);
    const adminableOrgs = visibleOrgs.filter(
      (o) =>
        (o.role === "OWNER" || o.role === "ADMIN") &&
        o.isAgencyAccount !== true,
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
          pagination: {
            page: 1,
            limit,
            total: 0,
            total_pages: 0,
            has_next_page: false,
            has_previous_page: false,
          },
          filters: {
            status: statusFilter,
            search,
            min_scans: minScans,
            max_scans: maxScans,
            min_spend: minSpend,
            max_spend: maxSpend,
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
      { data: onboardingRows, error: onbErr },
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
      supabase.from("onboarding").select(
        "organization_id, business_name, street_address, company_logo, team_onboarding_completed, team_members_invited",
      ).in("organization_id", orgIds),
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
    if (onbErr) {
      console.error("getAgencyOverview: onboarding fetch error", onbErr);
      return errorResponse("FETCH_FAILED", "Failed to load onboarding rows", 500);
    }

    // Index onboarding rows by org id.
    const onboardingByOrg = new Map<string, any>();
    for (const row of onboardingRows ?? []) {
      onboardingByOrg.set(row.organization_id, row);
    }

    // Per-org status string.
    // Priority: pending-deletion > onboarding-complete > setup-in-progress.
    function computeStatus(org: any, onb: any | undefined): string {
      if (org.deletion_scheduled_at) {
        const msRemaining = new Date(org.deletion_scheduled_at).getTime() - Date.now();
        const daysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
        return `Deleting in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`;
      }
      // "Active" if any of:
      //  - per-org branding is set (V3 business step 4 / V3 agency step 2 agency_logo)
      //  - V1 team-onboarding step finished
      //  - V3 agency step 3 (team_members_invited) marked done
      const hasBranding = !!(org.branding_settings && org.branding_settings.logo);
      const teamDone = onb?.team_onboarding_completed === true;
      const teamInvited = onb?.team_members_invited === true;
      if (hasBranding || teamDone || teamInvited) return "Active";

      // Infer current step from filled fields. Always shown over a 4-step total
      // (V1 + V3 business). V3 agency has 5 steps but its 5th step is the first
      // client's branding — for the agency org's own status, 4 steps is the
      // observable boundary.
      const TOTAL = 4;
      let completed = 0;
      if (org.business_name || onb?.business_name) completed = 1;
      if (org.business_address || onb?.street_address) completed = 2;
      if (onb?.company_logo) completed = 3;
      const currentStep = Math.min(completed + 1, TOTAL);
      return `Setup ${currentStep} of ${TOTAL}`;
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
    const allOrganizations = adminableOrgs.map((o) => {
      const orgRow = orgById.get(o.id);
      if (!orgRow) return null; // org disappeared between Q0 and Q1; skip defensively
      const active = activeByOrg.get(o.id) ?? [];
      return {
        ...orgRow,
        role: roleByOrgId.get(o.id),
        status: computeStatus(orgRow, onboardingByOrg.get(o.id)),
        active_campaigns: active,
        active_campaign_count: active.length,
        total_qr_scans: scansByOrg.get(o.id) ?? 0,
        total_spend: spendByOrg.get(o.id) ?? 0,
        total_campaign_count: campaignCountByOrg.get(o.id) ?? 0,
      };
    }).filter(Boolean);

    // Categorize the computed status string into one of the filter buckets.
    function statusCategory(s: string): "active" | "setup" | "deleting" | "unknown" {
      if (!s) return "unknown";
      if (s === "Active") return "active";
      if (s.startsWith("Setup")) return "setup";
      if (s.startsWith("Deleting")) return "deleting";
      return "unknown";
    }

    // Apply filters in JS (these are computed fields, can't be pushed to SQL).
    const filtered = allOrganizations.filter((o: any) => {
      if (statusFilter && statusFilter !== "all") {
        if (statusCategory(o.status) !== statusFilter) return false;
      }
      if (search) {
        const name = (o.business_name ?? "").toLowerCase();
        const email = (o.business_email ?? "").toLowerCase();
        if (!name.includes(search) && !email.includes(search)) return false;
      }
      if (minScans != null && o.total_qr_scans < minScans) return false;
      if (maxScans != null && o.total_qr_scans > maxScans) return false;
      if (minSpend != null && o.total_spend < minSpend) return false;
      if (maxSpend != null && o.total_spend > maxSpend) return false;
      return true;
    });

    // Pagination (applied AFTER filtering).
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;
    const organizations = filtered.slice(offset, offset + limit);

    // Summary reflects the FILTERED set (the agency's current view), not the page.
    const summary = {
      organization_count: filtered.length,
      total_active_campaigns: filtered.reduce(
        (sum: number, o: any) => sum + o.active_campaign_count,
        0,
      ),
      total_qr_scans: filtered.reduce(
        (sum: number, o: any) => sum + o.total_qr_scans,
        0,
      ),
      total_spend: filtered.reduce(
        (sum: number, o: any) => sum + o.total_spend,
        0,
      ),
    };

    const pagination = {
      page,
      limit,
      total,
      total_pages: total === 0 ? 0 : totalPages,
      has_next_page: offset + limit < total,
      has_previous_page: page > 1,
    };

    const filters = {
      status: statusFilter,
      search,
      min_scans: minScans,
      max_scans: maxScans,
      min_spend: minSpend,
      max_spend: maxSpend,
    };

    return successResponse({
      status: "success",
      data: { organizations, summary, pagination, filters },
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
