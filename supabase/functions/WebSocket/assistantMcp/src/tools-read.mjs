// DK+ Phase-2 read tools. Each registers on a per-request McpServer with the
// caller's { userJwt }. Every tool is a thin projection over a DK+ Supabase
// Edge Function called with the USER's JWT (org/role scoping enforced there).
//
// Two-tier reads: list/search tools return COMPACT rows (no HTML/blobs); get-by-id
// tools return full detail. Admin-gated tools (billing/payments) surface a 403 as
// a friendly "requires an admin role" instead of erroring.
import { z } from "zod";
import { callApi } from "./helpers.mjs";
import { QR_ELEMENT_RE, activeOrgContext, declaredOnly, loosenToolSchema, makeGuard, payload, roleAreaDenial, wrap as wrapShared } from "./tool-helpers.mjs";
import { designEditability, editabilityNote, elideDataUris } from "./template-html.mjs";
import { loadActiveContext, buildContextPrompt, buildLiveState } from "./context.mjs";

// Document pixels at 96dpi, the coordinate system every element position is expressed in. Stated
// once here and in the emit_ui description; the model needs it to place a new element sensibly.
const POSTCARD_PX = {
  "4x6": { width: 600, height: 408 },
  "6x9": { width: 888, height: 600 },
  "6x11": { width: 1080, height: 600 },
};
// Backstop applied only AFTER image data is elided. Every one of the 44 real designs measured comes
// in under 24 KB once the base64 is gone, so this refuses nothing that exists today.
const MAX_SIDE_HTML = 64_000;

// Shared plumbing (tool-helpers.mjs) with the read-flavored guard tone.
// The tool NAME, not a generic tag — see the D5 note on wrap in tool-helpers.
const wrap = (fn, name) => wrapShared(fn, name ?? "read tool");
const guard = makeGuard("read");

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
const referralRow = (r) => {
  const status = r.status?.name ?? r.status ?? null;
  return {
    id: r.id,
    referrer: r.home_owner_info?.name ?? r.home_owner_info?.referrer_name ?? null,
    job_type: r.job_details?.job_type ?? null,
    value: r.job_details?.value_display ?? r.job_details?.value ?? null,
    status,
    // Explicit so the model never has to interpret a status string to decide whether a referral can
    // carry a campaign. A draft is not usable: the consent + signature section is the USER's to
    // complete, and create_campaign refuses anything else. Without this the model was handed a list
    // of equally-selectable options and picked a draft (QA, 2026-07-31).
    // NOTE: a campaign also needs at least one job photo, which this list payload does not carry —
    // create_campaign checks that at the point of use.
    usable_for_campaign: status === "Ready" || status === "In Use",
    campaign_id: r.campaign_id ?? null,
  };
};
// A bundle has NO name of its own anywhere in the schema — the display name lives in the
// side templates' description with a trailing side token, e.g. "QA Dup v2 Back" → "QA Dup v2"
// (owner-confirmed rule; matches the frontend's stripBundleSuffix).
const bundleNameFromDescriptions = (front, back) => {
  const d = front?.description ?? back?.description ?? null;
  if (!d) return null;
  const stripped = d.replace(/\s+(front|back)$/i, "").trim();
  return stripped || d;
};
const bundleUsedCount = (side) => {
  const used = side?.campaigns_used;
  if (Array.isArray(used)) return used.length;
  if (typeof used === "number") return used;
  return null;
};
// getAllTemplatesBundles / ...V3 both return {id, is_universal, isAgencyTemplate, front:{html,
// description, postcard_size, campaigns_used…}, back:{…}} — there is NO top-level name /
// postcardSize (an earlier draft of this projection read those and returned null names, which
// pushed the model into fetching full bundles to find names).
const bundleRow = (b) => {
  const front = b.front ?? b.front_template ?? null;
  const back = b.back ?? b.back_template ?? null;
  const used = bundleUsedCount(front) ?? bundleUsedCount(back);
  return {
    bundle_id: b.id ?? b.bundle_id,
    name: b.name ?? b.bundle_name ?? bundleNameFromDescriptions(front, back),
    postcardSize: b.postcardSize ?? b.postcard_size ?? front?.postcard_size ?? back?.postcard_size ?? null,
    used_in_campaigns: used,
    isUniversal: b.isUniversal ?? b.is_universal ?? false,
    isAgencyTemplate: b.isAgencyTemplate ?? false,
  };
};

