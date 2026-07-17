// Page-aware live context — DK+ rewrite of namiMcp's context.mjs.
//
// loadActiveContext prefetches what's relevant to the screen the user is on and
// formats it into two text blocks for the model:
//   buildContextPrompt(ac) — the "USER CONTEXT" section (who they are + on-screen data,
//                            with [reference — do not show] id annotations)
//   buildLiveState(ac)     — a compact "[LIVE STATE …]" line carrying the raw ids
//
// Unlike Kabuki (service-role reads), every fetch here goes through callApi with the
// END USER's JWT, so the edge functions enforce org/role scoping. Every prefetch is
// failure-tolerant: a failed call just omits its section.
import { callApi } from "./helpers.mjs";

const ok = (res) => (res && !res.__error ? res : null);
const payload = (res) => res?.data ?? res;

// ── prefetch ──────────────────────────────────────────────────────────────────

export async function loadActiveContext({ userJwt, page, campaign_id, template_id, zone_id, referral_id }) {
  const pageBase = String(page ?? "").split("/")[0] || "unknown";
  const ac = { page: pageBase, campaign_id, template_id, zone_id, referral_id };

  const tasks = [];

  // Always: who is this (identity, role, orgs).
  tasks.push(
    callApi("getUser", "GET", null, userJwt).then((res) => {
      const u = payload(ok(res));
      if (!u) return;
      const orgs = Array.isArray(u.organizations) ? u.organizations : [];
      const active = orgs.find((o) => o.id === u.active_organization_id) ?? null;
      ac.user = {
        name: u.full_name ?? null,
        email: u.email ?? null,
        role: u.role ?? null,
        is_super_admin: !!u.is_super_admin,
        active_org_name: active?.business_name ?? null,
        active_org_is_agency: active?.isAgencyAccount ?? null,
        org_count: orgs.length,
      };
    }),
  );

  // Per-page prefetch.
  switch (pageBase) {
    case "dashboard":
      tasks.push(
        callApi("getAnalytics", "POST", null, userJwt, { type: "DASHBOARD" }).then((res) => {
          const d = payload(ok(res));
          if (d) ac.dashboard = d;
        }),
      );
      break;

    case "campaigns":
      tasks.push(
        callApi("getAllCampaigns", "GET", { page: 1, limit: 5 }, userJwt).then((res) => {
          const list = payload(ok(res));
          if (Array.isArray(list)) {
            ac.campaigns = list.map((c) => ({
              id: c.id, name: c.campaign_name, status: c.status?.name ?? c.status ?? null,
              postcards_sent: c.postcards_sent ?? null, scan_rate: c.scan_rate ?? null,
            }));
            ac.campaigns_total = res?.pagination?.total_count ?? null;
          }
        }),
      );
      break;

    case "campaign":
    case "campaign_create":
      if (campaign_id) {
        tasks.push(
          callApi("getCampaignById", "POST", null, userJwt, { id: campaign_id }).then((res) => {
            const c = payload(ok(res));
            if (c) {
              ac.campaign = {
                id: c.id, name: c.campaign_name, status: c.status?.name ?? c.status ?? null,
                postcards_sent: c.postcards_sent ?? null, scan_rate: c.scan_rate ?? null,
                total_spent: c.total_spent ?? null, start_date: c.start_date ?? null,
                template_bundle_id: c.template_bundle_id ?? null,
              };
            }
          }),
          callApi("getCampaignHistory", "POST", null, userJwt, { id: campaign_id }).then((res) => {
            const h = payload(ok(res))?.history;
            if (Array.isArray(h)) {
              ac.campaign_history = h.slice(0, 5).map((e) => ({ action: e.action, by: e.user_name, at: e.created_at }));
            }
          }),
        );
      }
      break;

    case "templates":
      tasks.push(
        callApi("getAllTemplatesBundles", "GET", { page: 1, limit: 5 }, userJwt).then((res) => {
          const list = payload(ok(res));
          if (Array.isArray(list)) {
            ac.template_bundles = list.map((b) => ({
              bundle_id: b.id ?? b.bundle_id, name: b.name ?? b.bundle_name ?? null,
              postcardSize: b.postcardSize ?? b.postcard_size ?? null, status: b.status ?? null,
            }));
            ac.template_bundles_total = res?.pagination?.total_count ?? null;
          }
        }),
      );
      break;

    case "template":
    case "template_editor":
      if (template_id) {
        tasks.push(
          callApi("getTemplateBundleById", "GET", { bundle_id: template_id }, userJwt).then((res) => {
            const d = payload(ok(res));
            const b = d?.bundle ?? d;
            // Context gets metadata only — never the HTML (that's for get_template_bundle/rendering).
            if (b) {
              ac.template_bundle = {
                bundle_id: b.id ?? b.bundle_id ?? template_id,
                name: b.name ?? b.bundle_name ?? null,
                postcardSize: b.postcardSize ?? b.postcard_size ?? null,
                status: b.status ?? null,
              };
            }
          }),
        );
      }
      break;

    case "zones":
    case "zone":
    case "zone_create":
      tasks.push(
        callApi("getAnalytics", "POST", null, userJwt, { type: "TARGETING_ZONES" }).then((res) => {
          const d = payload(ok(res));
          if (d) ac.targeting = { scope: "zones", ...d };
        }),
      );
      break;

    case "addresses":
    case "exclusions":
      tasks.push(
        callApi("getAnalytics", "POST", null, userJwt, { type: pageBase === "exclusions" ? "GLOBAL_EXCLUSIONS" : "ADDRESS_COLLECTION" }).then((res) => {
          const d = payload(ok(res));
          if (d) ac.targeting = { scope: pageBase, ...d };
        }),
      );
      break;

    case "referrals":
      tasks.push(
        callApi("getAllReferrals", "POST", { page: 1, limit: 5 }, userJwt, {}).then((res) => {
          const list = payload(ok(res));
          if (Array.isArray(list)) {
            ac.referrals = list.map((r) => ({
              id: r.id, referrer: r.home_owner_info?.name ?? null,
              job_type: r.job_details?.job_type ?? null, status: r.status?.name ?? r.status ?? null,
            }));
            ac.referrals_total = res?.pagination?.total_count ?? null;
          }
        }),
      );
      break;

    case "referral":
    case "referral_create":
      if (referral_id) {
        tasks.push(
          callApi("getReferralById", "POST", null, userJwt, { id: referral_id }).then((res) => {
            const r = payload(ok(res));
            if (r) {
              ac.referral = {
                id: r.id, referrer: r.home_owner_info?.name ?? null,
                job_type: r.job_details?.job_type ?? null,
                value: r.job_details?.value_display ?? r.job_details?.value ?? null,
                status: r.status?.name ?? r.status ?? null, campaign_id: r.campaign_id ?? null,
              };
            }
          }),
        );
      }
      break;

    case "analytics":
      tasks.push(
        callApi("getAnalyticsPageData", "POST", null, userJwt, { type: "OVERVIEW" }).then((res) => {
          const d = payload(ok(res));
          if (d) ac.analytics_overview = d.analytics_data ?? d;
        }),
      );
      break;

    case "settings":
    case "profile":
    case "team":
      tasks.push(
        callApi("getOrganization", "GET", null, userJwt).then((res) => {
          const o = payload(ok(res));
          if (o) {
            ac.organization = {
              name: o.business_name ?? null, industry: o.industry ?? null,
              email: o.business_email ?? o.email ?? null,
              members: (o.organization_members ?? []).map((m) => ({ name: m.full_name, email: m.email, role: m.member_role })),
            };
          }
        }),
      );
      break;

    case "agency":
    case "agency_team":
    case "agency_templates":
      // The client rollup is useful context on any agency page.
      tasks.push(
        callApi("getAgencyOverview", "GET", { page: 1 }, userJwt).then((res) => {
          const d = payload(ok(res));
          if (d) {
            ac.agency = {
              summary: d.summary ?? null,
              clients: (d.organizations ?? []).slice(0, 8).map((o) => ({
                id: o.id, name: o.business_name, status: o.status,
                active_campaigns: o.active_campaign_count ?? null, total_spend: o.total_spend ?? null,
              })),
            };
          }
        }),
      );
      // On the team page, prefetch members across ALL managed orgs (getOrganizationV3).
      if (pageBase === "agency_team") {
        tasks.push(
          callApi("getOrganizationV3", "GET", null, userJwt).then((res) => {
            const members = payload(ok(res))?.members ?? payload(ok(res));
            if (Array.isArray(members)) {
              ac.agency_members = members.slice(0, 30).map((m) => ({
                name: m.full_name ?? m.name ?? null, role: m.role ?? m.member_role ?? null,
                orgs: Array.isArray(m.organizations) ? m.organizations.map((o) => o.business_name ?? o.name).filter(Boolean) : undefined,
              }));
            }
          }),
        );
      }
      // On the templates page, prefetch the agency's own designs (V3).
      if (pageBase === "agency_templates") {
        tasks.push(
          callApi("getAllTemplatesBundlesV3", "GET", { page: 1, limit: 8 }, userJwt).then((res) => {
            const list = payload(ok(res));
            if (Array.isArray(list)) {
              ac.agency_templates = list.slice(0, 8).map((b) => ({
                bundle_id: b.id ?? b.bundle_id, name: b.name ?? b.bundle_name ?? null,
                postcardSize: b.postcardSize ?? b.postcard_size ?? null,
              }));
            }
          }),
        );
      }
      break;

    default:
      break; // unknown page — identity block alone still helps
  }

  await Promise.allSettled(tasks);
  return ac;
}

