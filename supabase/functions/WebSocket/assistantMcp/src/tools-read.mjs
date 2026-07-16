// DK+ Phase-2 read tools. Each registers on a per-request McpServer with the
// caller's { userJwt }. Every tool is a thin projection over a DK+ Supabase
// Edge Function called with the USER's JWT (org/role scoping enforced there).
//
// Two-tier reads: list/search tools return COMPACT rows (no HTML/blobs); get-by-id
// tools return full detail. Admin-gated tools (billing/payments) surface a 403 as
// a friendly "requires an admin role" instead of erroring.
import { z } from "zod";
import { callApi } from "./helpers.mjs";
import { loadActiveContext, buildContextPrompt, buildLiveState } from "./context.mjs";

const asText = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj) }] });
const asError = (err) => ({ isError: true, content: [{ type: "text", text: `Error: ${err.message ?? err}` }] });
const wrap = (fn) => async (args) => { try { return asText(await fn(args)); } catch (e) { console.error("tool error:", e.message); return asError(e); } };

// Translate a callApi failure envelope into a graceful, model-friendly object.
// 403s are disambiguated from the response body: DK+ uses 403 both for role
// gates ("Only ADMIN users…") and for org-membership problems (NO_ORGANIZATION).
function guard(res) {
  if (res && res.__error) {
    const body = String(res.body ?? "");
    if (res.status === 403) {
      if (/ADMIN/i.test(body)) return { error: "This requires an admin role on your account." };
      if (/NO_ORGANIZATION/i.test(body)) return { error: "This account isn't associated with an organization yet." };
      return { error: "You don't have access to this data with your current role." };
    }
    if (res.status === 404) return { error: "Not found." };
    return { error: "That data is unavailable right now." };
  }
  return null;
}
// Edge functions wrap payloads as { status, message, data, ... } or { success, data }.
const payload = (res) => res?.data ?? res;

// ── compact projections ───────────────────────────────────────────────────────
const campaignRow = (c) => ({
  id: c.id,
  name: c.campaign_name,
  status: c.status?.name ?? c.status ?? null,
  postcards_sent: c.postcards_sent ?? null,
  scan_rate: c.scan_rate ?? null,
  total_spent: c.total_spent ?? c.total_spent_display ?? null,
  start_date: c.start_date ?? null,
});
const referralRow = (r) => ({
  id: r.id,
  referrer: r.home_owner_info?.name ?? r.home_owner_info?.referrer_name ?? null,
  job_type: r.job_details?.job_type ?? null,
  value: r.job_details?.value_display ?? r.job_details?.value ?? null,
  status: r.status?.name ?? r.status ?? null,
  campaign_id: r.campaign_id ?? null,
});
const bundleRow = (b) => ({
  bundle_id: b.id ?? b.bundle_id,
  name: b.name ?? b.bundle_name ?? null,
  postcardSize: b.postcardSize ?? b.postcard_size ?? null,
  status: b.status ?? null,
  isUniversal: b.isUniversal ?? false,
  isAgencyTemplate: b.isAgencyTemplate ?? false,
});

