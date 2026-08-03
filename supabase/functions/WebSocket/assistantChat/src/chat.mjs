/**
 * POST /chat — DoorKnocker+ assistant, Tiers 1–3 (3A).
 *
 * The namiGateway spine (ai_audiobook_backend/.../namiGateway/src/index.mjs): validate the
 * user's Supabase JWT, call Flowise's streaming Prediction API, re-frame its SSE events into
 * the frontend contract, and mirror messages into chat_sessions / chat_messages.
 *
 *   body     { message, session_id?, context?, mode? }  mode:"auto" → non-destructive writes
 *            auto-resume (3C-6); destructive/payment always card. Default manual.
 *            message may be an HITL sentinel (__dk_hitl_proceed__/__dk_hitl_reject__) → resume
 *   auth     Authorization: Bearer <user's Supabase JWT>
 *   stream   data: {delta}                        token text (leak-filtered, de-dashed)
 *            data: {type:"thinking", delta}       live tool-call steps (Tier 2)
 *            data: {type:"ui", ...}               generative-UI surfaces from emit_ui + approval cards
 *            data: {error}                        one friendly line (raw detail stays in logs)
 *            data: {done, session_id, awaiting_approval}   awaiting_approval=true after a pause
 *
 * Tier-2 branches (re-enabled from namiGateway): vars threading (userJwt + page ids →
 * overrideConfig.vars → Flowise customMCP header), context preamble injection,
 * calledTools→thinking, usedTools→ui_job_id→inlineJobEvents→{type:"ui"}, leak/redact filters.
 * `context` accepts BOTH shapes: the legacy widget's {page:"Dashboard", path:"/dashboard",
 * entity?} (page token derived from path — zero frontend changes needed) and the Stage-F
 * {page:"dashboard", campaign_id?, template_id?, zone_id?, referral_id?}.
 *
 * Tier-3 (3A): HITL pause/resume. The Flowise "write" customMCP entry (Require-Human-Input ON)
 * pauses before any mutating tool and emits an `action` event; that becomes a perm_ approval card
 * + awaiting_approval:true. The card's buttons send a sentinel, converted here to a Flowise
 * humanInput {proceed|reject} resume against AGENT_NODE_ID. Reject suppresses model output for a
 * deterministic cancel line. AUTO mode (3C-6): annotation-driven policy (destructiveHint from the
 * MCP, fail-closed) + ALWAYS_CONFIRM; capped silent resume loop. Still deferred: response-feedback,
 * (3B), refresh frames, {type:"job"} announcements. Session-ownership check on resume is chatKabuki.
 */

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { authenticateToken } from "./auth.mjs";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const FLOWISE_URL = process.env.FLOWISE_URL ?? "";
const FLOWISE_FLOW_ID = process.env.FLOWISE_FLOW_ID ?? "";
const FLOWISE_API_KEY = process.env.FLOWISE_API_KEY ?? "";
const ASSISTANT_MCP_URL = (process.env.ASSISTANT_MCP_URL ?? "").replace(/\/+$/, "");

// Lazy/conditional client so a sync-only deployment (no chat env vars yet) still boots.
const chatConfigured = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY && FLOWISE_URL && FLOWISE_FLOW_ID);
const adminSupabase = SUPABASE_URL && SUPABASE_SERVICE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) : null;

// ── auth — local JWKS verification (auth.mjs), getUser only as key-set-outage fallback ─
async function authenticate(req) {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  return authenticateToken(token, async (t) => {
    const { data, error } = await adminSupabase.auth.getUser(t);
    return error || !data?.user ? null : data.user.id;
  });
}

// ── context normalization (Tier 2) ────────────────────────────────────────────
// Accepts both context shapes and produces { page, campaign_id?, template_id?,
// zone_id?, referral_id? }. The legacy widget sends {page:"Dashboard", path:"/…",
// entity?} — the page token + entity ids are derived from the path, so page
// awareness works with the CURRENT frontend, no changes required.
const ID_SEG = "([0-9a-fA-F-]{8,})";
const PATH_RULES = [
  [/^\/dashboard/, () => ({ page: "dashboard" })],
  [new RegExp(`^/campaigns/create`), (m, q) => ({ page: "campaign_create", campaign_id: q.get("campaignId") ?? undefined })],
  [new RegExp(`^/campaigns/${ID_SEG}`), (m) => ({ page: "campaign", campaign_id: m[1] })],
  [/^\/campaigns/, () => ({ page: "campaigns" })],
  [new RegExp(`^/referrals/create`), () => ({ page: "referral_create" })],
  [new RegExp(`^/referrals/${ID_SEG}`), (m) => ({ page: "referral", referral_id: m[1] })],
  [/^\/referrals/, () => ({ page: "referrals" })],
  [new RegExp(`^/templates/editor(?:/${ID_SEG})?`), (m) => ({ page: "template_editor", template_id: m[1] ?? undefined })],
  [new RegExp(`^/templates/${ID_SEG}`), (m) => ({ page: "template", template_id: m[1] })],
  [/^\/templates/, () => ({ page: "templates" })],
  [new RegExp(`^/targeting/zones/create`), () => ({ page: "zone_create" })],
  [new RegExp(`^/targeting/zones/${ID_SEG}`), (m) => ({ page: "zone", zone_id: m[1] })],
  [/^\/targeting\/zones/, () => ({ page: "zones" })],
  [/^\/targeting\/addresses/, () => ({ page: "addresses" })],
  [/^\/targeting\/exclusions/, () => ({ page: "exclusions" })],
  [/^\/analytics/, () => ({ page: "analytics" })],
  [/^\/agency\/team/, () => ({ page: "agency_team" })],
  [/^\/agency\/templates/, () => ({ page: "agency_templates" })],
  [/^\/agency/, () => ({ page: "agency" })],
  [/^\/team/, () => ({ page: "team" })],
  [/^\/settings/, () => ({ page: "settings" })],
  [/^\/profile/, () => ({ page: "profile" })],
];
const ENTITY_ID_KEY = { campaign: "campaign_id", template: "template_id", templateBundle: "template_id", zone: "zone_id", referral: "referral_id" };

// Carry the active-organization signal (+ a one-shot switch marker) through unchanged, in
// whichever context shape arrived. Used to keep the agent scoped to the current org and to
// have it acknowledge a mid-chat switch.
function attachOrg(out, context) {
  if (out && context.organization && typeof context.organization === "object") {
    out.organization = {
      id: context.organization.id ?? null,
      name: context.organization.name ?? null,
      isAgency: !!context.organization.isAgency,
    };
  }
  if (out && context.orgSwitched) {
    out.orgSwitched = true;
    out.previousOrgName = context.previousOrgName ?? null;
  }
  return out;
}