// ── Agency-workspace guard ─────────────────────────────────────────────────────
// When the active org is an agency it owns NO campaigns/referrals/analytics/billing of its
// own (those live in the client sub-orgs), so org-scoped tools come back empty/zero. This note
// steers the model to the agency rollup (get_agency_overview) or to having the user switch into
// a client, instead of reporting a misleading "0". Backstop to the system-prompt guidance.
const AGENCY_NOTE =
  "This is your agency workspace — it holds no campaigns, referrals, analytics, or billing of its own; those live in your client organizations. Use the agency overview for portfolio totals, or switch into a specific client organization to see its detail.";

const agencyCache = new Map(); // userJwt -> { isAgency, expiresAt }
async function activeOrgIsAgency(userJwt) {
  const hit = agencyCache.get(userJwt);
  if (hit && hit.expiresAt > Date.now()) return hit.isAgency;
  const res = await callApi("getOrganization", "GET", null, userJwt);
  const o = res && !res.__error ? payload(res) : null;
  const isAgency = !!(o?.isAgencyAccount ?? o?.is_agency);
  agencyCache.set(userJwt, { isAgency, expiresAt: Date.now() + 60_000 });
  if (agencyCache.size > 5000) agencyCache.clear();
  return isAgency;
}

// Attach the agency note to a successful result when the active org is an agency. `check` gates
// the (cached) lookup: pass `list.length === 0` for list/search tools so data-rich non-agency
// turns skip it, or `true` for analytics tools (which return zeros, not empties).
async function maybeAgencyNote(userJwt, result, check) {
  if (!check) return result;
  if (!(await activeOrgIsAgency(userJwt))) return result;
  return { ...result, agency_workspace: true, agency_note: AGENCY_NOTE };
}