export function registerReadTools(server, { userId, userJwt }) {
  const R = { readOnlyHint: true };
  const t = (name, description, inputSchema, handler) =>
    server.registerTool(name, { description, inputSchema, annotations: R }, wrap(handler));

  // ── Live page context ────────────────────────────────────────────────────────
  t("get_live_context",
    "Refresh the live page context for the current user: who they are, their role/organization, and the data for the screen they're on (campaign detail on campaign pages, designs on template pages, targeting summaries, referrals, agency rollup). Use when the user says 'this page', 'this campaign', 'my screen', or when you need up-to-date on-screen state mid-conversation.",
    {
      page: z.string().describe("Current page token: dashboard | campaigns | campaign | campaign_create | templates | template | template_editor | zones | zone | addresses | exclusions | referrals | referral | analytics | settings | profile | team | agency"),
      campaign_id: z.string().optional().describe("Active campaign UUID (campaign pages)"),
      template_id: z.string().optional().describe("Active template bundle UUID (template/editor pages)"),
      zone_id: z.string().optional().describe("Active zone UUID (zone detail page)"),
      referral_id: z.string().optional().describe("Active referral UUID (referral pages)"),
    },
    async (a) => {
      const ac = await loadActiveContext({ userJwt, page: a.page, campaign_id: a.campaign_id, template_id: a.template_id, zone_id: a.zone_id, referral_id: a.referral_id });
      return { userContextBlock: buildContextPrompt(ac), liveStateBlock: buildLiveState(ac) };
    });

  // ── Campaigns ────────────────────────────────────────────────────────────────
  t("list_campaigns", "List the user's campaigns (name, status, postcards sent, scan rate, spend). Paginated — pass a small limit.",
    { page: z.number().optional(), limit: z.number().optional().describe("default 10, max 100") },
    async (a) => {
      const res = await callApi("getAllCampaigns", "GET", { page: a.page ?? 1, limit: a.limit ?? 10 }, userJwt);
      return guard(res) ?? { campaigns: (payload(res) ?? []).map(campaignRow), pagination: res?.pagination ?? null };
    });

  t("get_campaign", "Full detail for one campaign: status, cost breakdown (postcards + address verification), total spent, template bundle, start date.",
    { id: z.string().describe("campaign UUID") },
    async (a) => {
      const res = await callApi("getCampaignById", "POST", null, userJwt, { id: a.id });
      const g = guard(res); if (g) return g;
      const c = payload(res);
      return {
        id: c?.id, name: c?.campaign_name, status: c?.status?.name ?? c?.status ?? null,
        cost_postcards: c?.cost_postcards ?? null, cost_address_verification: c?.cost_address_verification ?? null,
        total_spent: c?.total_spent ?? null, template_bundle_id: c?.template_bundle_id ?? null,
        start_date: c?.start_date ?? null, postcards_sent: c?.postcards_sent ?? null, scan_rate: c?.scan_rate ?? null,
      };
    });

  t("search_campaigns", "Search/filter the user's campaigns. Provide at least a query or a filter.",
    {
      query: z.string().optional(),
      filters: z.object({ status: z.object({ id: z.number().optional(), name: z.string().optional() }).optional(), start_date: z.string().optional(), end_date: z.string().optional() }).optional(),
      page: z.number().optional(), limit: z.number().optional(),
    },
    async (a) => {
      const res = await callApi("searchCampaign", "POST", null, userJwt, { query: a.query, filters: a.filters, page: a.page ?? 1, limit: a.limit ?? 10 });
      return guard(res) ?? { campaigns: (payload(res) ?? []).map(campaignRow), pagination: res?.pagination ?? null };
    });

  t("get_campaign_history", "The activity log for one campaign (who changed what, when).",
    { id: z.string().describe("campaign UUID") },
    async (a) => {
      const res = await callApi("getCampaignHistory", "POST", null, userJwt, { id: a.id });
      return guard(res) ?? { history: payload(res)?.history ?? payload(res) ?? [] };
    });

  t("get_campaign_statuses", "The list of valid campaign status names/ids (for filtering). Small enum.",
    {},
    async () => {
      const res = await callApi("getCampaignStatuses", "GET", null, userJwt);
      return guard(res) ?? { statuses: payload(res) ?? [] };
    });

  // ── Analytics (pass-through; the model picks the type) ────────────────────────
  t("get_dashboard_analytics",
    "Delivery/scan/waste/performance analytics for the current org. type ∈ dashboard_cards | delivery_funnel | waste_meter | scan_trend | recent_scans | campaign_leaderboard | performance_trend | campaign_performance | scan_trend_by_type | postcard_overview | active_campaigns | campaign_type_distribution | scan_activity_by_hour | device_distribution | campaign_engagement. Optionally scope by campaign_ids and a time window.",
    { type: z.string(), campaign_ids: z.array(z.string()).optional(), last_24hours: z.boolean().optional(), last_week: z.boolean().optional(), last_month: z.boolean().optional() },
    async (a) => {
      const res = await callApi("getAnalyticsV2", "POST", null, userJwt, { type: a.type, campaign_ids: a.campaign_ids, last_24hours: a.last_24hours, last_week: a.last_week, last_month: a.last_month });
      return guard(res) ?? { type: a.type, data: payload(res) };
    });

  t("get_summary_analytics",
    "High-level summary stats. type ∈ DASHBOARD | CAMPAIGNS | REFERRALS | TEMPLATES | TARGETING_ZONES | ADDRESS_COLLECTION | GLOBAL_EXCLUSIONS. e.g. DASHBOARD → total_referrals, active_campaigns, total_spent, estimated_conversion_rate, average_scan_rate.",
    { type: z.string() },
    async (a) => {
      const res = await callApi("getAnalytics", "POST", null, userJwt, { type: a.type });
      return guard(res) ?? { type: a.type, data: payload(res) };
    });

  t("get_analytics_page",
    "Date-rangeable analytics page data. type ∈ OVERVIEW | CAMPAIGN_PERFORMANCE | ROI. ROI → total_spent, avg_estimated_roi, estimated_revenue_generated, cost_breakdown. Pass selected_start_date + selected_end_date together, or neither.",
    { type: z.string(), selected_campaign_id: z.string().optional(), selected_start_date: z.string().optional(), selected_end_date: z.string().optional() },
    async (a) => {
      const res = await callApi("getAnalyticsPageData", "POST", null, userJwt, { type: a.type, selected_campaign_id: a.selected_campaign_id, selected_start_date: a.selected_start_date, selected_end_date: a.selected_end_date });
      return guard(res) ?? { type: a.type, data: payload(res)?.analytics_data ?? payload(res) };
    });

  // ── Referrals ─────────────────────────────────────────────────────────────────
  t("list_referrals", "List the user's referrals/jobs (referrer, job type, value, status). Paginated.",
    { page: z.number().optional(), limit: z.number().optional(), showOnlyActive: z.boolean().optional() },
    async (a) => {
      const res = await callApi("getAllReferrals", "POST", { page: a.page ?? 1, limit: a.limit ?? 10 }, userJwt, { showOnlyActive: a.showOnlyActive });
      return guard(res) ?? { referrals: (payload(res) ?? []).map(referralRow), pagination: res?.pagination ?? null };
    });

  t("get_referral", "Full detail for one referral (referrer, job site address, job details, status, linked campaign).",
    { id: z.string().describe("referral UUID") },
    async (a) => {
      const res = await callApi("getReferralById", "POST", null, userJwt, { id: a.id });
      return guard(res) ?? { referral: payload(res) };
    });

  t("search_referrals", "Search/filter referrals by owner, job type, value, or status.",
    { query: z.string().optional(), filters: z.object({ job_type: z.object({ id: z.number().optional(), name: z.string().optional() }).optional(), status: z.object({ id: z.number().optional(), name: z.string().optional() }).optional(), value: z.number().optional() }).optional(), page: z.number().optional(), limit: z.number().optional() },
    async (a) => {
      const res = await callApi("searchReferral", "POST", null, userJwt, { query: a.query, filters: a.filters, page: a.page ?? 1, limit: a.limit ?? 10 });
      return guard(res) ?? { referrals: (payload(res) ?? []).map(referralRow), pagination: res?.pagination ?? null };
    });

  // ── Org / user / notifications ─────────────────────────────────────────────────
  t("get_org_info", "The current organization: business name, industry, address, email, phone, website, and team members.",
    {},
    async () => {
      const res = await callApi("getOrganization", "GET", null, userJwt);
      const g = guard(res); if (g) return g;
      const o = payload(res);
      return { organization: o, members: o?.organization_members ?? null, isAgencyAccount: res?.isAgencyAccount ?? o?.isAgencyAccount ?? null };
    });

  t("get_user_info", "The signed-in user: name, email, role, verification/onboarding status, active organization.",
    {},
    async () => {
      const res = await callApi("getUser", "GET", null, userJwt);
      const g = guard(res); if (g) return g;
      const u = payload(res);
      return { id: u?.id, email: u?.email, role: u?.role, full_name: u?.full_name, is_super_admin: u?.is_super_admin, multi_org_enabled: u?.multi_org_enabled, active_organization_id: u?.active_organization_id };
    });

  t("get_user_organizations", "All organizations the user can access (id, business name, their role, active flag). Use to disambiguate which org is active.",
    {},
    async () => {
      const res = await callApi("getUserOrganizations", "GET", null, userJwt);
      return guard(res) ?? { organizations: payload(res)?.organizations ?? payload(res) ?? [] };
    });

  t("get_notifications", "The user's in-app notifications (title, message, read state, timestamp).",
    { filter: z.enum(["unread", "read"]).optional(), page: z.number().optional(), limit: z.number().optional() },
    async (a) => {
      const res = await callApi("getNotifications", "GET", { filter: a.filter, page: a.page ?? 1, limit: a.limit ?? 20 }, userJwt);
      return guard(res) ?? { notifications: payload(res) ?? [], pagination: res?.pagination ?? null };
    });

  // ── Templates (two-tier: list strips HTML, get returns full) ───────────────────
  t("list_template_bundles", "List the user's postcard design bundles (name, size, status). Compact — front/back HTML is intentionally omitted; use get_template_bundle for a specific one.",
    { page: z.number().optional(), limit: z.number().optional(), postcardSize: z.enum(["4x6", "6x9", "6x11"]).optional(), sort: z.string().optional() },
    async (a) => {
      const res = await callApi("getAllTemplatesBundles", "GET", { page: a.page ?? 1, limit: a.limit ?? 10, postcardSize: a.postcardSize, sort: a.sort }, userJwt);
      return guard(res) ?? { bundles: (payload(res) ?? []).map(bundleRow), pagination: res?.pagination ?? null };
    });

  t("get_template_bundle", "Full detail for one design bundle, INCLUDING the front and back template HTML (for rendering a preview).",
    { bundle_id: z.string().describe("bundle UUID") },
    async (a) => {
      const res = await callApi("getTemplateBundleById", "GET", { bundle_id: a.bundle_id }, userJwt);
      return guard(res) ?? { bundle: payload(res) };
    });

  t("list_templates", "List the user's individual template sides (front/back). Compact — HTML omitted.",
    { postcardSize: z.enum(["4x6", "6x9", "6x11"]).optional(), templateType: z.enum(["Front", "Back"]).optional() },
    async (a) => {
      const res = await callApi("getAllTemplates", "GET", { postcardSize: a.postcardSize, templateType: a.templateType }, userJwt);
      const g = guard(res); if (g) return g;
      const list = payload(res)?.templates ?? payload(res) ?? [];
      return { templates: (Array.isArray(list) ? list : []).map((x) => ({ id: x.id, description: x.description, templateType: x.templateType, postcardSize: x.postcardSize, isUniversal: x.isUniversal, live: x.live })) };
    });

  t("get_merge_variables", "The business info merged onto a campaign's postcard (business name, phone, website, disclaimer).",
    { campaign_id: z.string() },
    async (a) => {
      const res = await callApi("getMergeVariables", "GET", { campaign_id: a.campaign_id }, userJwt);
      return guard(res) ?? { merge_variables: payload(res) };
    });

  // ── Targeting summary (counts, not raw address dumps) ──────────────────────────
  t("get_targeting_summary", "Summary of the user's targeting zones and address collection (counts, status breakdown) — NOT the raw address list.",
    { scope: z.enum(["TARGETING_ZONES", "ADDRESS_COLLECTION"]).optional() },
    async (a) => {
      const res = await callApi("getAnalytics", "POST", null, userJwt, { type: a.scope ?? "TARGETING_ZONES" });
      return guard(res) ?? { scope: a.scope ?? "TARGETING_ZONES", data: payload(res) };
    });

  t("get_campaign_targeting",
    "The audience a specific campaign targets. Campaigns use either a location ZONE or an uploaded CSV address list; this resolves whichever the campaign has. Returns type:\"zone\" with zone_id + counts (show it visually with emit_ui ZoneMap{zoneId} — the app loads the addresses itself), or type:\"csv_list\" with up to 100 address rows (if rows carry lat/lng, show emit_ui ZoneMap with those points; otherwise a DataTable of the addresses), or type:\"none\" when no audience is attached yet. Use this whenever the user asks WHERE a campaign targets or which addresses it sends to.",
    { campaign_id: z.string().describe("campaign UUID") },
    async (a) => {
      const campRes = await callApi("getCampaignById", "POST", null, userJwt, { id: a.campaign_id });
      const g = guard(campRes); if (g) return g;
      const camp = payload(campRes);
      const listId = camp?.csv_address_list_id ?? null;

      if (listId) {
        const listRes = await callApi("getCSVAddressListById", "POST", null, userJwt, { csv_address_list_id: listId });
        const lg = guard(listRes); if (lg) return lg;
        const list = payload(listRes);
        const rows = Array.isArray(list?.addresses) ? list.addresses : [];
        const geocoded = Boolean(list?.center);
        return {
          type: "csv_list",
          campaign: camp?.campaign_name ?? null,
          list_id: listId,
          address_count: rows.length,
          geocoded,
          center: list?.center ? { lat: list.center.lat, lng: list.center.long ?? list.center.lng } : null,
          // Bounded projection (≤100) — enough for a ZoneMap/DataTable, never the full dump.
          addresses: rows.slice(0, 100).map((r) => ({
            address: r.address ?? r.full_address ?? ([r.line1, r.city, r.state].filter(Boolean).join(", ") || null),
            lat: r.lat ?? null,
            lng: r.long ?? r.lng ?? null,
            kind: r.residential === false ? "business" : "home",
            status: r.verification_details?.status === "undeliverable" ? "skipped" : "valid",
          })),
          truncated: rows.length > 100,
        };
      }

      const zonesRes = await callApi("getAllAddressZones", "GET", null, userJwt);
      const zg = guard(zonesRes); if (zg) return zg;
      const zones = (payload(zonesRes) ?? []).filter((z2) => z2?.campaign_id === a.campaign_id);
      if (!zones.length) return { type: "none", campaign: camp?.campaign_name ?? null, note: "No zone or address list is attached to this campaign yet." };
      return {
        type: "zone",
        campaign: camp?.campaign_name ?? null,
        zones: zones.map((z2) => {
          const addrs = Array.isArray(z2.addresses) ? z2.addresses : [];
          return {
            zone_id: z2.id,
            mode: z2.mode ?? null,
            search_type: z2.search_type ?? null,
            center: z2.center ? { lat: z2.center.lat, lng: z2.center.long ?? z2.center.lng, radius: z2.center.radius ?? null } : null,
            address_count: addrs.length,
            residential_count: addrs.filter((x) => x?.residential).length,
            business_count: addrs.filter((x) => x && x.residential === false).length,
            created_at: z2.created_at ?? null,
          };
        }),
      };
    });

  // ── Billing (ADMIN-only — 403 handled gracefully) ─────────────────────────────
  t("get_billing_history", "The organization's billing/charge history. Requires an admin role.",
    { limit: z.number().optional(), starting_after: z.string().optional() },
    async (a) => {
      const res = await callApi("getBillingHistory", "POST", null, userJwt, { limit: a.limit ?? 20, starting_after: a.starting_after });
      return guard(res) ?? { transactions: payload(res)?.transactions ?? payload(res) ?? [], has_more: res?.has_more ?? false };
    });

  t("get_payment_methods", "Cards on file for the organization. Requires an admin role.",
    {},
    async () => {
      const res = await callApi("getPaymentMethods", "POST", null, userJwt, {});
      return guard(res) ?? { payment_methods: payload(res)?.payment_methods ?? payload(res) ?? [] };
    });

  t("get_campaign_payments", "The charges for a specific campaign. Requires an admin role.",
    { campaign_id: z.string() },
    async (a) => {
      const res = await callApi("getPaymentHistoryForCampaign", "POST", null, userJwt, { campaign_id: a.campaign_id });
      return guard(res) ?? { payments: payload(res)?.payments ?? payload(res) ?? [], total: res?.total ?? null };
    });

  // ── Agency (only meaningful for agency accounts; self-gated) ──────────────────
  t("get_agency_overview", "For agency accounts: a rollup of the caller's client organizations (campaigns, scans, spend per client).",
    { page: z.number().optional(), status: z.enum(["active", "setup", "deleting", "all"]).optional(), search: z.string().optional() },
    async (a) => {
      const res = await callApi("getAgencyOverview", "GET", { page: a.page ?? 1, status: a.status, search: a.search }, userJwt);
      const g = guard(res); if (g) return g;
      const d = payload(res);
      return { organizations: d?.organizations ?? [], summary: d?.summary ?? null, pagination: d?.pagination ?? null };
    });

  t("get_agency_members", "For agency accounts: the members of the caller's agency organization.",
    {},
    async () => {
      const res = await callApi("getAgencyAccountOrganizationMembers", "GET", null, userJwt);
      return guard(res) ?? { members: payload(res)?.members ?? payload(res) ?? [] };
    });
}
