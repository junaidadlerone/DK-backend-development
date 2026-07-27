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
  create_client_organization: "Setting up the new organization…",
  complete_org_onboarding: "Finishing the organization's setup…",
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
// misattributed pending tool (see pendingAction) can never silently resume a write it wasn't.
// On top of the annotations, ALWAYS_CONFIRM lists tools whose side effects leave the account
// (payments; outbound invitation emails; privilege grants) — those card even in auto mode.
// Any uncertainty (fetch failure, unknown tool) FAILS CLOSED to the manual card.
const ALWAYS_CONFIRM = new Set(["set_default_payment_method", "invite_user", "edit_user_access"]);
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
  create_client_organization: ["organization"],
  complete_org_onboarding: ["organization"],
  switch_to_agency_account: ["organization"],
};
// A write "succeeded" when its result parses without an error/denial marker. Tool results are
// compact JSON — an {error}/{missing_required}/{role_restricted} result means nothing changed.
function toolSucceeded(outText) {
  try {
    const parsed = JSON.parse(outText);
    return !(parsed?.error || parsed?.missing_required || parsed?.role_restricted);
  } catch {
    return !/"(error|missing_required|role_restricted)"/.test(outText.slice(0, 400));
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
const PERM_TITLES = {
  create_referral: "Create a new referral",
  update_referral: "Update this referral",
  delete_referral: "Delete this referral",
  delete_referral_image: "Delete this image",
  mark_notification: "Update a notification",
  clear_notification: "Clear a notification",
  clear_notifications: "Clear notifications",
  update_organization: "Update your organization details",
  update_profile: "Update your profile",
  set_default_payment_method: "Set your default payment method",
  create_campaign: "Create this campaign",
  update_campaign: "Update this campaign",
  delete_campaign: "Delete this campaign",
  duplicate_template_bundle: "Duplicate this design",
  update_template_settings: "Update this design's settings",
  create_address_list_campaign: "Create this campaign",
  remove_invalid_addresses: "Exclude all invalid addresses",
  remove_duplicate_addresses: "Exclude all duplicate addresses",
  delete_addresses: "Remove these addresses",
  set_verification_skip: "Change the address-verification preference",
  update_branding_theme: "Update your branding theme",
  remove_company_logo: "Remove your company logo",
  invite_user: "Send this team invitation",
  edit_user_access: "Change this member's access",
  revoke_user_access: "Remove this member's access",
  update_agency_settings: "Update your agency settings",
  share_agency_template: "Share this design with clients",
  unshare_agency_template: "Stop sharing this design",
  delete_template_bundle: "Delete this design",
  create_client_organization: "Create the new organization",
  complete_org_onboarding: "Finish this organization's setup",
  switch_to_agency_account: "Convert your account to an agency",
};
const permissionTitle = (tool) => PERM_TITLES[tool] ?? `Run: ${String(tool ?? "this action").replace(/_/g, " ")}`;
// The human-readable TARGET of a pending action, pulled from the tool args the model sent.
// Shown on the approval card so the user approves a NAMED thing — a wrong-target delete once
// slipped through because the card showed only "Delete this campaign" with no name. Ids are
// never shown; only name-like fields qualify.
const TARGET_ARG_KEYS = ["name", "campaign_name", "referrer_name", "new_name", "agency_name", "business_name", "email", "description"];
const actionTarget = (args) => {
  if (!args || typeof args !== "object") return null;
  for (const k of TARGET_ARG_KEYS) {
    const v = args[k] ?? args?.home_owner_info?.[k];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 80);
  }
  return null;
};
// Plain Approve/Reject card for non-charging writes (charging actions get a cost+checkbox
// variant in Phase 3B). Rendered through the same GenUI catalog the read tools use, so the
// frontend's existing perm_-surface handling (retract on click, exclude from history) applies.
const buildApprovalCard = (actionId, sessionId, tool, args) => {
  const target = actionTarget(args);
  return cleanUiFrame({
    type: "ui",
    surface_id: `perm_${actionId ?? sessionId}`,
    mode: "replace",
    root: "perm-card",
    components: [
      { id: "perm-card", component: { Card: { title: "Approval needed", children: ["perm-title", ...(target ? ["perm-target"] : []), "perm-cap", "perm-row"] } } },
      { id: "perm-title", component: { Text: { text: permissionTitle(tool), variant: "subtitle" } } },
      ...(target ? [{ id: "perm-target", component: { Text: { text: `Target: “${target}”`, variant: "body" } } }] : []),
      { id: "perm-cap", component: { Text: { text: "Approve to run it, or reject to cancel.", variant: "caption" } } },
      { id: "perm-row", component: { Row: { children: ["perm-approve", "perm-reject"], gap: "sm" } } },
      { id: "perm-approve", component: { Button: { label: "Approve", tone: "primary", action: { type: "send", display: "Approved", prompt: HITL_PROCEED } } } },
      { id: "perm-reject", component: { Button: { label: "Reject", tone: "ghost", action: { type: "send", display: "Rejected", prompt: HITL_REJECT } } } },
    ],
    data_model: {},
  });
};

// ── leak filters + redaction (Tier 2) ─────────────────────────────────────────
// Flowise synthesizes "Attempting to use tool…" text around tool pauses, and
// deepseek can leak raw tool markup; strip both plus any literal emit_ui markup.
const LEAK_MARKERS = ["Attempting to use tool", "｜DSML｜", "<emit_ui", "<emitui"];
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
  const { thinking = [], surfaces = [], attachment = null } = extras;
  let assistantId = null;
  if (userMessage) {
    const base = { session_id: sessionId, role: "user", content: userMessage };
    const { error } = await adminSupabase.from("chat_messages")
      .insert(attachment?.length ? { ...base, attachment } : base);
    if (error && attachment?.length) {
      console.error("[/chat] user-row insert with attachment failed (retrying plain):", error.message);
      await adminSupabase.from("chat_messages").insert(base);
    }
  }
  if (assistantReply) {
    const base = { session_id: sessionId, role: "assistant", content: assistantReply };
    let { data, error } = await adminSupabase.from("chat_messages")
      .insert(thinking.length ? { ...base, thinking } : base)
      .select("id").single();
    if (error && thinking.length) {
      console.error("[/chat] assistant-row insert with thinking failed (retrying plain):", error.message);
      ({ data } = await adminSupabase.from("chat_messages").insert(base).select("id").single());
    }
    assistantId = data?.id ?? null;
  }
  if (surfaces.length) {
    const now = new Date().toISOString();
    const rows = surfaces.map((s) => ({
      session_id: sessionId,
      message_id: assistantId, // null on a pause-only turn — the frontend interleaves orphans by created_at
      surface_id: s.surface_id,
      frame: s.frame,
      seq: s.seq,
      interaction: null,
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
  // approve/reject when the frontend didn't spell it out. Fire-and-forget (session-scoped, so a
  // caller can only resolve their own surfaces — ownership was just checked above).
  const clickedSurfaceId = typeof req.body?.surface_id === "string" && req.body.surface_id ? req.body.surface_id : null;
  if (clickedSurfaceId && !isNewSession) {
    const given = (req.body?.interaction && typeof req.body.interaction === "object") ? req.body.interaction : {};
    const interaction = {
      resolved: true,
      ...(typeof given.button_id === "string" ? { button_id: given.button_id.slice(0, 80) } : {}),
      action: typeof given.action === "string" ? given.action.slice(0, 40) : (isResume ? (isReject ? "reject" : "approve") : "send"),
      ...(typeof given.display === "string" ? { display: given.display.slice(0, 200) }
        : isResume ? { display: isReject ? "Rejected" : "Approved" } : {}),
      resolved_at: new Date().toISOString(),
    };
    adminSupabase.from("chat_surfaces")
      .update({ interaction, updated_at: new Date().toISOString() })
      .eq("session_id", sessionId).eq("surface_id", clickedSurfaceId)
      .then(({ error }) => { if (error) console.error("[/chat] surface interaction update failed:", error.message); });
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
        analytics: {
          langFuse: { userId: auth.userId, sessionId },
          langSmith: {
            metadata: { session_id: sessionId, user_id: auth.userId, mode: approvalMode, page: ctx?.page ?? "" },
            tags: [`mode:${approvalMode}`, ctx?.organization?.id ? `org:${ctx.organization.id}` : "org:none"],
          },
        },
        // vars.userJwt feeds the Flowise customMCP header (Authorization: Bearer
        // {{$vars.userJwt}}); page/ids are available to the system prompt too.
        vars: {
          userJwt: auth.userJwt,
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
    const pushText = (out) => {
      let emit = "";
      for (const ch of out) {
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
      if (held) {
        for (const h of held) trackChar(h);
        send({ delta: held });
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
    const flushDeltas = () => {
      if (suppressRest || !pendingText) { pendingText = ""; }
      else {
        const hit = earliestMarker(pendingText);
        if (hit !== undefined && pendingText.slice(hit).startsWith("Attempting to use tool")) sawToolLeak = true;
        const out = clean(hit !== undefined ? pendingText.slice(0, hit).replace(/\s+$/, "") : pendingText);
        if (out) pushText(out);
        pendingText = "";
      }
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
    // HITL: the tool Flowise is about to run (captured from calledTools) and whether this turn
    // ended by pausing for approval (drives the done frame's awaiting_approval + composer lock).
    let pendingAction = null;
    let sawPermission = false;
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

    // WS2 capture: everything persistTurn stores alongside the text.
    // thinkingLabels — ordered progress labels (consecutive-duplicate collapsed, matching the
    // frontend's display dedupe). emittedSurfaces — every streamed {type:"ui"} frame INCLUDING
    // the perm_ approval card, size-capped so one pathological frame can't bloat the table.
    const thinkingLabels = [];
    const noteThinking = (label) => {
      if (label && label !== thinkingLabels[thinkingLabels.length - 1]) thinkingLabels.push(label);
    };
    const emittedSurfaces = [];
    let surfaceSeq = 0;
    const MAX_SURFACE_BYTES = 64 * 1024;
    const emitSurface = (frame) => {
      const cleanFrame = cleanUiFrame(frame);
      send(cleanFrame);
      if (typeof cleanFrame?.surface_id === "string" && cleanFrame.surface_id) {
        let size = 0;
        try { size = JSON.stringify(cleanFrame).length; } catch { size = MAX_SURFACE_BYTES + 1; }
        if (size <= MAX_SURFACE_BYTES) {
          emittedSurfaces.push({ surface_id: cleanFrame.surface_id, frame: cleanFrame, seq: surfaceSeq++ });
        } else {
          console.warn(`[/chat] surface ${cleanFrame.surface_id} over persist cap (${size}B) — streamed, not persisted`);
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
      if (!isReject && TOOL_RESOURCES[t?.tool] && toolSucceeded(out)) {
        for (const r of TOOL_RESOURCES[t.tool]) refreshResources.add(r);
        const args = t?.toolInput ?? {};
        for (const k of ["id", "campaign_id", "referral_id", "bundle_id", "organization_id"]) {
          if (typeof args[k] === "string" && args[k]) refreshIds[k] = args[k];
        }
      }
      return out;
    };
    const handleEvent = async (ev, data) => {
      switch (ev) {
        // On a reject resume the model tends to emit unreliable filler; suppress it and let the
        // deterministic "cancelled" line (below) stand in.
        case "token": if (!isReject) emitDelta(data); break;
        case "error": turnError = data; break;
        // Tier 2: a tool has been CALLED but not yet returned → live thinking step. Tier 3: also
        // remember it as the pending action, so if Flowise pauses next we can title the card.
        case "calledTools":
          if (isReject) break;
          for (const t of (Array.isArray(data) ? data : [])) {
            if (t?.tool) sawToolActivity = true;
            if (t?.tool && !t?.toolOutput) {
              const label = thinkingLabel(t.tool);
              send({ type: "thinking", delta: label });
              noteThinking(label);
              pendingAction = { tool: t.tool, args: t.toolInput ?? {} };
            }
          }
          break;
        // Tier 3: Flowise paused before running a write tool (the Require-Human-Input entry) and
        // emitted `action`, ending the stream. Turn it into an approval card and mark the turn as
        // awaiting approval; the user's Approve/Reject resumes it on the next POST.
        case "action": {
          // AUTO mode: non-destructive writes resume without a card (visible as an auto-approved
          // thinking step). Destructive/payment tools, unknown tools, a failed policy fetch, or
          // the per-turn cap all FALL THROUGH to the manual card.
          if (approvalMode === "auto" && autoResumes < MAX_AUTO_RESUMES && (await isAutoApprovable(pendingAction?.tool))) {
            pendingAutoResume = true;
            autoResumes += 1;
            const label = `Auto-approved: ${thinkingLabel(pendingAction?.tool)}`;
            send({ type: "thinking", delta: label });
            noteThinking(label);
          } else {
            sawPermission = true;
            emitSurface(buildApprovalCard(data?.id, sessionId, pendingAction?.tool, pendingAction?.args));
          }
          break;
        }
        // Tier 2: a tool RETURNED — if it was emit_ui, drain its buffered {type:"ui"}
        // frame from the MCP jobs side channel onto this stream.
        case "usedTools":
          for (const t of (Array.isArray(data) ? data : [])) {
            if (t?.tool) sawToolActivity = true;
            // This tool RETURNED — it can no longer be the one Flowise is about to pause on.
            // Without this, a stale pendingAction (e.g. a read) could be the tool the
            // auto-approve policy judges when the NEXT pause arrives (B3).
            if (t?.tool && t?.toolOutput && pendingAction?.tool === t.tool) pendingAction = null;
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
            const laterToolReturns = Array.isArray(output.usedTools) ? output.usedTools : [];
            for (const t of laterToolReturns) {
              if (t?.tool) sawToolActivity = true;
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
      // (QA saw >2.5 min with zero frames). If the upstream produces NOTHING for STALL_MS,
      // treat it as a turn error — the user gets the friendly line + Retry instead of a hang.
      const STALL_MS = 90_000;
      const readWithStall = () => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("__stall__")), STALL_MS);
        reader.read().then(
          (r) => { clearTimeout(timer); resolve(r); },
          (e) => { clearTimeout(timer); reject(e); },
        );
      });
      while (true) {
        const { done, value } = await readWithStall().catch((e) => {
          if (String(e?.message) === "__stall__") {
            turnError = `Upstream produced no data for ${STALL_MS / 1000}s — treating the turn as stalled`;
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

    await runAttempt();
    // Retry once, but only if nothing user-visible streamed yet (namiGateway's rule). Never retry
    // a resume — re-sending humanInput could double-execute the approved action. seenJobIds is
    // deliberately KEPT: a retried run mints fresh job ids for its own emit_ui calls, and keeping
    // the old entries prevents re-draining (= re-streaming) a card the first attempt already sent.
    if (turnError && !assistantReply && !isResume && !upstreamAbort.signal.aborted) {
      console.warn("[/chat] recoverable turn error — retrying once");
      turnError = null;
      pendingText = "";
      suppressRest = false;
      await runAttempt();
    }

    // Toolless-turn recovery: the model wrote its tool calls as TEXT ("Attempting to use
    // tool: …") and no tool actually ran — Flowise gave the LLM no tools this request (MCP
    // tool-load failure flaps per request). The leak filter hides that text, which otherwise
    // leaves an announce-then-silence turn the user has to nudge. Re-run the turn once — a
    // fresh request usually binds tools; verbatim re-announcements are eaten by the dedupe.
    // If the retry leaks toollessly again, surface a friendly error + Retry instead of silence.
    if (sawToolLeak && !sawToolActivity && !sawPermission && !sawUi
        && !turnError && !isResume && !upstreamAbort.signal.aborted) {
      console.warn("[/chat] toolless tool-call-as-text turn — retrying once");
      sawToolLeak = false;
      pendingText = "";
      suppressRest = false;
      await runAttempt();
      if (sawToolLeak && !sawToolActivity && !turnError) {
        turnError = "toolless tool-call-as-text turn persisted after retry";
      }
    }

    // AUTO mode (3C-6): silently resume each auto-approved pause on the SAME session — the
    // resumed stream's tokens/ui/thinking keep flowing to the client. A pause that wasn't
    // auto-approvable emitted a card and set sawPermission instead, so the loop ends. Errors in a
    // resumed run are never retried (re-sending humanInput could double-execute). suppressRest/
    // pendingText reset like the retry path — a leak-marker trip suppresses THAT attempt's tail
    // only, never the resumed run's actual answer.
    while (pendingAutoResume && !turnError && !upstreamAbort.signal.aborted) {
      pendingAutoResume = false;
      suppressRest = false;
      pendingText = "";
      predictionBody.humanInput = { type: "proceed", startNodeId: AGENT_NODE_ID };
      await runAttempt();
    }

    flushDeltas();

    // Reject: the model's post-reject output is suppressed above, so stand in a deterministic line.
    if (isReject && !assistantReply && !turnError) {
      assistantReply = "Okay, I've cancelled that. What would you like to do instead?";
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
    const assistantMessageId = await persistTurn(sessionId, userText, assistantOutcome, {
      thinking: thinkingLabels,
      surfaces: emittedSurfaces,
      attachment,
    });
    // Data-change signal: tell the widget which app resources this turn's writes dirtied.
    if (refreshResources.size) {
      send({ type: "refresh", resources: [...refreshResources], ...(Object.keys(refreshIds).length ? { ids: refreshIds } : {}) });
    }
    send({
      done: true,
      session_id: sessionId,
      awaiting_approval: sawPermission,
      ...(assistantMessageId ? { message_id: assistantMessageId } : {}),
    });
    res.end();
  } catch (e) {
    console.error("[/chat] error:", e.message);
    try {
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