export function registerReadTools(server, { userId, userJwt }) {
  const R = { readOnlyHint: true };
  // Optional `area` gates the tool by the caller's per-org role (see roleAreaDenial) — the
  // same areas the app's menu hides: technicians get no campaigns/templates/targeting/analytics.
  // D7: advertise passthrough, execute against the declared shape (see loosenToolSchema/declaredOnly).
  const t = (name, description, inputSchema, handler, area) => {
    const only = declaredOnly(inputSchema);
    return server.registerTool(name, { description, inputSchema: loosenToolSchema(inputSchema), annotations: R }, wrap(async (a) =>
      (await roleAreaDenial(userJwt, area)) ?? handler(only(a)), name));
  };

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
      const g = guard(res); if (g) return g;
      const campaigns = (payload(res) ?? []).map(campaignRow);
      return maybeAgencyNote(userJwt, { campaigns, pagination: res?.pagination ?? null }, campaigns.length === 0);
    }, "campaigns");

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
    }, "campaigns");

  t("search_campaigns", "Search/filter the user's campaigns. Provide at least a query or a filter.",
    {
      query: z.string().optional(),
      filters: z.object({ status: z.object({ id: z.number().optional(), name: z.string().optional() }).optional(), start_date: z.string().optional(), end_date: z.string().optional() }).optional(),
      page: z.number().optional(), limit: z.number().optional(),
    },
    async (a) => {
      const res = await callApi("searchCampaign", "POST", null, userJwt, { query: a.query, filters: a.filters, page: a.page ?? 1, limit: a.limit ?? 10 });
      const g = guard(res); if (g) return g;
      const campaigns = (payload(res) ?? []).map(campaignRow);
      return maybeAgencyNote(userJwt, { campaigns, pagination: res?.pagination ?? null }, campaigns.length === 0);
    }, "campaigns");

  t("get_campaign_history", "The activity log for one campaign (who changed what, when).",
    { id: z.string().describe("campaign UUID") },
    async (a) => {
      const res = await callApi("getCampaignHistory", "POST", null, userJwt, { id: a.id });
      const g = guard(res); if (g) return g;
      const history = payload(res)?.history ?? payload(res) ?? [];
      return maybeAgencyNote(userJwt, { history }, Array.isArray(history) && history.length === 0);
    }, "campaigns");

  t("get_campaign_statuses", "The list of valid campaign status names/ids (for filtering). Small enum.",
    {},
    async () => {
      const res = await callApi("getCampaignStatuses", "GET", null, userJwt);
      return guard(res) ?? { statuses: payload(res) ?? [] };
    }, "campaigns");

  // ── Analytics (pass-through; the model picks the type) ────────────────────────
  t("get_dashboard_analytics",
    "Delivery/scan/waste/performance analytics for the current org. type ∈ dashboard_cards | delivery_funnel | waste_meter | scan_trend | recent_scans | campaign_leaderboard | performance_trend | campaign_performance | scan_trend_by_type | postcard_overview | active_campaigns | campaign_type_distribution | scan_activity_by_hour | device_distribution | campaign_engagement. Optionally scope by campaign_ids and a time window.",
    { type: z.string(), campaign_ids: z.array(z.string()).optional(), last_24hours: z.boolean().optional(), last_week: z.boolean().optional(), last_month: z.boolean().optional() },
    async (a) => {
      const res = await callApi("getAnalyticsV2", "POST", null, userJwt, { type: a.type, campaign_ids: a.campaign_ids, last_24hours: a.last_24hours, last_week: a.last_week, last_month: a.last_month });
      const g = guard(res); if (g) return g;
      return maybeAgencyNote(userJwt, { type: a.type, data: payload(res) }, true);
    }, "analytics");

  t("get_summary_analytics",
    "High-level summary stats. type ∈ DASHBOARD | CAMPAIGNS | REFERRALS | TEMPLATES | TARGETING_ZONES | ADDRESS_COLLECTION | GLOBAL_EXCLUSIONS. e.g. DASHBOARD → total_referrals, active_campaigns, total_spent, estimated_conversion_rate, average_scan_rate.",
    { type: z.string() },
    async (a) => {
      const res = await callApi("getAnalytics", "POST", null, userJwt, { type: a.type });
      const g = guard(res); if (g) return g;
      return maybeAgencyNote(userJwt, { type: a.type, data: payload(res) }, true);
    }, "analytics");

  t("get_analytics_page",
    "Date-rangeable analytics page data. type ∈ OVERVIEW | CAMPAIGN_PERFORMANCE | ROI. ROI → total_spent, avg_estimated_roi, estimated_revenue_generated, cost_breakdown. Pass selected_start_date + selected_end_date together, or neither.",
    { type: z.string(), selected_campaign_id: z.string().optional(), selected_start_date: z.string().optional(), selected_end_date: z.string().optional() },
    async (a) => {
      const res = await callApi("getAnalyticsPageData", "POST", null, userJwt, { type: a.type, selected_campaign_id: a.selected_campaign_id, selected_start_date: a.selected_start_date, selected_end_date: a.selected_end_date });
      const g = guard(res); if (g) return g;
      return maybeAgencyNote(userJwt, { type: a.type, data: payload(res)?.analytics_data ?? payload(res) }, true);
    }, "analytics");

  // ── Referrals ─────────────────────────────────────────────────────────────────
  t("list_referrals",
    "List the user's referrals/jobs (referrer, job type, value, status). Paginated. A referral can only be used for a campaign once the USER has finished it — they complete the consent + signature section in the app, which is what turns it from a draft into a usable referral. When you are looking for a referral to build a campaign on, pass showOnlyActive:true so drafts are excluded; each row also carries usable_for_campaign. Never propose a referral whose usable_for_campaign is false.",
    { page: z.number().optional(), limit: z.number().optional(), showOnlyActive: z.boolean().optional().describe("true = only referrals that are finished and usable for a campaign") },
    async (a) => {
      const res = await callApi("getAllReferrals", "POST", { page: a.page ?? 1, limit: a.limit ?? 10 }, userJwt, { showOnlyActive: a.showOnlyActive });
      const g = guard(res); if (g) return g;
      const referrals = (payload(res) ?? []).map(referralRow);
      return maybeAgencyNote(userJwt, { referrals, pagination: res?.pagination ?? null }, referrals.length === 0);
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
      const g = guard(res); if (g) return g;
      const referrals = (payload(res) ?? []).map(referralRow);
      return maybeAgencyNote(userJwt, { referrals, pagination: res?.pagination ?? null }, referrals.length === 0);
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

  // WS3 (Tier 3.5): setup-progress read. The step numbers mirror the wizard: 1 business,
  // 2 address, 3 logo, 4 team (team_onboarding_completed is what marks the org done).
  // 2026-07-31: this is now a REPORTING read only. The assistant no longer creates or onboards
  // organizations (that needed an org switch it must not perform), so this answers "what's left?"
  // and points the user at the app — it never precedes a write.
  t("get_org_onboarding",
    "An organization's setup/onboarding progress: which of the 4 setup steps are done, what's already filled in (business details, address, logo), and exactly which required fields are still needed. Use this to ANSWER a question about setup progress — e.g. when an organization shows as 'Setup N of 4'. You cannot finish an organization's setup yourself: tell the user what's outstanding and that they can complete it on the organization's setup screen in the app.",
    { organization_id: z.string().optional().describe("defaults to the user's active organization") },
    async (a) => {
      const q = a.organization_id ? { organization_id: a.organization_id } : null;
      const [stepRes, detailRes] = await Promise.all([
        callApi("getOnboardingStep", "GET", q, userJwt),
        callApi("getOnboardingDetails", "GET", q, userJwt),
      ]);
      const gs = guard(stepRes); if (gs) return gs;
      const completed = payload(stepRes)?.completed_step ?? 0;
      // Details are best-effort: a just-created org may have no onboarding row yet.
      const d = detailRes?.__error ? {} : (payload(detailRes) ?? {});
      const filled = {
        business_name: d.business_name ?? null,
        industry: d.industry ?? null,
        business_email: d.business_email ?? null,
        phone: d.business_phone_number ?? null,
        website: d.website_url ?? null,
        address: {
          country: d.country ?? null,
          street_address: d.street_address ?? null,
          city: d.city ?? null,
          state: d.state ?? null,
          zip: d.zip ?? null,
        },
        logo_set: !!d.company_logo,
      };
      if (completed >= 4) {
        return { completed_step: 4, onboarding_complete: true, filled, note: "This organization's setup is fully complete." };
      }
      // Required fields for the steps that haven't run yet — mirrors the app's onboarding wizard.
      const STEP_FIELDS = {
        1: [["business_name", filled.business_name], ["industry", filled.industry]],
        2: [["country", filled.address.country], ["street_address", filled.address.street_address], ["city", filled.address.city], ["state", filled.address.state], ["zip", filled.address.zip]],
        3: [["logo_url", filled.logo_set ? "set" : null]],
        4: [],
      };
      const remaining_steps = [1, 2, 3, 4].filter((s) => s > completed);
      const still_needed = remaining_steps.flatMap((s) => STEP_FIELDS[s].filter(([, v]) => !v).map(([f]) => f));
      return {
        completed_step: completed,
        onboarding_complete: false,
        remaining_steps,
        filled,
        still_needed,
        note: still_needed.length
          ? `Setup is at step ${completed} of 4. Everything in \`filled\` is already saved; what's still outstanding is: ${still_needed.join(", ")}. Tell the user that, in plain words, and that they can finish it on the organization's setup screen — you cannot complete setup for them.`
          : `Setup is at step ${completed} of 4 and every required field is already saved — only the final confirmation step remains, which the user does on the organization's setup screen. You cannot complete it for them.`,
      };
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
    }, "templates");

  t("get_template_bundle", "Detail for one design bundle: name, size, whether it has a QR code, usage. NO raw HTML is returned (a design can be 10k+ lines) — to SHOW the design, render a PostcardPreview block with this bundle_id; the app fetches and draws it client-side.",
    { bundle_id: z.string().describe("bundle UUID") },
    async (a) => {
      const res = await callApi("getTemplateBundleById", "GET", { bundle_id: a.bundle_id }, userJwt);
      const g = guard(res); if (g) return g;
      const p = payload(res);
      const front = p?.front_template ?? null;
      const back = p?.back_template ?? null;
      // Project HARD: the edge fn returns the full template rows including raw `html` — passing
      // that through blew up the model context (designs run to 10k+ lines). Everything the
      // agent legitimately needs is metadata; previews render by reference via PostcardPreview.
      return {
        bundle: {
          bundle_id: p?.bundle?.id ?? a.bundle_id,
          name: bundleNameFromDescriptions(front, back),
          postcard_size: front?.postcard_size ?? back?.postcard_size ?? null,
          has_qr_code: QR_ELEMENT_RE.test(`${front?.html ?? ""}\n${back?.html ?? ""}`),
          used_in_campaigns: bundleUsedCount(front) ?? bundleUsedCount(back),
          is_universal: p?.bundle?.is_universal ?? false,
          isAgencyTemplate: p?.bundle?.isAgencyTemplate ?? false,
          created_at: p?.bundle?.created_at ?? null,
          updated_at: p?.bundle?.updated_at ?? null,
        },
        note: "To show this design in the chat, emit a PostcardPreview with the bundle_id — never describe the HTML.",
      };
    }, "templates");

  // Reading the artwork so the agent can EDIT it rather than reinvent it (2026-08-05). See
  // template-html.mjs for why the payload is elided rather than the design refused on size.
  t("get_template_side_html",
    "Read ONE side of a saved design as html, so you can change it instead of designing a new one. Do this BEFORE proposing any edit. The html shows every element and — the part you need — each element's `data-element-id`, which is how an edit op names its target. Embedded image data is replaced by a short marker; you never need the pixels. NEVER send html back to me: describe the change as an emit_ui TemplateProposal carrying `bundle_id`, `side` and `ops`. The reply also tells you whether this design can be changed in place at all (`can_edit_in_place`) — if it cannot, say so and ask the user before duplicating.",
    { bundle_id: z.string().describe("bundle UUID"), side: z.enum(["front", "back"]).describe("which side you intend to change") },
    async (a) => {
      const res = await callApi("getTemplateBundleById", "GET", { bundle_id: a.bundle_id }, userJwt);
      const g = guard(res); if (g) return g;
      const p = payload(res);
      const front = p?.front_template ?? null;
      const back = p?.back_template ?? null;
      const tpl = a.side === "back" ? back : front;
      const raw = typeof tpl?.html === "string" ? tpl.html : "";
      if (!raw) return { error: `Couldn't read the ${a.side} of that design — no artwork came back.` };

      const { html, elided, bytesRemoved } = elideDataUris(raw);
      const name = bundleNameFromDescriptions(front, back);
      // A backstop only, and only AFTER elision: with the base64 gone every real design measured is
      // well under this. A design that still exceeds it is pathological, and guessing at a truncated
      // document is worse than saying so.
      if (html.length > MAX_SIDE_HTML) {
        return {
          blocked: "design_too_large",
          bundle_id: a.bundle_id, side: a.side, bytes: html.length, retry: false,
          plain: `That design's ${a.side} is too large for me to read reliably.`,
          note: `The ${a.side} is ${html.length} characters even after image data was removed. Do NOT guess at its contents. Tell the user it needs the visual editor, and offer a NavButton to /templates/${a.bundle_id}.`,
        };
      }

      const { role, orgId } = await activeOrgContext(userJwt);
      const verdict = designEditability({ bundle: p?.bundle, activeOrgId: orgId, role });
      return {
        bundle_id: a.bundle_id,
        side: a.side,
        name,
        postcard_size: tpl?.postcard_size ?? tpl?.postcardSize ?? null,
        canvas: POSTCARD_PX[tpl?.postcard_size ?? tpl?.postcardSize] ?? null,
        html,
        ...(elided ? { images_elided: elided, note_on_images: `${elided} embedded image${elided > 1 ? "s were" : " was"} replaced by a marker (${bytesRemoved} characters of image data). The real image is untouched in the design.` } : {}),
        ...verdict,
        note: editabilityNote(verdict, name),
      };
    }, "templates");

  t("list_templates", "List the user's individual template sides (front/back). Compact — HTML omitted.",
    { postcardSize: z.enum(["4x6", "6x9", "6x11"]).optional(), templateType: z.enum(["Front", "Back"]).optional() },
    async (a) => {
      const res = await callApi("getAllTemplates", "GET", { postcardSize: a.postcardSize, templateType: a.templateType }, userJwt);
      const g = guard(res); if (g) return g;
      const list = payload(res)?.templates ?? payload(res) ?? [];
      return { templates: (Array.isArray(list) ? list : []).map((x) => ({ id: x.id, description: x.description, templateType: x.templateType, postcardSize: x.postcardSize, isUniversal: x.isUniversal, live: x.live })) };
    }, "templates");

  t("get_merge_variables", "The business info merged onto a campaign's postcard (business name, phone, website, disclaimer).",
    { campaign_id: z.string() },
    async (a) => {
      const res = await callApi("getMergeVariables", "GET", { campaign_id: a.campaign_id }, userJwt);
      return guard(res) ?? { merge_variables: payload(res) };
    }, "campaigns");

  // ── Targeting summary (counts, not raw address dumps) ──────────────────────────
  t("get_targeting_summary", "Summary of the user's targeting zones and address collection (counts, status breakdown) — NOT the raw address list.",
    { scope: z.enum(["TARGETING_ZONES", "ADDRESS_COLLECTION"]).optional() },
    async (a) => {
      const res = await callApi("getAnalytics", "POST", null, userJwt, { type: a.scope ?? "TARGETING_ZONES" });
      const g = guard(res); if (g) return g;
      return maybeAgencyNote(userJwt, { scope: a.scope ?? "TARGETING_ZONES", data: payload(res) }, true);
    }, "targeting");

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
    }, "campaigns");

  // ── Billing (ADMIN-only — 403 handled gracefully) ─────────────────────────────
  t("get_billing_history", "The organization's billing/charge history. Requires an admin role.",
    { limit: z.number().optional(), starting_after: z.string().optional() },
    async (a) => {
      const res = await callApi("getBillingHistory", "POST", null, userJwt, { limit: a.limit ?? 20, starting_after: a.starting_after });
      const g = guard(res); if (g) return g;
      const transactions = payload(res)?.transactions ?? payload(res) ?? [];
      return maybeAgencyNote(userJwt, { transactions, has_more: res?.has_more ?? false }, Array.isArray(transactions) && transactions.length === 0);
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
      const g = guard(res); if (g) return g;
      const payments = payload(res)?.payments ?? payload(res) ?? [];
      return maybeAgencyNote(userJwt, { payments, total: res?.total ?? null }, Array.isArray(payments) && payments.length === 0);
    }, "campaigns");

  // ── Agency (only meaningful for agency accounts; self-gated) ──────────────────
  t("get_agency_overview", "For agency accounts: a rollup of the caller's client organizations (campaigns, scans, spend per client).",
    { page: z.number().optional(), status: z.enum(["active", "setup", "deleting", "all"]).optional(), search: z.string().optional() },
    async (a) => {
      const res = await callApi("getAgencyOverview", "GET", { page: a.page ?? 1, status: a.status, search: a.search }, userJwt);
      const g = guard(res); if (g) return g;
      const d = payload(res);
      return { organizations: d?.organizations ?? [], summary: d?.summary ?? null, pagination: d?.pagination ?? null };
    });

  t("get_agency_members",
    "For agency accounts: every team member across ALL organizations the caller manages (owns or admins) — the agency org plus its client organizations — each with their role and which organizations they belong to. This is the agency Team view.",
    {},
    async () => {
      // getOrganizationV3 aggregates members across all managed orgs (the frontend agency Team
      // page uses it); getAgencyAccountOrganizationMembers only returned one owned org's members.
      const res = await callApi("getOrganizationV3", "GET", null, userJwt);
      const g = guard(res); if (g) return g;
      const d = payload(res);
      const members = (d?.members ?? d ?? []).map((m) => ({
        id: m.id, full_name: m.full_name ?? m.name ?? null, email: m.email ?? null,
        role: m.role ?? m.member_role ?? null,
        organizations: Array.isArray(m.organizations)
          ? m.organizations.map((o) => ({ id: o.id, name: o.business_name ?? o.name ?? null, role: o.role ?? null }))
          : undefined,
      }));
      return { members };
    });

  t("list_agency_template_bundles",
    "For agency accounts: the agency's own postcard design bundles across its organizations (name, size, status) — the 'Custom'/agency designs on the agency Templates page. Excludes universal/library and shared-in designs (use list_template_bundles for those). Compact; use get_template_bundle for one bundle's full detail.",
    { page: z.number().optional(), limit: z.number().optional(), postcardSize: z.enum(["4x6", "6x9", "6x11"]).optional(), sort: z.string().optional() },
    async (a) => {
      const res = await callApi("getAllTemplatesBundlesV3", "GET", { page: a.page ?? 1, limit: a.limit ?? 10, postcardSize: a.postcardSize, sort: a.sort }, userJwt);
      return guard(res) ?? { bundles: (payload(res) ?? []).map(bundleRow), pagination: res?.pagination ?? null };
    }, "templates");

  t("get_branding_theme",
    "The user's branding theme: the three brand colors (hex) and the heading/body font names. Use these when DESIGNING a postcard so it matches their brand.",
    {},
    async () => {
      const res = await callApi("getAppContent", "GET", null, userJwt);
      const g = guard(res); if (g) return g;
      const theme = payload(res)?.theme ?? {};
      return {
        colors: theme.colors ?? { primary: "#E17019", secondary: "#4EC02B", accent: "#B85A14" },
        fonts: { heading: theme.fonts?.primary?.name ?? "Poppins", body: theme.fonts?.body?.name ?? "Poppins" },
      };
    });

  t("list_gallery_images",
    "The organization's photo gallery (id + URL per image; pass referral_id for a referral's gallery). Use these URLs as image sources when designing a postcard.",
    { referral_id: z.string().optional(), limit: z.number().optional() },
    async (a) => {
      const res = await callApi("getPhotoGallery", "POST", null, userJwt, a.referral_id ? { referral_id: a.referral_id } : {});
      const g = guard(res); if (g) return g;
      const gal = payload(res);
      const images = (gal?.images ?? gal?.gallery?.images ?? []).slice(0, a.limit ?? 30).map((i) => ({ id: i.id, url: i.url, type: i.type ?? "none" }));
      return { count: images.length, images };
    });

  t("get_address_list",
    "The state of an ADDRESS-LIST campaign's uploaded CSV list: counts (total / included / excluded / verified), whether verification ran or is skipped, and the list id (needed by the curation tools). Compact — no address rows; the user reviews rows in the uploader card or the app.",
    { campaign_id: z.string() },
    async (a) => {
      const res = await callApi("getCSVAddressListDetails", "POST", null, userJwt, { campaign_id: a.campaign_id });
      if (res?.__error && res.status === 404) return { error: "This campaign has no uploaded address list yet — the user attaches the CSV via the uploader card." };
      const g = guard(res); if (g) return g;
      const d = payload(res);
      if (!d?.id) return { error: "This campaign has no uploaded address list yet — the user attaches the CSV via the uploader card." };
      return {
        list_id: d.id,
        list_name: d.list_name ?? null,
        total: d.total_count ?? 0,
        included: d.included_count ?? 0,
        excluded: d.excluded_count ?? 0,
        verified: d.verified_address_count ?? 0,
        verification_performed: !!d.verification_performed,
        skip_address_verification: !!d.skip_address_verification,
      };
    }, "campaigns");
}