export function normalizeContext(context) {
  if (!context || typeof context !== "object") return null;
  // Stage-F shape: already tokenized (lowercase page, snake_case ids).
  if (context.campaign_id || context.template_id || context.zone_id || context.referral_id
      || (typeof context.page === "string" && /^[a-z_]+$/.test(context.page) && !context.path)) {
    const { page, campaign_id, template_id, zone_id, referral_id } = context;
    return attachOrg({ page: page ?? "unknown", campaign_id, template_id, zone_id, referral_id }, context);
  }
  // Legacy shape: derive from path (+ entity, + query string).
  const rawPath = typeof context.path === "string" ? context.path : "";
  const [pathname, search = ""] = rawPath.split("?");
  const q = new URLSearchParams(search);
  let out = null;
  for (const [re, build] of PATH_RULES) {
    const m = pathname.match(re);
    if (m) { out = build(m, q); break; }
  }
  out ??= { page: pathname.replace(/^\//, "") || String(context.page ?? "unknown").toLowerCase() };
  const ent = context.entity;
  if (ent?.id && ENTITY_ID_KEY[ent.type]) out[ENTITY_ID_KEY[ent.type]] = ent.id;
  return attachOrg(out, context);
}

// ── thinking labels (Tier 2) — one per MCP tool ───────────────────────────────
const THINKING_LABELS = {
  // Flowise reports the agent's Pinecone knowledge attachment as a tool call too.
  doorknocker_product_docs: "Checking the product docs…",
  dk_ops: "Checking my playbook…",
  get_live_context: "Reading your screen…",
  get_campaign_targeting: "Finding the campaign's targeting…",
  list_campaigns: "Looking up your campaigns…",
  get_campaign: "Fetching campaign details…",
  search_campaigns: "Searching your campaigns…",
  get_campaign_history: "Reviewing campaign history…",
  get_campaign_statuses: "Loading status options…",
  get_dashboard_analytics: "Crunching your analytics…",
  get_summary_analytics: "Summarizing your performance…",
  get_analytics_page: "Pulling analytics…",
  list_referrals: "Looking up your referrals…",
  get_referral: "Fetching referral details…",
  search_referrals: "Searching your referrals…",
  get_org_info: "Loading your organization…",
  get_user_info: "Checking your profile…",
  get_user_organizations: "Listing your organizations…",
  get_notifications: "Checking your notifications…",
  list_template_bundles: "Loading your postcard designs…",
  get_template_bundle: "Fetching the design…",
  list_templates: "Loading your templates…",
  get_merge_variables: "Reading the postcard's business info…",
  get_targeting_summary: "Summarizing your targeting…",
  get_billing_history: "Reviewing your billing…",
  get_payment_methods: "Checking your payment methods…",
  get_campaign_payments: "Looking up campaign charges…",
  get_agency_overview: "Rolling up your client accounts…",
  get_agency_members: "Loading your agency team…",
  list_agency_template_bundles: "Loading your agency designs…",
  // Generative UI + Tier-3 write actions (friendly labels so the raw tool name never shows).
  emit_ui: "Putting together a view…",
  create_referral: "Creating the referral…",
  update_referral: "Updating the referral…",
  delete_referral: "Deleting the referral…",
  delete_referral_image: "Removing the image…",
  mark_notification: "Updating a notification…",
  clear_notification: "Clearing a notification…",
  clear_notifications: "Clearing notifications…",
  update_organization: "Updating your organization…",
  update_profile: "Updating your profile…",
  set_default_payment_method: "Updating your default payment method…",
  create_campaign: "Setting up the campaign…",
  update_campaign: "Updating the campaign…",
  delete_campaign: "Deleting the campaign…",
  duplicate_template_bundle: "Duplicating the design…",
  update_template_settings: "Updating the design…",
  // 3C reads
  get_address_list: "Checking the address list…",
  get_branding_theme: "Loading your branding…",
  list_gallery_images: "Browsing your gallery…",
  get_org_onboarding: "Checking the organization's setup…",
  // 3C writes
  create_address_list_campaign: "Setting up the campaign…",
  remove_invalid_addresses: "Excluding invalid addresses…",
  remove_duplicate_addresses: "Excluding duplicate addresses…",
  delete_addresses: "Removing those addresses…",
  set_verification_skip: "Updating the verification preference…",
  update_branding_theme: "Updating your branding…",
  remove_company_logo: "Removing the logo…",
  invite_user: "Sending the invitation…",
  edit_user_access: "Updating their access…",
  revoke_user_access: "Removing their access…",
  update_agency_settings: "Updating your agency…",
  share_agency_template: "Sharing the design…",
  unshare_agency_template: "Unsharing the design…",
  delete_template_bundle: "Deleting the design…",
  // create_client_organization / complete_org_onboarding removed 2026-07-31 — the assistant no
  // longer creates or onboards organizations (it would need to switch the active org, which it must
  // not do on its own). Labels dropped with the tools.
  switch_to_agency_account: "Converting to an agency account…",
};
// Fallback is deliberately generic — never expose a raw tool name for an unmapped/new tool.
const thinkingLabel = (tool) => THINKING_LABELS[tool] ?? "Working on it…";

// ── HITL (Tier 3) — pause/resume for mutating actions ─────────────────────────
// The Flowise "write" customMCP entry has Require-Human-Input ON, so Flowise pauses before a
// write tool runs and emits an `action` event (ending the stream). We turn that into an approval
// card; the card's Approve/Reject buttons send these sentinels, which the NEXT /chat POST
// converts to a Flowise `humanInput` resume against the agent node. Manual-approval only in this
// build every write PAUSES in Flowise; AUTO mode resumes non-destructive ones gateway-side (3C-6).
const AGENT_NODE_ID = process.env.AGENT_NODE_ID ?? "agentAgentflow_0";
const HITL_PROCEED = "__dk_hitl_proceed__";
const HITL_REJECT = "__dk_hitl_reject__";

// ── Auto-approval policy (3C-6, hardened 3.5) ─────────────────────────────────
// In AUTO mode a paused write may resume without a card — but ONLY when the tool is provably
// a non-destructive WRITE. The policy is derived from the MCP's OWN tool annotations, fetched
// once and cached, so there is no drift-prone name list to maintain. "auto" now requires the
// EXPLICIT write signature (readOnlyHint === false AND destructiveHint === false): read tools
// (readOnlyHint true) and anything without explicit annotations map to "confirm", so a
// misattributed pending tool (see the `outstanding` map) can never silently resume a write it
// wasn't.
// On top of the annotations, ALWAYS_CONFIRM lists tools whose side effects leave the account
// (payments; outbound invitation emails; privilege grants) — those card even in auto mode.
// Any uncertainty (fetch failure, unknown tool) FAILS CLOSED to the manual card.
// BELT (owner rule, not annotation-derived): ANY delete_* tool cards in BOTH modes, whatever the
// MCP's annotations say. Deletion is the one class of action a wrong auto-approve cannot undo, so
// it does not get to depend on a remote annotation staying correct.
// Added 2026-07-31 after the agency/settings audit — each of these matches the rule above
// ("side effects that leave the account") yet was annotated non-destructive, so auto mode ran it
// with no card at all:
//   share_agency_template / unshare_agency_template — change what OTHER organizations can see.
//   set_verification_skip — flips a paid address-verification decision the user made deliberately.
//   remove_invalid_addresses / remove_duplicate_addresses — permanently prune a PAID mailing list
//     (owner decision 2026-07-31: always card, rather than auto with a receipt).
// The other two invitation-email tools that belonged here — create_client_organization and
// complete_org_onboarding — were REMOVED from the assistant entirely instead (same date), so they
// need no gate. invite_user / edit_user_access below remain the email-sending tools that stay.
const ALWAYS_CONFIRM = new Set([
  "set_default_payment_method",
  "invite_user",
  "edit_user_access",
  "share_agency_template",
  "unshare_agency_template",
  "set_verification_skip",
  "remove_invalid_addresses",
  "remove_duplicate_addresses",
]);
const MAX_AUTO_RESUMES = 5; // per turn — runaway-loop backstop
let toolSafetyCache = null; // Map<tool, "auto"|"confirm">
let toolSafetyFetchedAt = 0;
let toolSafetyInFlight = null; // concurrent cold-start turns share one fetch
const TOOL_SAFETY_TTL_MS = 10 * 60_000;
async function refreshToolSafety() {
  try {
    const r = await fetch(`${ASSISTANT_MCP_URL}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      signal: AbortSignal.timeout(5000),
    });
    const text = await r.text();
    const m = text.match(/data: (.*)/);
    const parsed = JSON.parse(m ? m[1] : text);
    const map = new Map();
    for (const t of parsed?.result?.tools ?? []) {
      const ann = t?.annotations ?? {};
      map.set(t.name, ann.readOnlyHint === false && ann.destructiveHint === false ? "auto" : "confirm");
    }
    if (map.size) { toolSafetyCache = map; toolSafetyFetchedAt = Date.now(); }
    else console.warn("[/chat] tool-safety fetch returned no tools (failing closed to manual)");
  } catch (e) {
    console.warn("[/chat] tool-safety fetch failed (failing closed to manual):", e.message);
  }
}
async function isAutoApprovable(tool) {
  if (!tool || ALWAYS_CONFIRM.has(tool)) return false;
  if (/^delete_/.test(tool)) return false; // deletes always card, in BOTH modes (belt, see above)
  const stale = Date.now() - toolSafetyFetchedAt > TOOL_SAFETY_TTL_MS;
  if ((!toolSafetyCache || stale) && ASSISTANT_MCP_URL) {
    toolSafetyInFlight ??= refreshToolSafety().finally(() => { toolSafetyInFlight = null; });
    await toolSafetyInFlight;
  }
  return toolSafetyCache?.get(tool) === "auto"; // unknown/unfetched → false → card
}
// ── Post-write refresh signal (bug-bash 2026-07-24, Nami's TOOL_RESOURCES pattern) ────────────
// When a write tool SUCCEEDS, the app screens showing that data are now stale. Each mutating
// tool maps to the frontend resource scopes it dirties; scopes accumulate across the turn and
// ONE {type:"refresh", resources:[...], ids:{...}} frame is emitted before `done` — the widget
// invalidates exactly those (react-query keys / redux thunks / screen-level refetch events).
// Read tools are absent deliberately (no signal). Ids let detail screens refetch the one record.
const TOOL_RESOURCES = {
  create_referral: ["referrals"],
  update_referral: ["referrals"],
  delete_referral: ["referrals"],
  delete_referral_image: ["referrals"],
  mark_notification: ["notifications"],
  clear_notification: ["notifications"],
  clear_notifications: ["notifications"],
  update_organization: ["organization"],
  update_profile: ["organization"],
  set_default_payment_method: ["organization"],
  create_campaign: ["campaigns"],
  update_campaign: ["campaigns"],
  delete_campaign: ["campaigns"],
  create_address_list_campaign: ["campaigns"],
  remove_invalid_addresses: ["campaigns"],
  remove_duplicate_addresses: ["campaigns"],
  delete_addresses: ["campaigns"],
  set_verification_skip: ["campaigns"],
  duplicate_template_bundle: ["templates"],
  update_template_settings: ["templates"],
  delete_template_bundle: ["templates"],
  share_agency_template: ["templates"],
  unshare_agency_template: ["templates"],
  update_branding_theme: ["branding", "organization"],
  remove_company_logo: ["branding", "organization"],
  invite_user: ["team"],
  edit_user_access: ["team"],
  revoke_user_access: ["team"],
  update_agency_settings: ["organization"],
  // `agency_enabled` is a DEDICATED signal, not just an org refetch: converting to an agency flips
  // active_organization_id, multi_org_enabled and is_super_admin server-side, and the app must run
  // the same post-switch sequence it runs for its own sidesheet (rehydrate auth → refresh
  // appContent → land on the agency overview). A generic "organization" refetch would leave the
  // user on a business-menu page whose active org no longer exists. See
  // AgencyEnabledCoordinator on the frontend.
  switch_to_agency_account: ["organization", "agency_enabled"],
};
// A write "succeeded" when its result parses without an error/denial marker. Tool results are
// compact JSON — an {error}/{missing_required}/{role_restricted} result means nothing changed.
// Exported for tests: this predicate decides whether a refresh frame is emitted and whether a
// cut-off retry is considered safe, so a wrong answer here is either a stale screen or a repeated
// write. Its `blocked` handling matters now that tools return structured refusals.
export function toolSucceeded(outText) {
  // `blocked` and `verified: false` were added 2026-07-31 when tools started refusing with a
  // structured envelope and verifying their writes. Those envelopes carry NO `error` key, so
  // without them here a refused or unapplied write counted as a SUCCESS: the gateway emitted a
  // data-refresh frame for a change that never happened and left sawFailedWrite false, which also
  // feeds the cut-off retry's choice of strategy.
  try {
    const parsed = JSON.parse(outText);
    if (parsed?.blocked || parsed?.verified === false) return false;
    return !(parsed?.error || parsed?.missing_required || parsed?.role_restricted);
  } catch {
    const head = outText.slice(0, 400);
    if (/"(blocked)"/.test(head) || /"verified"\s*:\s*false/.test(head)) return false;
    return !/"(error|missing_required|role_restricted)"/.test(head);
  }
}

// Durable stand-in text persisted for a turn that produced a generative-UI surface but NO answer
// text, so the turn still gets a chat_messages row and survives a reload (otherwise the response
// would exist only in-memory / the browser's surface cache and vanish on the next full reload —
// the "AI responses disappear from history" report). MUST match the frontend DoorKnockerChat
// constant of the same value so the browser's cached surface re-attaches to this row on reload.
const UI_SURFACE_NOTE = "Here's what I found:";
// Stand-in for a turn that ended by PAUSING for approval (no reply text, no emit_ui card —
// the approval card is gateway-built). Without it the turn persisted only the user row, so a
// reload showed a question with no response. The persisted perm_ surface (WS2) carries the
// card itself; this line keeps the text history coherent next to it.
const APPROVAL_NOTE = "Waiting for your approval on that action.";
// Approval-card copy. The title is ONE line in the owner's voice, composed WITH the target
// ("Creating campaign Spring Mailer") instead of a generic sentence plus a separate quoted
// "Target:" line — the two-line version read like a form field and buried the thing being acted
// on. `t` = gerund phrase that takes a target; `b` = the target-less fallback. Entries with only
// `b` describe actions whose scope is implicit (all notifications, the selected addresses) and
// must NEVER compose a target, since the args' name-ish fields would misdescribe them.
const PERM_ACTIONS = {
  create_referral: { t: "Creating a referral for", b: "Creating a new referral" },
  update_referral: { t: "Updating referral", b: "Updating this referral" },
  delete_referral: { t: "Deleting referral", b: "Deleting this referral" },
  delete_referral_image: { t: "Deleting image", b: "Deleting this image" },
  mark_notification: { t: "Updating notification", b: "Updating a notification" },
  clear_notification: { t: "Clearing notification", b: "Clearing a notification" },
  clear_notifications: { b: "Clearing all notifications" },
  update_organization: { t: "Updating organization", b: "Updating your organization details" },
  update_profile: { t: "Updating your profile name to", b: "Updating your profile" },
  set_default_payment_method: { b: "Setting your default payment method" },
  create_campaign: { t: "Creating campaign", b: "Creating a new campaign" },
  create_address_list_campaign: { t: "Creating campaign", b: "Creating a new campaign" },
  update_campaign: { t: "Updating campaign", b: "Updating this campaign" },
  delete_campaign: { t: "Deleting campaign", b: "Deleting this campaign" },
  remove_invalid_addresses: { b: "Excluding every invalid address" },
  remove_duplicate_addresses: { b: "Excluding every duplicate address" },
  delete_addresses: { b: "Removing the selected addresses" },
  set_verification_skip: { b: "Changing the address-verification preference" },
  duplicate_template_bundle: { t: "Duplicating design as", b: "Duplicating this design" },
  update_template_settings: { t: "Updating design", b: "Updating this design's settings" },
  delete_template_bundle: { t: "Deleting design", b: "Deleting this design" },
  share_agency_template: { t: "Sharing design", b: "Sharing this design with clients" },
  unshare_agency_template: { t: "Stopping the sharing of", b: "Stopping sharing this design" },
  update_branding_theme: { b: "Updating your branding theme" },
  remove_company_logo: { b: "Removing your company logo" },
  invite_user: { t: "Inviting", b: "Sending this team invitation" },
  edit_user_access: { t: "Changing access for", b: "Changing this member's access" },
  revoke_user_access: { t: "Removing access for", b: "Removing this member's access" },
  update_agency_settings: { b: "Updating your agency settings" },
  switch_to_agency_account: { b: "Converting your account to an agency" },
};
// The human-readable TARGET of a pending action, pulled from the tool args the model sent.
// Composed into the approval title so the user approves a NAMED thing — a wrong-target delete once
// slipped through because the card showed only "Delete this campaign" with no name. Ids are
// never shown; only name-like fields qualify.
const TARGET_ARG_KEYS = ["name", "campaign_name", "referrer_name", "new_name", "agency_name", "business_name", "email", "description"];
// A `description` is prose, not a name — fine inside a thinking label, but it turns the card title
// into a paragraph, so titles compose from the name-ish keys only.
const TITLE_ARG_KEYS = TARGET_ARG_KEYS.filter((k) => k !== "description");
// Unmapped/new tool: a generic line. NEVER interpolate the raw tool name onto a user-facing card.
const PERM_FALLBACK_TITLE = "Confirming this action";
const actionTarget = (args, keys = TARGET_ARG_KEYS) => {
  if (!args || typeof args !== "object") return null;
  for (const k of keys) {
    const v = args[k] ?? args?.home_owner_info?.[k];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 80);
  }
  return null;
};
// A truncated target keeps an ellipsis, so a clipped name never reads as the whole name on a card
// the user is about to approve.
const TITLE_TARGET_MAX = 60;
const capTarget = (raw) => {
  const t = String(raw).replace(/\s+/g, " ").trim();
  return t.length > TITLE_TARGET_MAX ? `${t.slice(0, TITLE_TARGET_MAX).trimEnd()}…` : t;
};
const permissionTitle = (tool, args) => {
  const entry = PERM_ACTIONS[tool];
  if (!entry) return PERM_FALLBACK_TITLE;
  const raw = entry.t ? actionTarget(args, TITLE_ARG_KEYS) : null;
  const target = raw ? (capTarget(raw) || null) : null;
  return target ? `${entry.t} ${target}` : (entry.b ?? PERM_FALLBACK_TITLE);
};
// An auto-approved step is the ONLY notice the user gets that a write ran without a card, so it
// names what was touched ("Creating the campaign — Spring Mailer…") instead of the bare label.
// The target is raw MODEL-supplied args, so it goes through clean() like any other user-visible
// string — an id-shaped value would otherwise reach the transcript un-redacted. Same b-only rule
// as the approval titles: a tool whose copy takes no target never composes one here either.
const labelWithTarget = (tool, args) => {
  const base = thinkingLabel(tool).replace(/…$/, "");
  const entry = PERM_ACTIONS[tool];
  const raw = entry && !entry.t ? null : actionTarget(args);
  const target = (clean(raw ?? "") || "").trim() || null;
  return target ? `${base} — ${target}…` : `${base}…`;
};
// Plain Approve/Reject card for non-charging writes (charging actions get a cost+checkbox
// variant in Phase 3B). Rendered through the same GenUI catalog the read tools use, so the
// frontend's existing perm_-surface handling (retract on click, exclude from history) applies.
// A card must state consequences the title cannot carry. `delete_referral` cascades to every
// campaign linked to the referral (campaigns.referral_id is ON DELETE CASCADE, which chains on to
// targeting zones, analytics and postcard-send history), and the tool now requires the agent to
// acknowledge that count in its ARGS — so the card can state it deterministically instead of relying
// on the model to have mentioned it. Previously this card read only "Deleting referral <name>".
const permissionConsequence = (tool, args) => {
  if (tool === "delete_referral") {
    const n = Number(args?.confirm_delete_campaigns ?? 0);
    if (Number.isFinite(n) && n > 0) {
      return `This also permanently deletes ${n} linked campaign${n === 1 ? "" : "s"}, including their targeting, analytics and postcard-send history.`;
    }
  }
  return null;
};
const buildApprovalCard = (actionId, sessionId, tool, args, otherTitles = []) => {
  // More than one write was still pending when Flowise paused — name the others so approving
  // this card is never a blind yes to something the user can't see.
  const others = (otherTitles ?? []).filter((s) => typeof s === "string" && s.trim());
  const alsoLine = others.length ? `Also pending: ${others.join("; ")}.` : null;
  // NO IDENTITY → NO APPROVE (owner rule, 2026-07-31). A card that cannot name what it is asking
  // about must never carry an Approve button: the user was being asked to authorise a write the
  // gateway itself could not identify, which is consent in name only. The card is still shown —
  // `sawPermission` drives `awaiting_approval`, so returning nothing would lock the composer with
  // an empty screen — but its only action is to cancel, and the model is told to re-declare.
  const identified = !!(tool && PERM_ACTIONS[tool]);
  const consequence = identified ? permissionConsequence(tool, args) : null;
  const title = identified ? permissionTitle(tool, args) : "I couldn't confirm what this would change";
  const caption = identified
    ? "Approve to run it, or reject to cancel."
    : "Nothing has run. Cancel this and ask me again, and I'll re-check before doing anything.";
  return cleanUiFrame({
    type: "ui",
    // A fresh id when Flowise omits its action id — NEVER the session id. Falling back to the
    // session made every approval card in a conversation share one chat_surfaces row, so card #2's
    // persist overwrote card #1's recorded Approve/Reject and a reload re-armed a decision the user
    // had already made (which, per the resume path's own warning, risks double-executing it).
    surface_id: `perm_${actionId ?? randomUUID()}`,
    mode: "replace",
    root: "perm-card",
    components: [
      { id: "perm-card", component: { Card: { title: identified ? "Approval needed" : "Cancelled for safety", children: ["perm-title", ...(consequence ? ["perm-consequence"] : []), "perm-cap", ...(alsoLine ? ["perm-others"] : []), "perm-row"] } } },
      { id: "perm-title", component: { Text: { text: title, variant: "subtitle" } } },
      ...(consequence ? [{ id: "perm-consequence", component: { Text: { text: consequence } } }] : []),
      { id: "perm-cap", component: { Text: { text: caption, variant: "caption" } } },
      ...(alsoLine ? [{ id: "perm-others", component: { Text: { text: alsoLine, variant: "caption" } } }] : []),
      { id: "perm-row", component: { Row: { children: [...(identified ? ["perm-approve"] : []), "perm-reject"], gap: "sm" } } },
      ...(identified
        ? [{ id: "perm-approve", component: { Button: { label: "Approve", tone: "primary", action: { type: "send", display: "Approved", prompt: HITL_PROCEED } } } }]
        : []),
      { id: "perm-reject", component: { Button: { label: identified ? "Reject" : "Cancel", tone: "ghost", action: { type: "send", display: identified ? "Rejected" : "Cancelled", prompt: HITL_REJECT } } } },
    ],
    data_model: {},
  });
};

// ── continuation re-POSTs (retry D-after-write, retry E) ──────────────────────
// Two situations need the model to CONTINUE rather than answer the original question again:
// a stream that died mid-sentence AFTER a write already ran (re-asking would redo the write), and
// a reply that announced an action and stopped without running it. Both re-POST with the original
// question swapped for an instruction; neither ever repeats a completed action.
const CONTINUE_CUTOFF_PROMPT = "Continue your previous reply from where it was cut off. Do not repeat anything you already wrote, and do not repeat any action you already completed.";
const CONTINUE_NUDGE_PROMPT = "Continue: carry out the action you just said you would, using your tools, in this reply. Do not repeat what you already wrote. If it turns out you cannot do it, say plainly what you need instead.";
// The worst failure mode QA still saw with tools bound and no leak marker: the model writes
// "I'll create that campaign now." and STOPS, leaving the user holding a promise nothing ran.
// This predicate reads the FLUSHED reply and decides whether the turn ended on an UNFULFILLED
// first-person commitment. Deliberately narrow — a question, a hand-back, a request for missing
// information, or anything made conditional on the user VETOES it, because nudging over a genuine
// hand-back would talk past the user. Only the last TWO sentences are considered (the commitment
// is often followed by one trailing caveat), and the commitment must be first-person and imminent:
// "we'll"/"you'll" and past tense ("I've created") are not commitments to act now.
const NUDGE_COMMIT_RE = /\b(?:I['’]?ll|I will|I['’]?m going to|I am going to|Let me|One moment|Give me a (?:sec|second|moment)|Hang tight)\b/i;
// An action verb must follow the commitment ("I'll create…"), not merely appear somewhere. The
// leading \b is load-bearing: unanchored, "budget" supplied "get" and "unchanged" supplied "chang",
// so "I'll leave the budget as it is." read as a promise to act. Stems still match every
// inflection ("creat" → creating/created) because the boundary is only at the START.
// `set up` allows an intervening object because the natural phrasing is "set it up" / "set that
// up" / "set the campaign up", none of which contain the literal "set up" — so "I'll set it up."
// silently failed this test and the promise was never chased (found by the F2 unit tests,
// 2026-07-31). Same for the other particle verbs below.
const NUDGE_VERB_RE = /\b(?:creat|set(?:\s+\w+){0,2}\s+up|updat|edit|chang|renam|delet|remov|exclud|launch|send|add|duplicat|shar|invit|upload|generat|build|sav|submit|verif|schedul|mark|clear|switch|convert|pull(?:\s+\w+){0,2}\s+up|look(?:\s+\w+){0,2}\s+up|fetch|retriev|list|show|open|find|search|check|get)/i;
// Named so a veto can be logged and tuned (see the near-miss warning in the handler).
// /\bwait/i covers "wait" and "waiting"; the apostrophe classes cover the curly variant.
const NUDGE_VETOES = [
  ["question", /\?/],
  ["let me know", /let me know/i],
  ["know if", /know if/i],
  ["wait", /\bwait/i],
  ["hold off", /hold off/i],
  ["stand by", /stand by/i],
  ["check with", /check with/i],
  ["check back", /check back/i],
  ["if you …", /if you (?:want|need|['’]d like|would like)/i],
  ["once you", /once you/i],
  ["when you", /when you/i],
  ["after you", /after you/i],
  ["as soon as", /as soon as/i],
  ["unless", /unless/i],
  ["i need", /\bi need/i],
  ["i'll need", /\bi['’]?ll need/i],
  ["need <object>", /need (?:you|your|the|a|an|more)/i],
  ["would you like", /would you like/i],
  ["do you want", /do you want/i],
  ["which one/of", /which (?:one|of)/i],
  ["feel free", /feel free/i],
  ["i'll be here", /\bi['’]?ll be here/i],
  ["leave it/that", /leave (?:it|that)/i],
  ["keep it/that", /keep (?:it|that)/i],
  ["explain", /explain/i],
  ["walk you through", /walk you through/i],
  ["no changes", /no changes/i],
];
// → { trigger, veto, tail }. `veto` is set ONLY when a commitment + action verb DID match but a
// veto phrase overrode it — i.e. exactly the near-miss worth logging for tuning.
export function announceNudgeCheck(reply) {
  const text = String(reply ?? "").trim();
  // An unfinished sentence is the cut-off retry's business, not this one; a trailing question is
  // the model waiting on the user by definition.
  if (!text || !/[.!…]$/.test(text)) return { trigger: false, veto: null, tail: "" };
  const tail = text.split(/(?<=[.!?…])\s+/).slice(-2).join(" ");
  const commit = tail.match(NUDGE_COMMIT_RE);
  if (!commit) return { trigger: false, veto: null, tail };
  if (!NUDGE_VERB_RE.test(tail.slice(commit.index))) return { trigger: false, veto: null, tail };
  for (const [name, re] of NUDGE_VETOES) {
    if (re.test(tail)) return { trigger: false, veto: name, tail };
  }
  return { trigger: true, veto: null, tail };
}

// ── leak filters + redaction (Tier 2) ─────────────────────────────────────────
// Flowise synthesizes "Attempting to use tool…" text around tool pauses, and
// deepseek can leak raw tool markup; strip both plus any literal emit_ui markup.
// "<｜DSML｜" is listed alongside the bare marker so the opening "<" is swallowed too — with
// only the bare form, a lone "<" streamed to the user right before the marker matched.
const LEAK_MARKERS = ["Attempting to use tool", "<｜DSML｜", "｜DSML｜", "<emit_ui", "<emitui"];
const KEEP_BACK = Math.max(...LEAK_MARKERS.map((m) => m.length)) - 1;
// De-dash prose without mangling data: numeric ranges keep a plain hyphen ("$5—10" → "$5-10");
// only prose em/en-dashes become ", ".
const deDash = (s) => s
  .replace(/(\d)\s*[—–]\s*(\d)/g, "$1-$2")
  .replace(/\s*—\s*/g, ", ")
  .replace(/\s+–\s+/g, ", ");
// Redact infra strings the model must never surface: service hosts, api paths, EVERY tool-name
// shape (read + write + agency prefixes — not just reads), and bare UUIDs (record ids are for
// tools only; prompt discipline is the first line, this is the backstop).
const TOOL_NAME_RE = /\b(?:get|list|search|emit|create|update|delete|remove|clear|mark|duplicate|share|unshare|invite|edit|revoke|switch|complete|set)_[a-z][a-z_]+\b/g;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const redact = (s) => s
  .replace(/https?:\/\/[^\s)\]]*run\.app[^\s)\]]*/gi, "our system")
  .replace(/https?:\/\/[^\s)\]]*supabase\.co[^\s)\]]*/gi, "our system")
  .replace(/\/api\/v\d[^\s)\]]*/gi, "our system")
  .replace(TOOL_NAME_RE, "our system")
  .replace(UUID_RE, "")
  .replace(/[ \t]{2,}/g, " ");
const clean = (s) => redact(deDash(s));

// GenUI frames are forwarded raw, so the same hygiene applies inside them — but ONLY to
// human-visible text fields. Non-visible fields (ids, urls, and especially Button `prompt`
// payloads, which are echoed back verbatim as the next turn's message) pass through UNTOUCHED —
// rewriting them would change what a click sends.
const VISIBLE_TEXT_KEYS = new Set(["text", "title", "label", "caption", "subtitle", "proceedLabel", "display"]);
const deepClean = (val, key) => {
  if (typeof val === "string") return VISIBLE_TEXT_KEYS.has(key) ? clean(val) : val;
  if (Array.isArray(val)) return val.map((v) => deepClean(v, key));
  if (val && typeof val === "object") {
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = deepClean(v, k);
    return out;
  }
  return val;
};
const cleanUiFrame = (frame) => deepClean(frame, null);

// ── inline emit_ui frames (Tier 2) ────────────────────────────────────────────
// emit_ui buffers its validated {type:"ui"} frame on the MCP's jobs side channel
// and returns a tiny {ui_job_id} ack; we drain the buffer onto the chat SSE.
// Dormant until emit_ui ships with the Stage-F catalog — a 404 here is a no-op.
// Returns the number of {type:"ui"} surfaces drained onto the stream (so the caller knows the turn
// produced a generative-UI surface even if no answer text streamed — see the persist logic).
// `emitUi` is the handler's emitSurface — it cleans, streams, AND records the frame for
// persistence (WS2), so every drained card lands in chat_surfaces too.
async function inlineJobEvents(jobId, userJwt, emitUi) {
  if (!ASSISTANT_MCP_URL) return 0;
  let uiCount = 0;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(`${ASSISTANT_MCP_URL}/jobs/${jobId}/events`, {
      headers: { Authorization: `Bearer ${userJwt}` },
      signal: ctrl.signal,
    });
    if (!r.ok || !r.body) { clearTimeout(timer); return 0; }
    const rd = r.body.getReader();
    const dec = new TextDecoder();
    let jbuf = "";
    while (true) {
      const { done, value } = await rd.read().catch(() => ({ done: true }));
      if (done) break;
      jbuf += dec.decode(value, { stream: true });
      const jlines = jbuf.split("\n");
      jbuf = jlines.pop() ?? "";
      for (const jl of jlines) {
        const t = jl.trim();
        if (!t.startsWith("data:")) continue;
        let frame;
        try { frame = JSON.parse(t.slice(5)); } catch { continue; }
        if (frame.type === "ui") { emitUi(frame); uiCount++; }
      }
    }
    clearTimeout(timer);
  } catch { /* buffered-frame fetch is best-effort */ }
  return uiCount;
}

// ── live-context prefetch (Tier 2 latency) ────────────────────────────────────
// Instead of instructing the model to CALL get_live_context (a full extra model
// round-trip, ~10-20s), the gateway pulls the same blocks from the MCP's
// /live-context endpoint (~0.5-1.5s of parallel edge calls) and injects them into
// the question. Best-effort: any failure falls back to the old tool-call preamble.
async function fetchLiveContext(ctx, userJwt) {
  if (!ASSISTANT_MCP_URL) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(`${ASSISTANT_MCP_URL}/live-context`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userJwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        page: ctx.page,
        campaign_id: ctx.campaign_id,
        template_id: ctx.template_id,
        zone_id: ctx.zone_id,
        referral_id: ctx.referral_id,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const data = await r.json();
    if (!data?.userContextBlock || !data?.liveStateBlock) return null;
    return data;
  } catch {
    return null; // prefetch is best-effort; the tool-call preamble covers the miss
  }
}

// ── chat persistence (keeps the existing history sidebar working) ─────────────
// Title = first user message, truncated with an ellipsis (chatKabuki's variant).
function deriveTitle(message) {
  const m = (message ?? "New chat").trim() || "New chat";
  return m.length > 60 ? m.slice(0, 60).trimEnd() + "…" : m;
}
async function createSession(sessionId, userId, firstMessage) {
  await adminSupabase.from("chat_sessions").insert({
    id: sessionId, user_id: userId, title: deriveTitle(firstMessage),
  });
}

// The composer appends "[attachment held in browser: name (kind, NNKB) — …]" marker lines to
// the outgoing prompt (the file itself never leaves the browser). Strip them from the PERSISTED
// user text (so reloaded history shows what the user typed, not the plumbing) and keep the
// metadata for chat_messages.attachment so the chips re-render on reload.
const ATTACHMENT_MARKER_RE = /\n?\[attachment held in browser: (.+?) \((image|csv), (\d+)KB\)[^\]]*\]/g;
function splitAttachmentMarkers(text) {
  if (!text) return { text: text ?? null, attachment: null };
  const attachment = [];
  const stripped = text
    .replace(ATTACHMENT_MARKER_RE, (_, name, kind, kb) => {
      attachment.push({ name, kind, size: Number(kb) * 1024 });
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!attachment.length) return { text, attachment: null };
  return { text: stripped || text, attachment };
}

// WS2 (Tier 3.5): persist the FULL turn — user row (+ attachment metadata), assistant row
// (+ ordered thinking labels), and every GenUI surface (upsert by (session_id, surface_id), so
// a re-emit replaces in place; interaction reset to null on re-emit, resolved later by the
// click-time UPDATE in the handler). A reloaded conversation now renders from the DB alone —
// the browser's localStorage surface cache is retired. Returns the assistant row's id (streamed
// in the done frame so the frontend can attach per-message feedback immediately).
// The extras inserts retry WITHOUT the new columns if they fail (e.g. gateway deployed ahead of
// the migration) — a schema gap must never cost the text history.
async function persistTurn(sessionId, userMessage, assistantReply, extras = {}) {
  const { thinking = [], surfaces = [], attachment = null, turnId = null } = extras;
  // D5: stamp the turn id on the assistant row so a persisted reply can be joined to the gateway
  // log lines and the LangSmith/Langfuse trace for the same turn. Additive and nullable — a
  // deployment running ahead of the migration just inserts without it (see the retry below).
  const stamp = turnId ? { turn_id: turnId } : {};
  let assistantId = null;
  if (userMessage) {
    const base = { session_id: sessionId, role: "user", content: userMessage, ...stamp };
    const { error } = await adminSupabase.from("chat_messages")
      .insert(attachment?.length ? { ...base, attachment } : base);
    if (error) {
      console.error("[/chat] user-row insert failed (retrying without optional columns):", error.message);
      await adminSupabase.from("chat_messages").insert({ session_id: sessionId, role: "user", content: userMessage });
    }
  }
  if (assistantReply) {
    const base = { session_id: sessionId, role: "assistant", content: assistantReply, ...stamp };
    let { data, error } = await adminSupabase.from("chat_messages")
      .insert(thinking.length ? { ...base, thinking } : base)
      .select("id").single();
    if (error) {
      // Fall back through the OPTIONAL columns rather than losing the row: thinking first, then the
      // turn stamp (which is absent until the 20260803 migration runs). The reply itself is the part
      // the user reloads, so it must survive either column being unavailable.
      console.error("[/chat] assistant-row insert failed (retrying without optional columns):", error.message);
      ({ data } = await adminSupabase.from("chat_messages")
        .insert({ session_id: sessionId, role: "assistant", content: assistantReply })
        .select("id").single());
    }
    assistantId = data?.id ?? null;
  }
  if (surfaces.length) {
    const now = new Date().toISOString();
    // DEDUPE BY surface_id, keeping the LAST emission (2026-07-31). One turn can legitimately emit
    // the same surface_id twice — a recovery re-POST re-running emit_ui, or a revised card replacing
    // its earlier render. Passing both to one bulk upsert is a hard Postgres error (SQLSTATE 21000,
    // "ON CONFLICT DO UPDATE command cannot affect row a second time"), which aborts the ENTIRE
    // statement: every card from that turn silently vanishes on reload, with nothing but a
    // "surface persist failed" line to show for it. Last-wins matches what the user was left
    // looking at.
    const bySurface = new Map();
    for (const s of surfaces) bySurface.set(s.surface_id, s);
    const deduped = [...bySurface.values()];
    if (deduped.length !== surfaces.length) {
      console.warn(`[/chat] collapsed ${surfaces.length - deduped.length} duplicate surface_id row(s) before persisting`);
    }
    // D4: `interaction` and `state` are DELIBERATELY absent from this payload. They used to be
    // written as `interaction: null`, so re-emitting a surface_id ERASED the user's recorded Approve
    // and the reloaded conversation handed them a fresh, actionable copy of a card they had already
    // acted on. An upsert must only ever replace what this turn actually produced — the frame, its
    // order and its owning message — never the record of what the USER did with it.
    const rows = deduped.map((s) => ({
      session_id: sessionId,
      message_id: assistantId, // null on a pause-only turn — the frontend interleaves orphans by created_at
      surface_id: s.surface_id,
      frame: s.frame,
      seq: s.seq,
      updated_at: now,
    }));
    const { error } = await adminSupabase.from("chat_surfaces").upsert(rows, { onConflict: "session_id,surface_id" });
    if (error) console.error("[/chat] surface persist failed:", error.message);
  }
  return assistantId;
}

// ── the handler ───────────────────────────────────────────────────────────────
export async function chatHandler(req, res) {
  if (!chatConfigured) {
    res.status(503).json({ error: "Chat is not configured on this deployment" });
    return;
  }

  const auth = await authenticate(req);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }

  let { message } = req.body ?? {};
  const { session_id, context } = req.body ?? {};
  // Approval mode (3C-6): "auto" lets NON-DESTRUCTIVE writes resume without a card (surfaced as
  // auto-approved thinking steps); destructive/payment/account-level actions ALWAYS card,
  // regardless of mode. Anything other than the literal "auto" is manual (the default).
  const approvalMode = req.body?.mode === "auto" ? "auto" : "manual";
  // HITL resume: the approval card's Approve/Reject buttons send a sentinel as the message.
  // Convert it to a Flowise humanInput {proceed|reject} and drop the message so this turn resumes
  // the paused write instead of starting a new one.
  let human_input = null;
  if (message === HITL_PROCEED) { human_input = { type: "proceed" }; message = undefined; }
  else if (message === HITL_REJECT) { human_input = { type: "reject" }; message = undefined; }
  const isResume = !!human_input;
  const isReject = isResume && human_input.type === "reject";
  if (!isResume && (typeof message !== "string" || !message.trim())) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  // On resume there is no page/org context to inject — Flowise just continues the paused node.
  const ctx = isResume ? null : normalizeContext(context);

  // ── D5: one id per TURN ────────────────────────────────────────────────────
  // Every reported defect had to be reproduced by a person in a browser, because a turn left no
  // correlatable record: the gateway logs, the LangSmith/Langfuse trace and the persisted row shared
  // only a session id — and a session is many turns. This id is stamped on all three, so "show me
  // everything about that turn" becomes one grep and one trace filter.
  //
  // Deliberately minted BEFORE session validation, so a turn that fails early still has an id in its
  // logs. Nothing here logs message bodies or tool arguments — only shapes, names and counts.
  const turnId = randomUUID();
  const turnStartedAt = Date.now();
  /** One structured line per notable event, always carrying the turn id. Never include user data. */
  const turnLog = (event, fields = {}) => {
    console.log(JSON.stringify({ at: "chat", turn_id: turnId, event, ...fields }));
  };

  // Session: mint server-side on the first turn; on resume, verify OWNERSHIP
  // (chatKabuki's check — a session id that isn't this user's is a 404, G§4.6).
  let sessionId = session_id;
  let isNewSession = false;
  if (sessionId) {
    const { data: owned } = await adminSupabase
      .from("chat_sessions").select("id")
      .eq("id", sessionId).eq("user_id", auth.userId)
      .maybeSingle();
    if (!owned) { res.status(404).json({ error: "Session not found" }); return; }
  } else {
    sessionId = randomUUID();
    isNewSession = true;
  }

  // WS2: a GenUI card click carries its surface_id (+ optional {button_id, action, display}) —
  // mark that surface RESOLVED before streaming, so a reload from here on shows the card locked
  // with what the user chose instead of a fresh actionable card. HITL sentinels infer
  // approve/reject when the frontend didn't spell it out. Session-scoped, so a caller can only
  // resolve their own surfaces — ownership was just checked above.
  // Started EAGERLY here (it should overlap the turn, not delay it) but the promise is KEPT and
  // awaited before the done frame: fire-and-forget lost the write on short reject turns, where
  // Cloud Run froze/reclaimed the instance right after res.end() and the reloaded card came back
  // un-resolved ("Rejected" disappeared).
  const clickedSurfaceId = typeof req.body?.surface_id === "string" && req.body.surface_id ? req.body.surface_id : null;
  const surfaceUpdatePromise = clickedSurfaceId && !isNewSession
    ? (async () => {
      const given = (req.body?.interaction && typeof req.body.interaction === "object") ? req.body.interaction : {};
      const interaction = {
        resolved: true,
        ...(typeof given.button_id === "string" ? { button_id: given.button_id.slice(0, 80) } : {}),
        action: typeof given.action === "string" ? given.action.slice(0, 40) : (isResume ? (isReject ? "reject" : "approve") : "send"),
        ...(typeof given.display === "string" ? { display: given.display.slice(0, 200) }
          : isResume ? { display: isReject ? "Rejected" : "Approved" } : {}),
        resolved_at: new Date().toISOString(),
      };
      // D4: `state` is the part the browser could not remember. `interaction` records WHAT the user
      // did; `state: consumed` records THAT the surface is finished — and unlike the per-card React
      // flag it survives the widget unmounting (panel minimize AND route navigation both unmount it)
      // and the stream ending, which is what re-armed completed cards.
      const stamp = { interaction, state: "consumed", updated_at: new Date().toISOString() };
      let { error } = await adminSupabase.from("chat_surfaces")
        .update(stamp).eq("session_id", sessionId).eq("surface_id", clickedSurfaceId);
      if (error) {
        // The state column arrives with the 20260803 migration; a gateway running ahead of it must
        // still record the interaction rather than lose the click entirely.
        console.error("[/chat] surface state update failed (retrying without state):", error.message);
        ({ error } = await adminSupabase.from("chat_surfaces")
          .update({ interaction, updated_at: new Date().toISOString() })
          .eq("session_id", sessionId).eq("surface_id", clickedSurfaceId));
        if (error) console.error("[/chat] surface interaction update failed:", error.message);
      }
    })().catch((e) => console.error("[/chat] surface interaction update threw:", e?.message ?? e))
    : null;

  // ── D4: which surfaces in this session are already terminal ────────────────
  // Read once per turn (indexed on session_id, state) so emitSurface can refuse to re-arm one. The
  // just-clicked surface is seeded directly rather than read back: the resolution write above runs
  // CONCURRENTLY with this turn on purpose, so a query could easily miss it — and the one surface we
  // know for certain is consumed this turn is the one the user just clicked.
  const consumedSurfaces = new Map(); // surface_id -> display label (or null)
  if (clickedSurfaceId) {
    const given = (req.body?.interaction && typeof req.body.interaction === "object") ? req.body.interaction : {};
    consumedSurfaces.set(clickedSurfaceId, typeof given.display === "string" ? given.display.slice(0, 200)
      : isResume ? (isReject ? "Rejected" : "Approved") : null);
  }
  if (!isNewSession) {
    const { data: priorSurfaces, error: surfaceLoadError } = await adminSupabase
      .from("chat_surfaces").select("surface_id, interaction, state")
      .eq("session_id", sessionId).eq("state", "consumed");
    if (surfaceLoadError) {
      // Before the 20260803 migration the column does not exist. Degrade to the just-clicked surface
      // rather than failing the turn — that is still strictly better than the old behaviour.
      console.error("[/chat] consumed-surface load failed (continuing without it):", surfaceLoadError.message);
    } else {
      for (const row of priorSurfaces ?? []) {
        if (!consumedSurfaces.has(row.surface_id)) {
          consumedSurfaces.set(row.surface_id, row.interaction?.display ?? null);
        }
      }
    }
  }

  // SSE response — same headers/framing as namiGateway
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  const send = (frame) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(frame)}\n\n`);
  };

  // Abort the upstream Flowise call if the client disconnects (stop button, Esc, unmount).
  const upstreamAbort = new AbortController();
  res.on("close", () => upstreamAbort.abort());

  try {
    if (isNewSession) await createSession(sessionId, auth.userId, message);

    // Context injection — prefetch the live-context blocks and hand them to the
    // model WITH the message, so most turns need no get_live_context round-trip.
    // Prefetch failure falls back to the old tool-call preamble. Ids are for
    // tools only, never for display.
    // On resume, the "question" is just the proceed/reject signal; humanInput (below) carries the
    // real intent. On a normal turn it's the user's message with context prepended.
    let question = isResume ? (isReject ? "rejected" : "proceed") : message;
    if (ctx?.page) {
      const live = await fetchLiveContext(ctx, auth.userJwt);
      if (live) {
        question = `${live.userContextBlock}\n${live.liveStateBlock}\n\n[The blocks above were fetched from the user's account THIS turn — treat them exactly like tool results: you may state their numbers and names directly without calling tools. Only call get_live_context if something on-screen is missing above. Never show IDs to the user.]\n\n${message}`;
      } else {
        const bits = [`page=${ctx.page}`];
        for (const k of ["campaign_id", "template_id", "zone_id", "referral_id"]) {
          if (ctx[k]) bits.push(`${k}=${ctx[k]}`);
        }
        question = `[current screen: ${bits.join(", ")} — call get_live_context with these for on-screen data; never show IDs to the user]\n\n${message}`;
      }
    }

    // Org-awareness: tell the model which organization is active, and on a mid-chat switch have
    // it acknowledge the change and re-scope. Everything the agent reads is already scoped to
    // this org server-side; this keeps the model's framing correct (the chat is NOT reset).
    if (ctx?.organization?.name || ctx?.orgSwitched) {
      const orgName = ctx?.organization?.name ?? "the current organization";
      let orgLine = ctx?.organization?.name
        ? `[active organization: ${orgName}${ctx.organization.isAgency ? " (agency workspace)" : ""}]`
        : "";
      if (ctx?.orgSwitched) {
        const from = ctx.previousOrgName ? `from ${ctx.previousOrgName} ` : "";
        orgLine += `${orgLine ? "\n" : ""}[The user just switched organizations ${from}to ${orgName}. In your NEXT reply, briefly tell them you noticed the switch and are now answering about ${orgName}. Scope everything to ${orgName}; disregard other organizations' data from earlier in this chat. If they want another organization's data, tell them to switch to it.]`;
      }
      question = `${orgLine}\n\n${question}`;
    }

    const predictionBody = {
      question,
      streaming: true,
      chatId: sessionId,
      overrideConfig: {
        sessionId,
        // Observability (Nami's pattern): Flowise-native analytics — LangSmith + Langfuse
        // credentials live in Flowise, not here; we only attach runtime attributes so traces
        // thread per conversation and attribute per user. Langfuse auto-maps chatId →
        // sessionId for session grouping, but userId is not automatic — pass it explicitly.
        // LangSmith groups traces into threads via the session_id metadata key (propagated
        // to child runs by RunTree, so the whole turn carries it).
        // D5 threads turn_id into both providers, so a gateway log line and a trace can be joined.
        analytics: {
          langFuse: { userId: auth.userId, sessionId, metadata: { turn_id: turnId } },
          langSmith: {
            metadata: { session_id: sessionId, user_id: auth.userId, turn_id: turnId, mode: approvalMode, page: ctx?.page ?? "" },
            tags: [`mode:${approvalMode}`, `turn:${turnId}`, ctx?.organization?.id ? `org:${ctx.organization.id}` : "org:none"],
          },
        },
        // vars.userJwt feeds the Flowise customMCP header (Authorization: Bearer
        // {{$vars.userJwt}}); page/ids are available to the system prompt too.
        vars: {
          userJwt: auth.userJwt,
          // D5: available for the customMCP entries to forward as `X-DK-Turn: {{$vars.turnId}}`, which
          // is what lets the MCP's per-tool log lines join this turn. Owner-side Flowise change; the
          // MCP already reads the header and treats its absence as "unknown turn".
          turnId,
          page: ctx?.page ?? "",
          campaignId: ctx?.campaign_id ?? "",
          templateId: ctx?.template_id ?? "",
          zoneId: ctx?.zone_id ?? "",
          referralId: ctx?.referral_id ?? "",
        },
      },
    };
    // HITL resume: tell Flowise to continue the paused agent node with the user's decision. The
    // vars.userJwt above is the user's CURRENT token, so when Flowise resumes and finally runs the
    // gated write tool, its customMCP Authorization header carries a fresh, valid bearer.
    if (isResume) {
      predictionBody.humanInput = { type: human_input.type, startNodeId: AGENT_NODE_ID };
    }

    // ── Delta emitter (namiGateway pattern) ───────────────────────────────────
    // Buffers with a keep-back margin so split LEAK_MARKERS are still caught, cuts
    // only at whitespace (so redact() always sees complete URLs/identifiers), and
    // applies clean() = redact(deDash(…)) to everything emitted. On a marker hit,
    // everything from the marker on is suppressed for the rest of the turn.
    let pendingText = "";
    let assistantReply = "";
    let suppressRest = false;
    // Lazy paragraph seam: a continuation attempt (cut-off retry, announce nudge) wants a blank
    // line between what already streamed and what the new attempt writes — but only if the new
    // attempt actually writes something. Emitting "\n\n" up front left a dangling empty paragraph
    // whenever the retry produced nothing, so the seam is armed here and consumed by the FIRST
    // character the next attempt emits (through assistantReply too, so the persisted text matches).
    let pendingSeam = false;
    // ── Restatement dedupe (bug-bash 2026-07-24) ─────────────────────────────
    // The model intermittently RESTATES its reply from the beginning mid-turn (QA saw
    // "I'll create that referral now.I'll create that referral now." before an approval card).
    // Detector: after a sentence boundary, if the incoming stream starts re-emitting the reply
    // from its FIRST character, hold those chars; a complete restatement is dropped, any
    // divergence flushes the held text untouched (fail-open — never lose real words).
    // ── Restatement dedupe (generalized) ─────────────────────────────────────
    // The model intermittently re-emits a verbatim copy of text it already wrote — sometimes
    // the whole reply ("X.X"), sometimes just the last sentence or clause group, and the copy
    // can start mid-word-boundary with no separator ("…Creating the" + full restart,
    // "…nowDeleting …", "…permanentlyIt's …"). Every observed restatement is a verbatim copy
    // of a SUFFIX of the reply beginning at some sentence start. So: track recent sentence
    // starts as anchors; when an incoming char matches an anchor's first char, hold the stream
    // and advance ALL matching anchors in parallel; if any anchor's suffix is fully re-matched,
    // the held text was a restatement — drop it. Any divergence flushes the held text intact
    // (fail-open: real words are never lost, at worst briefly buffered).
    const SENT_END = new Set([".", "!", "?", "…", "\n"]);
    let sentenceStarts = [0];      // offsets in assistantReply where sentences begin (last 8)
    let pendingSentenceStart = false;
    let dupCands = null;           // active candidate refs (suffix snapshots) or null
    let dupPos = 0;                // chars matched so far across candidates
    let dupHeld = "";              // held-back candidate duplicate text
    const trackChar = (ch) => {
      if (SENT_END.has(ch)) { pendingSentenceStart = true; }
      else if (pendingSentenceStart && !/\s/.test(ch) && ch !== "\"" && ch !== "'" && ch !== "*") {
        sentenceStarts.push(assistantReply.length);
        if (sentenceStarts.length > 8) sentenceStarts = sentenceStarts.slice(-8);
        pendingSentenceStart = false;
      }
      assistantReply += ch;
    };
    // Consume an armed seam at the moment real text is about to be emitted (see pendingSeam).
    // Only ever called with a NON-whitespace next character: a continuation attempt that opens
    // with "\n" or " " would otherwise strand the seam as three blank lines. Also refuses when
    // there is nothing to separate from, so an armed seam can't start a reply with a blank line.
    const takeSeam = () => {
      if (!pendingSeam) return "";
      pendingSeam = false;
      if (!assistantReply.trim()) return "";
      trackChar("\n");
      trackChar("\n");
      return "\n\n";
    };
    const pushText = (out) => {
      let emit = "";
      for (const ch of out) {
        // Seam armed and not mid-hold: swallow the continuation's leading whitespace so the blank
        // line lands directly against its first real character.
        if (pendingSeam && !dupCands && /\s/.test(ch)) continue;
        if (dupCands) {
          const survivors = dupCands.filter((ref) => ref[dupPos] === ch);
          if (survivors.length) {
            dupCands = survivors;
            dupHeld += ch;
            dupPos += 1;
            if (survivors.some((ref) => ref.length === dupPos)) {
              console.warn("[/chat] dropped a verbatim restatement:", JSON.stringify(dupHeld.slice(0, 80)));
              dupCands = null; dupPos = 0; dupHeld = "";
            }
            continue;
          }
          // Divergence — real text; release the hold (and keep sentence tracking honest).
          emit += takeSeam();
          for (const h of dupHeld) trackChar(h);
          emit += dupHeld;
          dupCands = null; dupPos = 0; dupHeld = "";
          // fall through: process ch normally (it may itself start a new candidate)
        }
        const cands = [];
        if (assistantReply.length >= 16) {
          for (const a of sentenceStarts) {
            if (assistantReply[a] !== ch) continue;
            const ref = assistantReply.slice(a).replace(/\s+$/, "");
            if (ref.length >= 16) cands.push(ref);
          }
        }
        if (cands.length) {
          dupCands = cands;
          dupPos = 1;
          dupHeld = ch;
          continue;
        }
        emit += takeSeam();
        trackChar(ch);
        emit += ch;
      }
      if (emit) send({ delta: emit });
    };
    // Turn over while still matching: a completed match already dropped itself; a partial hold
    // is real text that happened to shadow an earlier sentence — release it.
    const dedupeFlush = () => {
      const held = dupHeld;
      dupCands = null; dupPos = 0; dupHeld = "";
      // Same whitespace rule as pushText: with a seam armed, the release must not open on
      // whitespace (and if the hold was ALL whitespace, the seam stays armed for real text).
      const body = pendingSeam ? held.replace(/^\s+/, "") : held;
      if (body) {
        const seam = takeSeam();
        for (const h of body) trackChar(h);
        send({ delta: seam + body });
      }
    };
    const earliestMarker = (s) => LEAK_MARKERS.map((m) => s.indexOf(m)).filter((i) => i !== -1).sort((a, b) => a - b)[0];
    const emitDelta = (chunk) => {
      if (suppressRest || !chunk) return;       // Flowise leads with empty token events
      pendingText += chunk;
      const hit = earliestMarker(pendingText);
      if (hit !== undefined) {
        if (pendingText.slice(hit).startsWith("Attempting to use tool")) sawToolLeak = true;
        const before = clean(pendingText.slice(0, hit).replace(/\s+$/, ""));
        if (before) pushText(before);
        pendingText = ""; suppressRest = true; return;
      }
      const safeEnd = pendingText.length - KEEP_BACK;
      if (safeEnd <= 0) return;
      const region = pendingText.slice(0, safeEnd);
      let cut = Math.max(region.lastIndexOf(" "), region.lastIndexOf("\n"), region.lastIndexOf("\t")) + 1;
      // Never cut right before an em/en dash: deDash must see "X — Y" in one piece — split
      // across fragments it rendered as "X , Y" (the swallowed space was already streamed).
      while (cut > 0 && /^\s*[—–]/.test(pendingText.slice(cut))) {
        const prev = Math.max(region.lastIndexOf(" ", cut - 2), region.lastIndexOf("\n", cut - 2), region.lastIndexOf("\t", cut - 2)) + 1;
        if (prev >= cut) { cut = 0; break; }
        cut = prev;
      }
      if (cut > 0) {
        pushText(clean(pendingText.slice(0, cut)));
        pendingText = pendingText.slice(cut);
      }
    };
    // Drain the marker holdback ONLY. emitDelta deliberately keeps the tail of the stream back (up
    // to KEEP_BACK chars, and never cuts mid-word) so clean()/deDash see whole constructs — which
    // means the tail of one generation is still sitting in pendingText when the next one starts, and
    // the two get concatenated in this buffer, upstream of every seam. Splitting this out of
    // flushDeltas lets a mid-turn boundary (D11) flush the text WITHOUT releasing the restatement
    // hold, since re-announcing after a tool result is exactly what that hold is watching for.
    const flushPendingText = () => {
      if (suppressRest || !pendingText) { pendingText = ""; return; }
      const hit = earliestMarker(pendingText);
      if (hit !== undefined && pendingText.slice(hit).startsWith("Attempting to use tool")) sawToolLeak = true;
      const out = clean(hit !== undefined ? pendingText.slice(0, hit).replace(/\s+$/, "") : pendingText);
      if (out) pushText(out);
      pendingText = "";
    };
    const flushDeltas = () => {
      flushPendingText();
      dedupeFlush();
    };

    // Raw upstream errors are logged, never forwarded (they read as a crash).
    const friendlyError = (raw) => {
      console.error("[/chat] turn error:", (typeof raw === "string" ? raw : JSON.stringify(raw ?? "")).slice(0, 600));
      return "Something went wrong on my end. Please try that again in a moment.";
    };
    let turnError = null;
    // Toolless-turn signature: Flowise intermittently runs the LLM with NO tools bound (MCP
    // tool-load failure / provider fallback) — the model then writes its tool calls as TEXT
    // ("Attempting to use tool: ```json…"). sawToolLeak marks that text; sawToolActivity marks
    // any REAL tool call/return. Leak with zero activity = the announced action never ran.
    let sawToolLeak = false;
    let sawToolActivity = false;
    // A write tool RAN and came back error/denied. The cut-off retry must not re-POST after that
    // (the model would narrate a success that never happened, or retry the write).
    let sawFailedWrite = false;
    // D8: what the model said about how the turn ended, if it called end_task. `null` means it did
    // not — which is the state every recovery heuristic below is currently forced to guess at.
    let endTask = null;
    // Shared budget across ALL the recovery re-POSTs below (error retry, toolless-leak retry,
    // cut-off retry, announce nudge). Each guard checked its own "once" flag before, so a
    // pathological turn could stack four extra upstream calls; the budget caps the whole turn.
    let extraAttempts = 0;
    const MAX_EXTRA_ATTEMPTS = 2;
    let g6Fired = false; // the announce nudge is once per turn, full stop
    // HITL: every tool Flowise has CALLED but not yet returned (tool → {tool, args}), and whether
    // this turn ended by pausing for approval (drives the done frame's awaiting_approval +
    // composer lock). A single pendingAction slot used to be enough, but the agent can call two
    // write tools in one iteration — the slot then held the LAST one, so a paused delete could be
    // judged (and silently auto-approved) under a co-called safe write's identity. The map keeps
    // EVERY outstanding candidate, and the `action` handler only auto-resumes when they ALL pass.
    const outstanding = new Map();
    let sawPermission = false;
    // Flowise's id for the most recent pause — the approval surface_id, so the orphaned-pause
    // backstop can card the SAME pause the auto-approval claimed.
    let lastActionId = null;
    // AUTO mode (3C-6): a pause on a non-destructive write sets this instead of carding; the
    // resume loop below re-POSTs with humanInput proceed. Capped per turn.
    let pendingAutoResume = false;
    let autoResumes = 0;
    // Whether this turn rendered a generative-UI surface (drives durable persistence of an
    // otherwise-textless card turn — see the persist logic below).
    let sawUi = false;
    // Post-write refresh signal accumulation (see TOOL_RESOURCES above).
    const refreshResources = new Set();
    const refreshIds = {};

    // ── attempt seam ──────────────────────────────────────────────────────────
    // Every re-POST of this turn (error retry, toolless-leak retry, each auto-resume iteration,
    // the cut-off retry, the announce nudge) goes through here, so the buffers are always left in
    // the same state. The old ad-hoc `pendingText = ""` DISCARDED the keep-back tail (up to 21 real
    // characters) at every seam — flushDeltas releases it instead (and releases any held dedupe
    // text). flushDeltas still respects suppressRest, so a leak-tripped tail stays dropped; only
    // the NEXT attempt gets a clean slate. sentenceStarts keeps exactly its LAST anchor: a full
    // reset would blind the dedupe to the cross-pause restatement it exists to catch, and the
    // anchor is an offset into the (ever-growing) assistantReply, which stays valid.
    // discardBuffer: for the ERROR-RETRY only. That guard is `turnError && !assistantReply`, so
    // nothing user-visible streamed and the buffer holds a sub-KEEP_BACK scrap of a failed attempt
    // — too short for the dedupe to have armed (it needs 16 chars), so flushing it would splice a
    // garbled fragment in front of the retry's answer. Every other seam flushes.
    const beginAttempt = ({ discardBuffer = false } = {}) => {
      if (!discardBuffer) flushDeltas();
      sentenceStarts = sentenceStarts.slice(-1);
      pendingSentenceStart = true;
      outstanding.clear();
      suppressRest = false;
      pendingText = "";
    };

    // WS2 capture: everything persistTurn stores alongside the text.
    // thinkingLabels — ordered progress labels (consecutive-duplicate collapsed, matching the
    // frontend's display dedupe). emittedSurfaces — every streamed {type:"ui"} frame INCLUDING
    // the perm_ approval card, size-capped so one pathological frame can't bloat the table.
    // A resumed stream REPLAYS the earlier iterations' calledTools events, so the same step would
    // be streamed again after every auto-resume (noteThinking only collapses CONSECUTIVE repeats).
    // Turn-scoped: an exact label is streamed at most once per turn.
    const streamedThinking = new Set();
    const thinkingLabels = [];
    const noteThinking = (label) => {
      if (label && label !== thinkingLabels[thinkingLabels.length - 1]) thinkingLabels.push(label);
    };
    const emittedSurfaces = [];
    let surfaceSeq = 0;
    const MAX_SURFACE_BYTES = 64 * 1024;
    const emitSurface = (frame) => {
      const cleanFrame = cleanUiFrame(frame);
      const id = typeof cleanFrame?.surface_id === "string" ? cleanFrame.surface_id : "";
      // ── D4: a consumed surface never comes back to life ─────────────────────
      // Once the user has acted on a surface_id it is terminal for the whole session. Re-emitting it
      // (a recovery re-POST re-running emit_ui, or the model reaching for the same id again) used to
      // hand the user a fresh, actionable copy of a card they had already used — the re-armed-card
      // defect. Stream it LOCKED with the outcome the user chose, so their words still line up with
      // what they see, and leave the recorded row alone: replacing it would overwrite the frame they
      // actually acted on.
      if (id && consumedSurfaces.has(id)) {
        const display = consumedSurfaces.get(id);
        turnLog("surface_consumed_reemit", { surface_id: id });
        send({ ...cleanFrame, resolved: { display: display ?? null } });
        return;
      }
      send(cleanFrame);
      if (id) {
        let size = 0;
        try { size = JSON.stringify(cleanFrame).length; } catch { size = MAX_SURFACE_BYTES + 1; }
        if (size <= MAX_SURFACE_BYTES) {
          emittedSurfaces.push({ surface_id: id, frame: cleanFrame, seq: surfaceSeq++ });
        } else {
          console.warn(`[/chat] surface ${id} over persist cap (${size}B) — streamed, not persisted`);
        }
      }
    };

    const seenJobIds = new Set();
    // Drain emit_ui frames referenced in a serialized blob. Tool outputs USED to arrive via
    // `usedTools` per iteration; the shared Flowise now emits usedTools only ONCE per turn, so
    // later iterations' outputs (where emit_ui usually runs) never surface there — the cards
    // silently vanished. `agentFlowExecutedData` still carries every node's output, so ui jobs
    // are extracted from BOTH paths, dedup'd by seenJobIds (draining twice is a no-op).
    // Escaping-agnostic: the id appears once-escaped in usedTools' toolOutput but DOUBLE-escaped
    // inside stringified agentFlowExecutedData (\\\"ui_job_id\\\") — so match the key name and
    // grab the next UUID, whatever quoting/backslash depth surrounds it.
    const UI_JOB_RE = /ui_job_id[^0-9a-f]{1,10}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
    const drainUiJobs = async (raw) => {
      for (const m of String(raw).matchAll(UI_JOB_RE)) {
        if (seenJobIds.has(m[1])) continue;
        seenJobIds.add(m[1]);
        const n = await inlineJobEvents(m[1], auth.userJwt, emitSurface);
        if (n > 0) sawUi = true;
      }
    };
    // A tool RETURNED (via either carrier — the once-per-turn usedTools event or a node's
    // agentFlowExecutedData output) → accumulate the data-change refresh signal. Returns the
    // stringified output for further scanning.
    const noteToolReturn = (t) => {
      const out = typeof t?.toolOutput === "string" ? t.toolOutput : JSON.stringify(t?.toolOutput ?? "");
      // ── D8: the model declaring how its turn ended ───────────────────────────
      // Captured here because noteToolReturn is the single funnel both carriers pass through (the
      // usedTools event AND each node's agentFlowExecutedData snapshot). The status comes from the
      // ARGUMENTS, not the tool's own ack: the ack is a constant, while the args are the claim.
      if (t?.tool === "end_task") {
        const args = t?.toolInput ?? {};
        endTask = {
          status: typeof args.status === "string" ? args.status.slice(0, 40) : null,
          summary: typeof args.summary === "string" ? args.summary.slice(0, 200) : null,
        };
      }
      // ── D11: the run-on defect is a SEAM, not a typography habit ─────────────
      // QA reported "…within reach.Let me…" and "…here's what to go:Launch…" in every multi-sentence
      // reply for four rounds. The model never omitted that space: an agent turn is several separate
      // generations (one per tool-calling iteration), each streamed as its own `token` frames, and
      // every one of them lands in the SAME pushText accumulator with nothing inserted between them.
      // The last character of iteration N abuts the first character of iteration N+1. `**A****B**`
      // (also reported) is the same boundary with bold markers either side of it.
      //
      // The prompt used to ask the model to "always put a space after sentence-ending punctuation",
      // which it cannot honour — it never saw the join. Fix it where the join happens, in two steps:
      //   1. flush the marker holdback, because the concatenation actually happens inside
      //      pendingText (emitDelta keeps the tail back, so iteration N's last words are still
      //      buffered when N+1 starts and the two are glued there, upstream of every seam);
      //   2. arm the paragraph seam the retry/nudge/resume paths already use.
      // Order matters: arming first would put the blank line BEFORE iteration N's own tail.
      //
      // This degrades safely in every direction: the seam is consumed by the first NON-whitespace
      // character that follows (so a turn whose tool returns arrive after all its text is
      // unaffected), it refuses when nothing has streamed yet (never a leading blank line), and
      // pushText swallows the continuation's own leading whitespace — so a boundary the model DID
      // punctuate correctly is normalized to one blank line rather than doubled. The restatement
      // hold is deliberately NOT released here (see flushPendingText).
      if (t?.tool) { flushPendingText(); pendingSeam = true; }
      if (!isReject && TOOL_RESOURCES[t?.tool] && !toolSucceeded(out)) sawFailedWrite = true;
      if (!isReject && TOOL_RESOURCES[t?.tool] && toolSucceeded(out)) {
        for (const r of TOOL_RESOURCES[t.tool]) refreshResources.add(r);
        const args = t?.toolInput ?? {};
        for (const k of ["id", "campaign_id", "referral_id", "bundle_id", "organization_id"]) {
          if (typeof args[k] === "string" && args[k]) refreshIds[k] = args[k];
        }
      }
      return out;
    };
    // Approval-card selection, shared by the `action` handler and the orphaned-pause backstop.
    // Preference order: a candidate that FAILED the policy AND has approval copy (i.e. a real
    // mutating tool) — otherwise a stale outstanding READ could take the card's title while the
    // actual write got demoted to the "Also pending" line.
    const NEVER_AUTO = () => false;
    const chooseCandidate = (candidates, autoOk = NEVER_AUTO) =>
      candidates.find((c) => !autoOk(c) && PERM_ACTIONS[c.tool])
      ?? candidates.find((c) => !autoOk(c))
      ?? candidates.find((c) => PERM_ACTIONS[c.tool])
      ?? candidates[0]
      ?? null;
    const emitApprovalCard = (candidates, autoOk = NEVER_AUTO) => {
      const chosen = chooseCandidate(candidates, autoOk);
      const others = candidates.filter((c) => c !== chosen && PERM_ACTIONS[c.tool]).map((c) => permissionTitle(c.tool, c.args));
      emitSurface(buildApprovalCard(lastActionId, sessionId, chosen?.tool, chosen?.args, others));
    };
    // ── Pause diagnostics (C1) ────────────────────────────────────────────────
    // The pause identity is INFERRED from `outstanding`, and when that map is empty the card ships
    // with no action name at all — the owner's "Confirming this action" screenshot, where the user
    // was asked to approve an action nobody could name. Flowise DOES carry the truth, on the frames
    // that arrive immediately BEFORE `action`: `agentFlowExecutedData[].data.output.calledTools` and
    // the "Attempting to use tool: ```json …```" block inside `output.content`. Keep a small rolling
    // buffer of the identity-bearing frames and dump it whenever a pause turns out unidentified, so
    // the replay fixtures are cut from a real occurrence instead of guessed at.
    // Diagnostics ONLY — nothing here changes behaviour. Frames are truncated; request bodies and
    // tool ARGUMENTS are never logged (args can carry customer PII), only tool names.
    const IDENTITY_EVENTS = new Set(["calledTools", "usedTools", "agentFlowExecutedData", "action"]);
    const FRAME_LOG_MAX = 8;
    const FRAME_CHARS = 4000;
    // Set by logPause when a pause could not be attributed to a named action (see D2/C2). Part of
    // the per-turn success metric, not just a diagnostic.
    let sawUnidentifiedPause = false;
    const frameLog = [];
    const noteFrame = (ev, data) => {
      if (!IDENTITY_EVENTS.has(ev)) return;
      let json;
      try { json = JSON.stringify(data); } catch { json = "<unserializable>"; }
      frameLog.push({ ev, chars: json?.length ?? 0, head: (json ?? "").slice(0, FRAME_CHARS) });
      if (frameLog.length > FRAME_LOG_MAX) frameLog.shift();
      // Local fixture capture. OFF by default and never enabled in production: these frames are
      // untruncated and can contain tool arguments (PII). Run the gateway with DK_TRACE_FRAMES=1
      // against a test account to cut replay fixtures from real Flowise event ordering — the whole
      // HITL defect lives in the ORDER of these frames, so guessed fixtures prove nothing.
      if (process.env.DK_TRACE_FRAMES === "1") {
        console.log(`[/chat] frame ${JSON.stringify({ ev, data })}`);
      }
    };
    // ── Authoritative pause identity (2026-07-31) ─────────────────────────────
    // Flowise's `action` payload is anonymous — verified against captured production frames, it
    // carries only { id, mapping, elements, data:{nodeId, nodeLabel, input} }. The identity IS on
    // the wire, on the `agentFlowExecutedData` frame that arrives immediately BEFORE the pause:
    //   * `output.calledTools` — the paused node's own tool calls, in LangChain {name, args} shape
    //   * `output.content`     — with the gated call appended as an "Attempting to use tool:" block
    // Reading those removes the whole race the old approach had: `outstanding` is keyed by tool
    // NAME and the same frame's CUMULATIVE `usedTools` retires it, so a tool called twice in one
    // turn had its pending call deleted microseconds before the card was built — zero candidates,
    // and a generic "Confirming this action" card with a live Approve.
    let pauseRecord = null;
    const ATTEMPT_JSON_RE = /Attempting to use tool:?\s*```json\s*([\s\S]*?)```/g;
    const gatedFromContent = (content) => {
      if (typeof content !== "string") return null;
      let last = null;
      for (const m of content.matchAll(ATTEMPT_JSON_RE)) last = m[1]; // the LAST block is the gated one
      if (!last) return null;
      try {
        const o = JSON.parse(last);
        const tool = o?.name ?? o?.tool ?? null;
        return tool ? { tool, args: o?.args ?? o?.toolInput ?? {} } : null;
      } catch { return null; }
    };
    const notePauseNode = (output) => {
      if (output?.isWaitingForHumanInput !== true) return;
      const batch = (Array.isArray(output.calledTools) ? output.calledTools : [])
        .map((t) => ({ tool: t?.name ?? t?.tool ?? null, args: t?.args ?? t?.toolInput ?? {} }))
        .filter((c) => c.tool);
      const gated = gatedFromContent(output.content);
      // The gated call leads so the card is titled from what Flowise actually stopped on, but the
      // WHOLE batch is kept: one Approve executes every tool call in the iteration, so the policy
      // must judge all of them, not just the one it paused on.
      const ordered = gated
        ? [gated, ...batch.filter((c) => c.tool !== gated.tool)]
        : batch;
      if (ordered.length) pauseRecord = { ordered };
    };
    const logPause = (outcome, candidates, chosen) => {
      const identified = !!(chosen && PERM_ACTIONS[chosen.tool]);
      // D5: an unidentified pause is one of the four clauses of the per-turn success metric, so it
      // needs a flag and not just a log line — this is the blank-approval-card defect.
      if (!identified) sawUnidentifiedPause = true;
      turnLog("pause", {
        session_id: sessionId,
        action_id: lastActionId,
        mode: approvalMode,
        outcome,                                   // "auto-resume" | "card"
        candidates: candidates.map((c) => c.tool), // names only, never arguments
        chosen: chosen?.tool ?? null,
        identified,                                // false ⇒ the card carries no action name
        auto_resumes: autoResumes,
      });
      if (outcome === "card" && !identified) {
        console.error("[/chat] pause UNIDENTIFIED — identity-bearing frames preceding this pause:", JSON.stringify(frameLog));
      }
    };
    const handleEvent = async (ev, data) => {
      noteFrame(ev, data);
      switch (ev) {
        // On a reject resume the model tends to emit unreliable filler; suppress it and let the
        // deterministic "cancelled" line (below) stand in.
        case "token": if (!isReject) emitDelta(data); break;
        case "error": turnError = data; break;
        // Tier 2: a tool has been CALLED but not yet returned → live thinking step (streamed at
        // most once per label per turn: a resumed stream replays earlier iterations' calledTools).
        // Tier 3: also record it as an outstanding candidate, so if Flowise pauses next, the
        // approval decision sees EVERY call it might be pausing on.
        case "calledTools":
          if (isReject) break;
          for (const t of (Array.isArray(data) ? data : [])) {
            if (t?.tool) sawToolActivity = true;
            if (t?.tool && !t?.toolOutput) {
              const label = thinkingLabel(t.tool);
              if (!streamedThinking.has(label)) {
                streamedThinking.add(label);
                send({ type: "thinking", delta: label });
                noteThinking(label);
              }
              outstanding.set(t.tool, { tool: t.tool, args: t.toolInput ?? {} });
            }
          }
          break;
        // Tier 3: Flowise paused before running a write tool (the Require-Human-Input entry) and
        // emitted `action`, ending the stream. Turn it into an approval card and mark the turn as
        // awaiting approval; the user's Approve/Reject resumes it on the next POST.
        case "action": {
          // AUTO mode: non-destructive writes resume without a card (visible as an auto-approved
          // thinking step). Destructive/payment tools, unknown tools, a failed policy fetch, or
          // the per-turn cap all FALL THROUGH to the manual card. The decision is made over EVERY
          // outstanding call: with no candidate at all we fail closed to a card, and a silent
          // resume needs ALL of them auto-approvable (a paused delete can never ride along with a
          // safe write). isAutoApprovable is async — resolve each candidate ONCE, up front, and
          // ONLY when a silent resume is even possible: in manual mode (or once the resume budget
          // is spent) the answer cannot change the outcome, and resolving it would put the
          // tool-safety fetch's 5s timeout in front of every approval card.
          lastActionId = data?.id ?? null;
          // Prefer what the pause frame ACTUALLY said over what we inferred from the stream.
          // `outstanding` remains the fallback for any Flowise build that omits the node snapshot.
          const candidates = pauseRecord?.ordered?.length ? pauseRecord.ordered : [...outstanding.values()];
          const mayAutoResume = approvalMode === "auto" && autoResumes < MAX_AUTO_RESUMES;
          let autoOk = NEVER_AUTO;
          if (mayAutoResume && candidates.length) {
            const autoFlags = new Map();
            for (const c of candidates) {
              if (!autoFlags.has(c.tool)) autoFlags.set(c.tool, await isAutoApprovable(c.tool));
            }
            autoOk = (c) => autoFlags.get(c.tool) === true;
          }
          if (candidates.length && mayAutoResume && candidates.every(autoOk)) {
            pendingAutoResume = true;
            autoResumes += 1;
            for (const c of candidates) {
              const label = `Auto-approved: ${labelWithTarget(c.tool, c.args)}`;
              send({ type: "thinking", delta: label });
              noteThinking(label);
            }
            logPause("auto-resume", candidates, null);
          } else {
            sawPermission = true;
            emitApprovalCard(candidates, autoOk);
            logPause("card", candidates, chooseCandidate(candidates, autoOk));
          }
          break;
        }
        // Tier 2: a tool RETURNED — if it was emit_ui, drain its buffered {type:"ui"}
        // frame from the MCP jobs side channel onto this stream.
        case "usedTools":
          for (const t of (Array.isArray(data) ? data : [])) {
            if (t?.tool) sawToolActivity = true;
            // This tool RETURNED — it can no longer be the one Flowise is about to pause on.
            // Without this, a stale candidate (e.g. a read) could be part of the set the
            // auto-approve policy judges when the NEXT pause arrives (B3).
            if (t?.tool && t?.toolOutput) outstanding.delete(t.tool);
            await drainUiJobs(noteToolReturn(t));
          }
          break;
        // Per-node execution snapshots — the only reliable carrier of LATER iterations' tool
        // outputs on current Flowise (see drainUiJobs): the usedTools event above now fires only
        // ONCE per turn, so writes (and emit_ui calls) from later iterations surface only here.
        // Only each node's OUTPUT is scanned: inputs can embed chat history, and an ui_job_id
        // from an old turn must not re-drain. Refresh accumulation is idempotent (Set/keyed map),
        // so double-counting a tool seen on both carriers is harmless.
        case "agentFlowExecutedData":
          for (const nodeExec of (Array.isArray(data) ? data : [])) {
            const output = nodeExec?.data?.output;
            if (!output) continue;
            // Capture the pause identity BEFORE the retirement loop below — it reads the node's own
            // calledTools/content, so the cumulative usedTools retirement can no longer erase it.
            notePauseNode(output);
            const laterToolReturns = Array.isArray(output.usedTools) ? output.usedTools : [];
            for (const t of laterToolReturns) {
              if (t?.tool) sawToolActivity = true;
              // Same retirement as the usedTools event: tools whose return arrives ONLY via a node
              // snapshot would otherwise stay outstanding forever and skew the next pause's set.
              if (t?.tool && t?.toolOutput) outstanding.delete(t.tool);
              noteToolReturn(t);
            }
            await drainUiJobs(JSON.stringify(output));
          }
          break;
        // agentFlowEvent / nextAgentFlow / metadata / usageMetadata / end → internal;
        // unknown events are ignored by design.
      }
    };

    // One prediction attempt (namiGateway's runAttempt, minus tool events).
    const runAttempt = async () => {
      let upstream;
      try {
        upstream = await fetch(`${FLOWISE_URL}/api/v1/prediction/${FLOWISE_FLOW_ID}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${FLOWISE_API_KEY}` },
          body: JSON.stringify(predictionBody),
          signal: upstreamAbort.signal,
        });
      } catch (e) { turnError = e.message; return; }
      if (!upstream.ok || !upstream.body) {
        turnError = `Upstream ${upstream.status}: ${(await upstream.text().catch(() => "")).slice(0, 200)}`;
        return;
      }
      // Robustness: if Flowise ever answers non-streaming (flow config change),
      // deliver the whole text as one delta instead of emitting nothing.
      const ctype = upstream.headers.get("content-type") ?? "";
      if (ctype.includes("application/json")) {
        const body = await upstream.json().catch(() => null);
        if (body && typeof body.text === "string") emitDelta(body.text);
        else turnError = "Upstream returned an unreadable non-streaming response";
        return;
      }
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      // Stall guard: a hung Flowise turn used to leave the user staring at nothing forever
      // (QA saw >2.5 min with zero frames). If the upstream produces NOTHING for the window,
      // treat it as a turn error — the user gets the friendly line + Retry instead of a hang.
      // ADAPTIVE: once tools have run this turn, long silence is usually the model generating
      // a huge tool-call argument (the designer's ~7KB TemplateProposal JSON emits ZERO SSE
      // events while it's being generated — a live trace showed 90s+ of legitimate silence),
      // so the window widens rather than killing a healthy designer turn mid-generation.
      const STALL_MS = 90_000;
      const STALL_MS_ACTIVE = 240_000;
      const stallWindow = () => (sawToolActivity ? STALL_MS_ACTIVE : STALL_MS);
      const readWithStall = () => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("__stall__")), stallWindow());
        reader.read().then(
          (r) => { clearTimeout(timer); resolve(r); },
          (e) => { clearTimeout(timer); reject(e); },
        );
      });
      while (true) {
        const { done, value } = await readWithStall().catch((e) => {
          if (String(e?.message) === "__stall__") {
            turnError = `Upstream produced no data for ${stallWindow() / 1000}s — treating the turn as stalled`;
            reader.cancel().catch(() => { /* already dead */ });
          }
          return { done: true, value: undefined };
        });
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          let payload;
          try { payload = JSON.parse(trimmed.slice(5)); } catch { continue; }
          await handleEvent(payload.event, payload.data);
        }
      }
    };

    beginAttempt();
    await runAttempt();
    // Retry once, but only if nothing user-visible streamed yet (namiGateway's rule). Never retry
    // a resume — re-sending humanInput could double-execute the approved action. seenJobIds is
    // deliberately KEPT: a retried run mints fresh job ids for its own emit_ui calls, and keeping
    // the old entries prevents re-draining (= re-streaming) a card the first attempt already sent.
    //
    // D9 side-effect gate: `!assistantReply` reads as "nothing happened yet", but it only inspects
    // TEXT. A turn can fail AFTER a write landed or a card shipped, and re-running the model then is
    // not a retry — it is a second attempt at an action that already took effect once. The three
    // added conditions are the turn's own record of having had an effect:
    //   refreshResources — a write tool returned successfully (see noteToolReturn)
    //   seenJobIds       — an emit_ui frame was drained onto this stream
    //   sawPermission    — an approval card is on screen; the turn's continuation is the user's click
    // Nothing is lost by declining: the error still reaches the user as a sentence plus Retry, which
    // is the honest outcome — a silent second write is not.
    if (turnError && !assistantReply && !isResume && extraAttempts < MAX_EXTRA_ATTEMPTS
        && refreshResources.size === 0 && seenJobIds.size === 0 && !sawPermission
        && !upstreamAbort.signal.aborted) {
      console.warn("[/chat] recoverable turn error — retrying once");
      turnError = null;
      beginAttempt({ discardBuffer: true });
      extraAttempts += 1;
      await runAttempt();
    } else if (turnError && !assistantReply && !isResume && !upstreamAbort.signal.aborted
        && (refreshResources.size > 0 || seenJobIds.size > 0 || sawPermission)) {
      // Not a silent skip: say WHY the safe path was taken, so a turn that ends on an error after a
      // successful write is diagnosable from the logs instead of looking like the retry never ran.
      console.warn("[/chat] turn error after a side effect — NOT retrying:",
        JSON.stringify({ writes: [...refreshResources], uiJobs: seenJobIds.size, sawPermission, turnError }));
    }

    // Toolless-turn recovery: the model wrote its tool calls as TEXT ("Attempting to use
    // tool: …") and no tool actually ran — Flowise gave the LLM no tools this request (MCP
    // tool-load failure flaps per request). The leak filter hides that text, which otherwise
    // leaves an announce-then-silence turn the user has to nudge. Re-run the turn once — a
    // fresh request usually binds tools; verbatim re-announcements are eaten by the dedupe.
    // If the retry leaks toollessly again, surface a friendly error + Retry instead of silence.
    if (sawToolLeak && !sawToolActivity && !sawPermission && !sawUi
        && !turnError && !isResume && extraAttempts < MAX_EXTRA_ATTEMPTS
        && !upstreamAbort.signal.aborted) {
      console.warn("[/chat] toolless tool-call-as-text turn — retrying once");
      sawToolLeak = false;
      beginAttempt();
      pendingSeam = true; // separate the pre-leak text from the re-run (no-op if nothing streamed)
      extraAttempts += 1;
      await runAttempt();
      if (sawToolLeak && !sawToolActivity && !turnError) {
        turnError = "toolless tool-call-as-text turn persisted after retry";
      }
    } else if (sawToolLeak && sawToolActivity && !sawPermission && !sawUi
        && !turnError && !isResume && refreshResources.size === 0 && autoResumes === 0
        && !sawFailedWrite && extraAttempts < MAX_EXTRA_ATTEMPTS
        && !upstreamAbort.signal.aborted) {
      // Variant seen live (designer flows): reads DID run, then the model wrote its NEXT tool
      // call as TEXT (deepseek ｜DSML｜ markup around emit_ui's huge TemplateProposal JSON). The
      // leak filter hid the markup, leaving a half reply ("…Let me show you the design:") and
      // no card, and the toolless branch above can't fire because real tools ran. Reads-only
      // (no writes, no auto-resumes, no failed writes) makes a continuation nudge safe —
      // nothing can double-execute.
      console.warn("[/chat] tool-call-as-text after read-only activity — continuation nudge");
      sawToolLeak = false;
      const preLeakQuestion = predictionBody.question;
      predictionBody.question = "Continue: finish what you were doing by INVOKING your tools through the tool interface — never write a tool call or its JSON as text. Do not repeat anything you already wrote.";
      delete predictionBody.humanInput;
      beginAttempt();
      pendingSeam = true;
      extraAttempts += 1;
      await runAttempt();
      predictionBody.question = preLeakQuestion;
      if (sawToolLeak && !turnError) {
        turnError = "tool-call-as-text persisted after continuation nudge";
      }
    }

    // AUTO mode (3C-6): silently resume each auto-approved pause on the SAME session — the
    // resumed stream's tokens/ui/thinking keep flowing to the client. A pause that wasn't
    // auto-approvable emitted a card and set sawPermission instead, so the loop ends. Errors in a
    // resumed run are never retried (re-sending humanInput could double-execute). beginAttempt()
    // per iteration — a leak-marker trip suppresses THAT attempt's tail only, never the resumed
    // run's actual answer, and the keep-back tail is flushed instead of discarded.
    // MUST run after EVERY later attempt too: the cut-off retry and the announce nudge can each
    // provoke a fresh auto-approvable pause, and a pause nobody drains means we told the user
    // "Auto-approved: …" for an action that never ran. autoResumes/MAX_AUTO_RESUMES still bound
    // the total, so re-calling this cannot widen the loop budget.
    const drainAutoResumes = async () => {
      if (!pendingAutoResume) return;
      // AUTO/MANUAL PARITY (2026-07-31). A manual resume sends question "proceed" (see the resume
      // branch above) and lets humanInput carry the decision. This loop used to leave the ORIGINAL
      // user message in `question`, so after an auto-approved pause the model was handed its entire
      // task again and could redo work it had already done — QA's "auto mode is worse than manual".
      // Send the identical signal, and restore the question afterwards so any later recovery branch
      // still sees the real turn text.
      const questionBeforeResume = predictionBody.question;
      while (pendingAutoResume && !turnError && !upstreamAbort.signal.aborted) {
        pendingAutoResume = false;
        beginAttempt();
        predictionBody.question = "proceed";
        predictionBody.humanInput = { type: "proceed", startNodeId: AGENT_NODE_ID };
        // Arm the separator like every other attempt seam, so the resumed text can't be glued onto
        // the pre-pause sentence (the missing-space run-on this loop was the last one not doing).
        pendingSeam = true;
        await runAttempt();
      }
      predictionBody.question = questionBeforeResume;
    };
    await drainAutoResumes();

    flushDeltas();

    // Flowise intermittently ends the SSE stream mid-answer (clean close, no error event),
    // leaving a dangling half-sentence dead-end ("Here's your performance at a glance:" …
    // nothing). Two strategies, because re-POSTing the ORIGINAL question is only safe when
    // nothing was written yet:
    //   zero-write turn  → verbatim re-POST (a fresh run nearly always completes, and the
    //                      restatement dedupe splices a verbatim re-opening onto what streamed).
    //   after a write    → continuation instruction only. Re-asking the question after an
    //                      auto-approved write invites the model to run the write AGAIN. Requires
    //                      every call to have returned (outstanding empty) and no failed write, so
    //                      the continuation can't narrate a success that didn't happen.
    // predictionBody may still carry humanInput from the auto-resume loop above (mutated in
    // place, not this turn's own resume) — clear it before re-POSTing so the retry can't be
    // mistaken for a HITL resume.
    const trimmedReply = assistantReply.trimEnd();
    const looksCutOff = trimmedReply.length > 0 && trimmedReply.length < 200
      && !/[.!?…](["')\]]*)?$/.test(trimmedReply)
      && !trimmedReply.includes("\n");
    const cutoffZeroWrite = autoResumes === 0 && refreshResources.size === 0;
    const cutoffAfterWrite = autoResumes > 0 && outstanding.size === 0 && !sawFailedWrite;
    if (looksCutOff && !sawUi && !sawPermission && !turnError && !isResume
        && extraAttempts < MAX_EXTRA_ATTEMPTS && !upstreamAbort.signal.aborted
        && (cutoffZeroWrite || cutoffAfterWrite)) {
      console.warn(`[/chat] turn ended mid-sentence (${cutoffZeroWrite ? "zero-write, verbatim" : "post-write, continuation"}) — retrying once:`, JSON.stringify(trimmedReply.slice(-60)));
      sawToolLeak = false;
      delete predictionBody.humanInput;
      const questionBeforeCutoff = cutoffZeroWrite ? null : predictionBody.question;
      if (!cutoffZeroWrite) predictionBody.question = CONTINUE_CUTOFF_PROMPT;
      beginAttempt();
      pendingSeam = true; // armed AFTER beginAttempt's flush, consumed by the retry's first char
      extraAttempts += 1;
      await runAttempt();
      // The retry may itself have paused on an auto-approvable write — drain it here or the
      // "Auto-approved" step we just streamed would be a claim about nothing.
      await drainAutoResumes();
      flushDeltas();
      if (questionBeforeCutoff !== null) predictionBody.question = questionBeforeCutoff;
    }

    // Announce-then-stop (retry E): the turn ended on a finished sentence promising an action,
    // with NOTHING to show for it — no tool call, no leak marker, no card, no UI, no write. That
    // is the model narrating an intention and dropping it. Nudge it once to actually do the thing.
    // Runs LAST because it reads the post-cut-off text; disjoint from the cut-off retry by
    // construction (that one needs missing terminal punctuation, this one requires it).
    const nudge = (!isResume && !isReject && !turnError && !sawToolActivity && !sawToolLeak
        && !sawUi && !sawPermission && autoResumes === 0 && refreshResources.size === 0
        && !upstreamAbort.signal.aborted && extraAttempts < MAX_EXTRA_ATTEMPTS && !g6Fired)
      ? announceNudgeCheck(assistantReply)
      : null;
    // Near-miss = commitment + action verb matched, a veto phrase overrode it. Logged so the veto
    // list can be tuned against real traffic rather than guesses.
    if (nudge?.veto) {
      console.warn("[/chat] announce-nudge near-miss (vetoed):", nudge.veto, JSON.stringify(nudge.tail.slice(-120)));
    }
    if (nudge?.trigger) {
      console.warn("[/chat] announce-then-stop nudge:", JSON.stringify(nudge.tail.slice(-120)));
      const questionBeforeNudge = predictionBody.question;
      predictionBody.question = CONTINUE_NUDGE_PROMPT;
      delete predictionBody.humanInput;
      beginAttempt();
      pendingSeam = true;
      extraAttempts += 1;
      g6Fired = true;
      await runAttempt();
      // The whole point of the nudge is to make the action happen — which means it very often
      // pauses. Drain it, or the nudge produces the same false claim it was meant to cure.
      await drainAutoResumes();
      flushDeltas();
      predictionBody.question = questionBeforeNudge;
    }

    // Referenced-but-never-emitted UI (retry E2): the reply points the user at a block ("Here's
    // the launch button — …") but the turn emitted NO ui frame at all — a live trace showed the
    // model narrating a LaunchButton it never rendered (zero emit_ui calls). The announce nudge
    // above can't catch it (no first-person commitment phrase, clean punctuation). Same
    // reads-only hard guards; one shot shared with g6Fired.
    const UI_REFERENCE_RE = /\b(?:here(?:'|’)s (?:the|your|a)|use the|click the|tap the)\s[^.!?]{0,50}\b(?:button|card|preview|picker|builder|uploader|map)\b|\b(?:button|card|preview|picker|builder|uploader|map)\b[^.!?]{0,30}\b(?:below|above|in the chat)\b/i;
    if (!g6Fired && !sawUi && !sawPermission && !isResume && !isReject && !turnError
        && !sawToolLeak && autoResumes === 0 && refreshResources.size === 0
        && !upstreamAbort.signal.aborted && extraAttempts < MAX_EXTRA_ATTEMPTS
        && UI_REFERENCE_RE.test(assistantReply)) {
      console.warn("[/chat] referenced a UI block without emitting one — nudging:", JSON.stringify(assistantReply.slice(-120)));
      const questionBeforeUiNudge = predictionBody.question;
      predictionBody.question = "Continue: you told the user about a UI block (a button/card) but you never rendered it. Call emit_ui NOW to render exactly the block you described — never mention a block you have not actually emitted. Do not repeat what you already wrote.";
      delete predictionBody.humanInput;
      beginAttempt();
      pendingSeam = true;
      extraAttempts += 1;
      g6Fired = true;
      await runAttempt();
      await drainAutoResumes();
      flushDeltas();
      predictionBody.question = questionBeforeUiNudge;
    }

    // Reject: the model's post-reject output is suppressed above, so stand in a deterministic line.
    if (isReject && !assistantReply && !turnError) {
      assistantReply = "Okay, I've cancelled that. What would you like to do instead?";
      send({ delta: assistantReply });
    }

    // Orphaned-pause backstop: an auto-approval still undrained here (the resume loop bailed on a
    // turn error or a client abort) means the user was told "Auto-approved: …" for an action that
    // never ran. The pause is real and unresolved on the Flowise side, so hand them the card
    // instead of the false claim — approving it from history resumes the same paused node.
    if (pendingAutoResume) {
      console.warn("[/chat] auto-approved pause left undrained — falling back to an approval card");
      pendingAutoResume = false;
      sawPermission = true;
      const orphanCandidates = [...outstanding.values()];
      emitApprovalCard(orphanCandidates);
      logPause("card-backstop", orphanCandidates, chooseCandidate(orphanCandidates));
    }

    // ── D9: no silent turns ───────────────────────────────────────────────────
    // Last line of defence. Every recovery above is guarded, and each guard is there for a reason —
    // but when they all decline, the turn ends with no text, no card, no UI and no error, and the
    // user is left watching a stopped spinner with no idea whether anything happened. That is the
    // single most-reported symptom across eight QA rounds, and it is also how a FAILED write became
    // invisible: sawFailedWrite gated the recoveries and was never itself surfaced anywhere.
    //
    // Each branch says only what the turn's own record supports. In particular the failed-write line
    // does NOT claim the data is unchanged (the tool reported a failure; it did not report a
    // rollback) and the success line does not invent what changed.
    if (!assistantReply && !turnError && !sawUi && !sawPermission && !isReject
        && !upstreamAbort.signal.aborted) {
      const reason = sawFailedWrite ? "failed-write" : refreshResources.size > 0 ? "silent-write" : "empty";
      console.warn("[/chat] turn produced nothing user-visible — standing in a line:",
        JSON.stringify({ reason, writes: [...refreshResources], sawToolActivity, sawToolLeak, autoResumes, extraAttempts, endTask }));
      // D8: when the model DID declare an ending, its own summary is a better stand-in than any of
      // these generic lines — it knows what it was doing. Only for the non-failure statuses: a
      // `failed`/`blocked` summary is not something to present as the whole reply, and a failed write
      // is reported from the tool's evidence rather than the model's account of it.
      const declared = !sawFailedWrite && endTask?.summary
        && (endTask.status === "complete" || endTask.status === "needs_user_in_app")
        ? endTask.summary
        : null;
      assistantReply = declared ?? (sawFailedWrite
        ? "I wasn't able to complete that — the change didn't go through, so please check it before relying on it. Want me to try again?"
        : refreshResources.size > 0
          ? "That's done. Let me know what you'd like to do next."
          : "Sorry — I didn't manage to put a reply together for that. Could you ask me again?");
      send({ delta: assistantReply });
    }

    // Surface a turn error as one friendly line. Skip when the client aborted (stop button /
    // unmount): they stopped it deliberately, never saw an error, and send() would no-op anyway.
    let errorLine = null;
    if (turnError && !upstreamAbort.signal.aborted) {
      errorLine = friendlyError(turnError);
      send({ error: errorLine });
    }
    // Persist the user's message (their history should show what they asked — attachment
    // markers stripped into metadata) and the assistant's OUTCOME, so the turn survives a
    // reload from history. Prefer the streamed reply; else the error line the user just saw;
    // else the card-only stand-in; else — for a turn that PAUSED for approval with no text —
    // the approval stand-in (previously such turns persisted a question with no response). On
    // a resume `message` is undefined — no user row (the frontend already showed the
    // Approved/Rejected bubble). Thinking + surfaces persist alongside (WS2), and the assistant
    // row's id rides the done frame so the frontend can offer per-message feedback immediately.
    const assistantOutcome = assistantReply || errorLine
      || (sawUi ? UI_SURFACE_NOTE : null)
      || (sawPermission ? APPROVAL_NOTE : null);
    const { text: userText, attachment } = splitAttachmentMarkers(message ?? null);
    // Card sends carry both a machine prompt (which may embed internal ids for the model) and a
    // human display label — history must persist the label, not the plumbing (a raw card prompt
    // once leaked a bundle UUID into the reloaded transcript).
    const cardDisplay = clickedSurfaceId && !isResume && typeof req.body?.interaction?.display === "string"
      && req.body.interaction.display.trim() ? req.body.interaction.display.slice(0, 200) : null;
    const assistantMessageId = await persistTurn(sessionId, cardDisplay ?? userText, assistantOutcome, {
      thinking: thinkingLabels,
      surfaces: emittedSurfaces,
      attachment,
      turnId,
    });
    // Data-change signal: tell the widget which app resources this turn's writes dirtied.
    if (refreshResources.size) {
      send({ type: "refresh", resources: [...refreshResources], ...(Object.keys(refreshIds).length ? { ids: refreshIds } : {}) });
    }
    // ── D5: one summary line per turn, and the per-turn success metric ────────
    // There was no definition of "a turn worked" anywhere in this system, so there was no way to
    // tell whether a fix helped — every judgement came from someone's impression of a browser
    // session. This is that definition, in code, emitted for every turn:
    //
    //   ok = no turn error, no recovery fired, no failed write, no unidentified pause
    //
    // Each clause is a defect QA actually reported. `recovered` is deliberately NOT success: a turn
    // that needed a retry or a nudge produced the right answer the second time, which is precisely
    // the flakiness the owner described ("sometimes it works and sometimes it doesn't"). Counting
    // those as passes is how eight rounds of green ended with the same bugs still live.
    const turnOk = !turnError && extraAttempts === 0 && !sawFailedWrite
      && !sawUnidentifiedPause && !sawToolLeak;
    turnLog("turn", {
      ok: turnOk,
      ms: Date.now() - turnStartedAt,
      session_id: sessionId,
      mode: approvalMode,
      resume: isResume ? (isReject ? "reject" : "approve") : null,
      page: ctx?.page ?? null,
      // What the turn produced.
      outcome: assistantReply ? "text" : errorLine ? "error" : sawUi ? "ui" : sawPermission ? "approval" : "none",
      reply_chars: assistantReply.length,
      surfaces: emittedSurfaces.length,
      ui_jobs: seenJobIds.size,
      // What it did.
      writes: [...refreshResources],
      tool_activity: sawToolActivity,
      failed_write: sawFailedWrite,
      // How hard it had to work to get there — the flakiness signal.
      extra_attempts: extraAttempts,
      auto_resumes: autoResumes,
      tool_leak: sawToolLeak,
      unidentified_pause: sawUnidentifiedPause,
      // D8: null means the model did NOT declare how the turn ended. That number, measured over real
      // turns, is what decides whether any recovery heuristic can be retired — none are touched yet.
      end_task: endTask?.status ?? null,
      aborted: upstreamAbort.signal.aborted,
      error: turnError ? String(turnError).slice(0, 200) : null,
    });

    // The click-resolution write MUST land before this instance can be frozen at res.end().
    if (surfaceUpdatePromise) await surfaceUpdatePromise;
    send({
      done: true,
      session_id: sessionId,
      awaiting_approval: sawPermission,
      ...(assistantMessageId ? { message_id: assistantMessageId } : {}),
    });
    res.end();
  } catch (e) {
    turnLog("turn", { ok: false, ms: Date.now() - turnStartedAt, session_id: sessionId, outcome: "crash", error: String(e?.message ?? e).slice(0, 200) });
    console.error("[/chat] error:", e.message);
    try {
      if (surfaceUpdatePromise) await surfaceUpdatePromise;
      send({ error: "Something went wrong on my end. Please try that again." });
      res.end();
    } catch { /* client gone */ }
  }
}

// ── POST /feedback — per-message response feedback (WS1, Tier 3.5) ─────────────
// body { message_id, rating: "up" | "down" | null, comment? }
// Thumbs on an ASSISTANT reply. One row per (message, user): re-rating upserts, rating:null
// deletes (toggle off). Ownership is enforced by walking message → session → user before any
// write. Replaces the per-session ReviewPrompt in the chat (the reviews table stays for
// non-chat use).
export async function feedbackHandler(req, res) {
  if (!adminSupabase) { res.status(503).json({ error: "Feedback is not configured on this deployment" }); return; }
  const auth = await authenticate(req);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { message_id, rating, comment } = req.body ?? {};
  if (typeof message_id !== "string" || !message_id) { res.status(400).json({ error: "message_id is required" }); return; }
  if (rating !== null && rating !== "up" && rating !== "down") {
    res.status(400).json({ error: "rating must be 'up', 'down', or null" });
    return;
  }

  try {
    const { data: msg } = await adminSupabase
      .from("chat_messages").select("id, role, session_id")
      .eq("id", message_id).maybeSingle();
    if (!msg || msg.role !== "assistant") { res.status(404).json({ error: "Message not found" }); return; }
    const { data: owned } = await adminSupabase
      .from("chat_sessions").select("id")
      .eq("id", msg.session_id).eq("user_id", auth.userId)
      .maybeSingle();
    if (!owned) { res.status(404).json({ error: "Message not found" }); return; }

    if (rating === null) {
      const { error } = await adminSupabase
        .from("chat_message_feedback").delete()
        .eq("message_id", message_id).eq("user_id", auth.userId);
      if (error) throw error;
      res.json({ ok: true, message_id, rating: null });
      return;
    }

    const { error } = await adminSupabase.from("chat_message_feedback").upsert({
      message_id,
      session_id: msg.session_id,
      user_id: auth.userId,
      rating,
      comment: typeof comment === "string" && comment.trim() ? comment.trim().slice(0, 2000) : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "message_id,user_id" });
    if (error) throw error;
    res.json({ ok: true, message_id, rating });
  } catch (e) {
    console.error("[/feedback] error:", e.message);
    res.status(500).json({ error: "Couldn't save that feedback right now" });
  }
}