// ── formatting ────────────────────────────────────────────────────────────────

const RULE = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
const ref = (label, id) => (id ? `  [reference — do not show to the user: ${label}=${id}]` : "");
const line = (parts) => parts.filter(Boolean).join(" · ");

export function buildContextPrompt(ac) {
  const out = [];
  out.push(RULE);
  out.push("USER CONTEXT — refreshed this turn. This is the CURRENT state; it overrides anything remembered from earlier turns.");

  if (ac.user) {
    const u = ac.user;
    out.push("");
    out.push("WHO YOU'RE TALKING TO");
    out.push(`- ${u.name ?? "Unknown"} (${u.email ?? "no email"}), role ${u.role ?? "unknown"}${u.is_super_admin ? " (owner)" : ""}${u.active_org_name ? ` in "${u.active_org_name}"` : ""}${u.active_org_is_agency ? " (agency workspace)" : ""}${u.org_count > 1 ? ` — has access to ${u.org_count} organizations` : ""}`);
  }

  out.push("");
  out.push(`CURRENT SCREEN: ${ac.page}`);

  if (ac.dashboard) {
    out.push(`- Dashboard stats: ${line([
      ac.dashboard.active_campaigns != null && `${ac.dashboard.active_campaigns} active campaigns`,
      ac.dashboard.total_referrals != null && `${ac.dashboard.total_referrals} referrals`,
      ac.dashboard.total_spent != null && `total spent ${ac.dashboard.total_spent}`,
      ac.dashboard.average_scan_rate != null && `avg scan rate ${ac.dashboard.average_scan_rate}`,
    ])}`);
  }
  if (ac.campaigns) {
    out.push(`- Campaigns list (${ac.campaigns_total ?? ac.campaigns.length} total; showing ${ac.campaigns.length}):`);
    for (const c of ac.campaigns) out.push(`  • ${c.name} — ${line([c.status, c.postcards_sent != null && `${c.postcards_sent} sent`, c.scan_rate != null && `${c.scan_rate} scan rate`])}${ref("campaign_id", c.id)}`);
  }
  if (ac.campaign) {
    const c = ac.campaign;
    out.push(`- ACTIVE CAMPAIGN: "${c.name}" — ${line([c.status, c.postcards_sent != null && `${c.postcards_sent} postcards sent`, c.scan_rate != null && `scan rate ${c.scan_rate}`, c.total_spent != null && `spent ${c.total_spent}`, c.start_date && `starts ${c.start_date}`])}${ref("campaign_id", c.id)}`);
    if (c.template_bundle_id) out.push(`  design attached${ref("template_id", c.template_bundle_id)}`);
  }
  if (ac.campaign_history?.length) {
    out.push(`- Recent campaign activity: ${ac.campaign_history.map((h) => `${h.action} (${h.by ?? "someone"})`).join("; ")}`);
  }
  if (ac.template_bundles) {
    out.push(`- Designs list (${ac.template_bundles_total ?? ac.template_bundles.length} total; showing ${ac.template_bundles.length}):`);
    for (const b of ac.template_bundles) out.push(`  • ${b.name ?? "Untitled"} — ${line([b.postcardSize, b.status])}${ref("template_id", b.bundle_id)}`);
  }
  if (ac.template_bundle) {
    const b = ac.template_bundle;
    out.push(`- ACTIVE DESIGN: "${b.name ?? "Untitled"}" — ${line([b.postcardSize, b.status])}${ref("template_id", b.bundle_id)}`);
  }
  if (ac.targeting) {
    const { scope, ...rest } = ac.targeting;
    out.push(`- Targeting (${scope}): ${JSON.stringify(rest)}`);
  }
  if (ac.referrals) {
    out.push(`- Referrals list (${ac.referrals_total ?? ac.referrals.length} total; showing ${ac.referrals.length}):`);
    for (const r of ac.referrals) out.push(`  • ${r.referrer ?? "Unknown"} — ${line([r.job_type, r.status])}${ref("referral_id", r.id)}`);
  }
  if (ac.referral) {
    const r = ac.referral;
    out.push(`- ACTIVE REFERRAL: ${r.referrer ?? "Unknown"} — ${line([r.job_type, r.value && `value ${r.value}`, r.status])}${ref("referral_id", r.id)}${r.campaign_id ? ref("campaign_id", r.campaign_id) : ""}`);
  }
  if (ac.analytics_overview) {
    const a = ac.analytics_overview;
    out.push(`- Analytics overview: ${line([
      a.total_campaigns != null && `${a.total_campaigns} campaigns`,
      a.total_postcards_sent != null && `${a.total_postcards_sent} postcards sent`,
      a.total_qr_scans_all_time != null && `${a.total_qr_scans_all_time} QR scans all-time`,
    ])}`);
  }
  if (ac.organization) {
    const o = ac.organization;
    out.push(`- Organization: "${o.name ?? "Unknown"}"${o.industry ? ` (${o.industry})` : ""}${o.email ? `, ${o.email}` : ""}`);
    if (o.members?.length) out.push(`  team: ${o.members.map((m) => `${m.name ?? m.email} (${m.role})`).join(", ")}`);
  }
  if (ac.agency) {
    if (ac.agency.summary) out.push(`- Agency summary: ${JSON.stringify(ac.agency.summary)}`);
    if (ac.agency.clients?.length) {
      out.push(`- Client organizations (showing ${ac.agency.clients.length}):`);
      for (const c of ac.agency.clients) out.push(`  • ${c.name} — ${line([c.status, c.active_campaigns != null && `${c.active_campaigns} active campaigns`, c.total_spend != null && `spend ${c.total_spend}`])}`);
    }
  }
  if (ac.agency_members?.length) {
    out.push(`- Agency team (members across your organizations, showing ${ac.agency_members.length}):`);
    for (const m of ac.agency_members) out.push(`  • ${m.name ?? "Unknown"} — ${line([m.role, m.orgs?.length && `in ${m.orgs.join(", ")}`])}`);
  }
  if (ac.agency_templates?.length) {
    out.push(`- Agency designs (showing ${ac.agency_templates.length}):`);
    for (const b of ac.agency_templates) out.push(`  • ${b.name ?? "Untitled"}${b.postcardSize ? ` — ${b.postcardSize}` : ""}${ref("template_id", b.bundle_id)}`);
  }

  out.push(RULE);
  return out.join("\n");
}

export function buildLiveState(ac) {
  const bits = [`screen=${ac.page}`];
  if (ac.campaign_id) bits.push(`campaign_id=${ac.campaign_id}`);
  if (ac.template_id) bits.push(`template_id=${ac.template_id}`);
  if (ac.zone_id) bits.push(`zone_id=${ac.zone_id}`);
  if (ac.referral_id) bits.push(`referral_id=${ac.referral_id}`);
  return `[LIVE STATE — overrides anything said in prior conversation turns: ${bits.join(", ")}]`;
}
