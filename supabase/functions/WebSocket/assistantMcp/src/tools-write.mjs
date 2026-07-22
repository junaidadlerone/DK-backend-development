// DK+ Tier-3 WRITE tools (Phase 3A — simple, non-charging mutations).
//
// These register in the SAME per-request McpServer as the read tools, but Flowise routes them
// through a SECOND customMCP entry with "Require Human Input: ON" — so Flowise pauses before
// executing any of them and the gateway shows an approval card. The tool code itself therefore
// contains NO approval logic; it just validates and calls the existing DK+ edge function with
// the END USER's JWT, so the function's own auth/role gate applies (a 403 is surfaced as a
// friendly "needs a higher role" message via guard()).
//
// Consent safety: create/update_referral NEVER set owner consent or a signature — those are the
// user's to complete. The agent fills everything else and leaves the referral in Draft, then
// tells the user to finish the consent section (enforced here by omission + in the prompt).
import { z } from "zod";
import { callApi } from "./helpers.mjs";
import { POSTGRID_POSTCARD_API_KEY } from "./env.mjs";

const asText = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj) }] });
const asError = (err) => ({ isError: true, content: [{ type: "text", text: `Error: ${err.message ?? err}` }] });
const wrap = (fn) => async (args) => { try { return asText(await fn(args)); } catch (e) { console.error("write tool error:", e.message); return asError(e); } };

// Same body-aware 403 mapping as the read tools, so a role/membership failure reads as guidance.
function guard(res) {
  if (res && res.__error) {
    const body = String(res.body ?? "");
    if (res.status === 403) {
      if (/ADMIN/i.test(body)) return { error: "This requires an admin role on your account." };
      if (/NO_ORGANIZATION/i.test(body)) return { error: "This account isn't associated with an organization yet." };
      return { error: "You don't have permission to do this with your current role." };
    }
    if (res.status === 404) return { error: "Not found." };
    if (res.status === 400 || res.status === 422) return { error: `That didn't pass validation: ${body || "check the details and try again"}.` };
    return { error: "That action couldn't be completed right now." };
  }
  return null;
}
const payload = (res) => res?.data ?? res;

// Referral sub-shapes — mirror createReferral/updateReferralById exactly. Consent/signature are
// intentionally NOT accepted here (left to the user).
const homeOwnerInfo = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.object({
    country: z.string().optional(),
    street_address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
  }).optional(),
}).optional();
const jobDetails = z.object({
  job_type: z.object({ id: z.union([z.string(), z.number()]).nullable().optional(), name: z.string().optional() }).optional(),
  value: z.number().optional(),
  currency: z.string().optional(),
  referral_percentage: z.number().optional(),
  notes: z.string().optional(),
}).optional();

// Which finalize-required referral fields (per the frontend CreateReferral form) are still
// missing, so the agent can prompt for exactly those. Consent + signature are NOT here — they are
// the user's to complete in the app and the agent never fills them.
function referralMissingToFinalize(hoi, jd) {
  const addr = hoi?.address ?? {};
  const miss = [];
  if (!hoi?.name) miss.push("referrer_name");
  if (!addr.country) miss.push("country");
  if (!addr.street_address) miss.push("street_address");
  if (!addr.city) miss.push("city");
  if (!addr.state) miss.push("state");
  if (!addr.zip) miss.push("zip");
  if (!(jd?.job_type && (jd.job_type.id || jd.job_type.name))) miss.push("job_type");
  if (!(typeof jd?.value === "number" && jd.value > 0)) miss.push("job_value");
  return miss;
}

// A design side counts as having a QR element if its HTML references the QR image service or the
// {{qr_url}} merge token (mirrors the frontend htmlParser QR detection). Used by the campaign QR gate.
const QR_ELEMENT_RE = /qrserver\.com|\{\{\s*qr_url\s*\}\}/i;

export function registerWriteTools(server, { userJwt }) {
  const W = { readOnlyHint: false, destructiveHint: false };
  const D = { readOnlyHint: false, destructiveHint: true };
  const t = (name, description, inputSchema, annotations, handler) =>
    server.registerTool(name, { description, inputSchema, annotations }, wrap(handler));

  // ── Referrals ──────────────────────────────────────────────────────────────
  t("create_referral",
    "Create a new referral. Gather the referrer's details and job info from the user; NEVER fill owner consent or a signature — those are the user's to complete in the app. The referral is created in DRAFT. Use the returned `missing_to_finalize` list to prompt the user for any still-missing required fields (name, full address, job type, job value), then tell them to complete the consent + signature section in the app to finalize it.",
    { home_owner_info: homeOwnerInfo, job_details: jobDetails },
    W,
    async (a) => {
      const body = {};
      if (a.home_owner_info) body.home_owner_info = a.home_owner_info;
      if (a.job_details) body.job_details = a.job_details;
      const res = await callApi("createReferral", "POST", null, userJwt, body);
      const g = guard(res); if (g) return g;
      const r = payload(res);
      const missing = referralMissingToFinalize(a.home_owner_info, a.job_details);
      return {
        id: r?.id,
        status: r?.status?.name ?? r?.status ?? "Draft",
        missing_to_finalize: missing,
        note: missing.length
          ? `Created as a draft. Still needed to finalize: ${missing.join(", ")}. Ask the user for these. The consent + signature are completed by the user in the app.`
          : "Created as a draft with all required details. Ask the user to complete the consent + signature section in the app to finalize it.",
      };
    });

  t("update_referral",
    "Edit an existing referral (referrer details, job info, notes, or status). Notes live in job_details.notes. NEVER set owner consent or a signature. Pass only the fields being changed. The returned `missing_to_finalize` reflects the referral's CURRENT state after the edit — prompt the user for anything still missing.",
    { id: z.string().describe("referral UUID"), home_owner_info: homeOwnerInfo, job_details: jobDetails, status: z.string().optional().describe("e.g. Draft, Ready — only if the user explicitly asks to change status") },
    W,
    async (a) => {
      const body = { id: a.id };
      if (a.home_owner_info) body.home_owner_info = a.home_owner_info;
      if (a.job_details) body.job_details = a.job_details;
      if (a.status) body.status = a.status;
      const res = await callApi("updateReferralById", "PATCH", null, userJwt, body);
      const g = guard(res); if (g) return g;
      // Read back the full record so missing_to_finalize reflects the merged state, not just this
      // turn's partial edit.
      let missing;
      const rb = await callApi("getReferralById", "POST", null, userJwt, { id: a.id });
      if (!rb?.__error) { const rec = payload(rb); missing = referralMissingToFinalize(rec?.home_owner_info, rec?.job_details); }
      return {
        id: a.id, updated: true,
        ...(missing ? { missing_to_finalize: missing } : {}),
        note: missing?.length ? `Updated. Still needed to finalize: ${missing.join(", ")}.` : "Updated.",
      };
    });

  t("delete_referral",
    "Delete a referral permanently (also removes its gallery images). Irreversible.",
    { id: z.string().describe("referral UUID") },
    D,
    async (a) => {
      const res = await callApi("deleteReferral", "DELETE", null, userJwt, { id: a.id });
      return guard(res) ?? { id: a.id, deleted: true };
    });

  t("delete_referral_image",
    "Delete one image from a referral's (or the org's) gallery. Irreversible.",
    { id: z.string().describe("gallery image id") },
    D,
    async (a) => {
      const res = await callApi("deleteImage", "DELETE", null, userJwt, { id: a.id });
      return guard(res) ?? { id: a.id, deleted: true };
    });

  // ── Notifications ────────────────────────────────────────────────────────────
  t("mark_notification",
    "Mark one notification read or unread.",
    { notification_id: z.string(), status: z.enum(["read", "unread"]) },
    W,
    async (a) => {
      const res = await callApi("toggleNotificationStatus", "PATCH", null, userJwt, { notification_id: a.notification_id, status: a.status });
      return guard(res) ?? { notification_id: a.notification_id, status: a.status };
    });

  t("clear_notification",
    "Clear (archive) a single notification.",
    { notification_id: z.string() },
    W,
    async (a) => {
      const res = await callApi("clearNotificationById", "POST", null, userJwt, { notification_id: a.notification_id });
      return guard(res) ?? { notification_id: a.notification_id, cleared: true };
    });

  t("clear_notifications",
    "Clear (archive) notifications in bulk. type 'all' clears every notification in the organization; 'read' clears only already-read ones. This affects the whole organization's notifications, so confirm scope with the user.",
    { type: z.enum(["all", "read"]) },
    D,
    async (a) => {
      const res = await callApi("clearNotifications", "POST", null, userJwt, { type: a.type });
      return guard(res) ?? { type: a.type, cleared: true };
    });

  // ── Settings ───────────────────────────────────────────────────────────────
  t("update_organization",
    "Update the organization's business details. business_name, business_address and business_email are ALL required by the server, so carry over the current values (from get_org_info) for any field the user isn't changing.",
    {
      business_name: z.string().min(1),
      business_address: z.string().min(1),
      business_email: z.string().email(),
      phone_number: z.string().optional(),
      industry: z.string().optional(),
      website_url: z.string().optional(),
      registration_number: z.string().optional(),
    },
    W,
    async (a) => {
      const res = await callApi("saveOrganization", "POST", null, userJwt, a);
      return guard(res) ?? { updated: true };
    });

  t("update_profile",
    "Update the signed-in user's own profile display name. (Cannot change password.)",
    { full_name: z.string().min(1) },
    W,
    async (a) => {
      const res = await callApi("updateUser", "POST", null, userJwt, { full_name: a.full_name });
      return guard(res) ?? { updated: true, full_name: a.full_name };
    });

  t("set_default_payment_method",
    "Set the organization's default payment method. Requires an admin role.",
    { payment_method_id: z.string() },
    W,
    async (a) => {
      const res = await callApi("setDefaultPaymentMethod", "POST", null, userJwt, { payment_method_id: a.payment_method_id });
      return guard(res) ?? { default_payment_method_id: a.payment_method_id };
    });

  // ── Campaigns (referral + location-zone) ─────────────────────────────────────
  // create_campaign runs the create as ONE tool call (= one approval): it validates the required
  // fields, enforces the QR gate, then chains createCampaignV2 step1 (metadata) → step2 (design) →
  // linkQRCodeToCampaign (if needed). It leaves the campaign a DRAFT with its design attached; the
  // AUDIENCE (map targeting) is set separately via the interactive audience builder (a later
  // sub-phase) or in the app, and consents + payment (launch) are done by the USER in the app —
  // the agent never charges/sends.
  t("create_campaign",
    "Create a postcard campaign (referral or location-zone) with its design in one step. GATHER every required field from the user first — campaign name (<=20 chars), the target type, the referral (for a referral campaign), a postcard design (template_bundle_id), and a disclaimer (<=500 chars). If a required field is missing the tool returns `missing_required` — prompt the user for exactly those. If the chosen design has a QR code you MUST provide `qr_url` (an https:// link). This creates the campaign as a DRAFT with its design; the mailing AUDIENCE is set as a separate step (in the app / audience builder), and the user completes consents + payment to launch in the app. Do NOT claim it was launched or that the audience is set.",
    // The "gather from the user" fields are OPTIONAL at the schema level so a partial call returns
    // a friendly `missing_required` list (handled below) instead of a raw validation error — the
    // agent should still collect them all first (see the description + prompt).
    {
      campaign_name: z.string().optional().describe("REQUIRED, <= 20 characters"),
      target_type: z.enum(["referral", "location_zone"]).optional().describe("REQUIRED"),
      referral_id: z.string().optional().describe("required when target_type is 'referral'"),
      template_bundle_id: z.string().optional().describe("REQUIRED — the postcard design bundle (from list_template_bundles)"),
      disclaimer_text: z.string().optional().describe("REQUIRED, <= 500 characters; for compliance"),
      start_date: z.string().optional().describe("ISO date; defaults to today if omitted"),
      qr_url: z.string().optional().describe("https:// landing page — required only if the design has a QR element"),
    },
    W,
    async (a) => {
      // 1. Required-field validation (backstop — the agent should have gathered these).
      const missing = [];
      if (!a.campaign_name?.trim()) missing.push("campaign_name");
      if (!a.target_type) missing.push("target_type");
      if (a.target_type === "referral" && !a.referral_id) missing.push("referral_id");
      if (!a.template_bundle_id) missing.push("template_bundle_id");
      if (!a.disclaimer_text?.trim()) missing.push("disclaimer_text");
      if (missing.length) return { missing_required: missing, note: "Ask the user for these fields, then call create_campaign again." };
      if (a.campaign_name.trim().length > 20) return { error: "Campaign name must be 20 characters or fewer." };
      if (a.disclaimer_text.length > 500) return { error: "Disclaimer text must be 500 characters or fewer." };
      if (a.qr_url && !/^https:\/\//i.test(a.qr_url)) return { error: "The QR landing-page URL must start with https://." };

      // 2. QR gate — inspect the chosen design's HTML; block early (no partial campaign) if it has
      //    a QR element but no qr_url was supplied.
      const bundleRes = await callApi("getTemplateBundleById", "GET", { bundle_id: a.template_bundle_id }, userJwt);
      const gb = guard(bundleRes); if (gb) return gb;
      const b = payload(bundleRes);
      const bundleHtml = `${b?.front_template?.html ?? ""}\n${b?.back_template?.html ?? ""}`;
      const hasQr = QR_ELEMENT_RE.test(bundleHtml);
      if (hasQr && !a.qr_url) return { missing_required: ["qr_url"], note: "The selected design has a QR code. Ask the user for the landing-page URL (must start with https://) and call create_campaign again with qr_url." };

      // 3. step 1 — metadata (creates the Draft campaign).
      const s1 = await callApi("createCampaignV2", "POST", null, userJwt, {
        step: 1,
        campaign_name: a.campaign_name.trim(),
        target_type: a.target_type === "referral" ? "Referrals" : "Location Zone",
        ...(a.target_type === "referral" ? { referral_id: a.referral_id } : {}),
        disclaimer_text: a.disclaimer_text,
        ...(a.start_date ? { start_date: a.start_date } : {}),
      });
      const g1 = guard(s1); if (g1) return g1;
      const campaign_id = payload(s1)?.id;
      if (!campaign_id) return { error: "Could not create the campaign (no id returned)." };

      // 4. step 2 — attach the design.
      const s2 = await callApi("createCampaignV2", "POST", null, userJwt, { step: 2, campaign_id, template_bundle_id: a.template_bundle_id });
      const g2 = guard(s2); if (g2) return { ...g2, campaign_id, note: "The campaign was created but attaching the design failed. Use update_campaign to retry." };

      // 5. link the QR URL if the design uses one.
      if (hasQr && a.qr_url) {
        const qr = await callApi("linkQRCodeToCampaign", "POST", null, userJwt, { campaign_id, qr_url: a.qr_url });
        const gq = guard(qr); if (gq) return { ...gq, campaign_id, note: "Design attached but linking the QR URL failed." };
      }

      return {
        campaign_id,
        campaign_name: a.campaign_name.trim(),
        status: "Draft",
        note: "Campaign created as a draft with its design attached. NEXT: set the mailing audience (map targeting) for it, then the user completes consents + payment to launch in the app. The audience isn't set yet, and it hasn't been launched.",
      };
    });

  t("update_campaign",
    "Edit an existing campaign's metadata (name, linked referral, disclaimer, start date, target type). Pass only what changes. Set referral_id to null to unlink a referral. This tool never changes launch status and never charges — launching stays in the app. (Changing the mailing audience is a separate audience-builder step, not here.)",
    {
      id: z.string().describe("campaign UUID"),
      campaign_name: z.string().optional().describe("<= 20 characters"),
      referral_id: z.string().nullable().optional().describe("null unlinks the referral"),
      disclaimer_text: z.string().optional().describe("<= 500 characters"),
      start_date: z.string().optional(),
      target_type: z.enum(["referral", "location_zone"]).optional(),
    },
    W,
    async (a) => {
      if (a.campaign_name && a.campaign_name.trim().length > 20) return { error: "Campaign name must be 20 characters or fewer." };
      if (a.disclaimer_text && a.disclaimer_text.length > 500) return { error: "Disclaimer text must be 500 characters or fewer." };
      const body = { campaign_id: a.id };
      if (a.campaign_name !== undefined) body.campaign_name = a.campaign_name.trim();
      if (a.referral_id !== undefined) body.referral_id = a.referral_id;
      if (a.disclaimer_text !== undefined) body.disclaimer_text = a.disclaimer_text;
      if (a.start_date !== undefined) body.start_date = a.start_date;
      if (a.target_type !== undefined) body.campaign_target_type = a.target_type === "referral" ? "Referrals" : "Location Zone";
      if (Object.keys(body).length === 1) return { error: "Nothing to update — pass at least one field to change." };
      const res = await callApi("editCampaignV2", "POST", null, userJwt, body);
      return guard(res) ?? { id: a.id, updated: true };
    });

  t("delete_campaign",
    "Delete a campaign permanently. Irreversible — confirm the user really means this campaign.",
    { id: z.string().describe("campaign UUID") },
    D,
    async (a) => {
      const res = await callApi("deleteCampaign", "DELETE", null, userJwt, { id: a.id });
      return guard(res) ?? { id: a.id, deleted: true };
    });

  // ── Templates (design bundles) ───────────────────────────────────────────────
  // The agent does NOT author postcard HTML (that's the visual editor). It can duplicate an
  // existing design and edit a bundle's name/size. Delete + agency (V3) template writes are a
  // later phase.
  t("duplicate_template_bundle",
    "Duplicate an existing postcard design bundle into a new editable copy (same front/back artwork and size). Useful before making variations. Returns the new bundle id.",
    { bundle_id: z.string().describe("the design bundle to copy"), new_name: z.string().optional().describe("name for the copy; defaults to '<name> (Copy)'") },
    W,
    async (a) => {
      const src = await callApi("getTemplateBundleById", "GET", { bundle_id: a.bundle_id }, userJwt);
      const gs = guard(src); if (gs) return gs;
      const b = payload(src);
      const html_front = b?.front_template?.html;
      const html_back = b?.back_template?.html;
      // getTemplateBundleById returns template fields in snake_case (postcard_size).
      const postcardSize = b?.front_template?.postcard_size ?? b?.back_template?.postcard_size;
      if (!html_front || !html_back || !postcardSize) return { error: "Couldn't read the source design's contents to duplicate it." };
      const baseName = (b?.front_template?.description ?? "Design").replace(/\s+Front$/i, "");
      const description = a.new_name?.trim() || `${baseName} (Copy)`;
      const res = await callApi("createNewTemplateBundle", "POST", null, userJwt, { description, html_front, html_back, postcardSize });
      const g = guard(res); if (g) return g;
      const nb = payload(res);
      return { id: nb?.bundle?.id ?? nb?.id, name: description, postcardSize };
    });

  t("update_template_settings",
    "Update a design bundle's name and/or postcard size. (Editing the artwork/HTML itself is done in the visual editor, not chat.)",
    { bundle_id: z.string(), name: z.string().optional().describe("new name/description"), postcard_size: z.enum(["4x6", "6x9", "6x11"]).optional() },
    W,
    async (a) => {
      if (!a.name && !a.postcard_size) return { error: "Provide a new name and/or postcard size to update." };
      const body = { template_bundle_id: a.bundle_id };
      if (a.name) body.description = a.name;
      if (a.postcard_size) body.postcardSize = a.postcard_size;
      const res = await callApi("updateTemplateBundle", "POST", null, userJwt, body);
      return guard(res) ?? { bundle_id: a.bundle_id, updated: true };
    });

  // ── Address-list campaigns (3C-1) ────────────────────────────────────────────
  // The CSV itself NEVER passes through the model/gateway: after this tool creates the Draft,
  // the agent renders the AddressListUploader card and the USER attaches the CSV client-side
  // (importAddressList runs in the browser with their session; only the list id + counts come
  // back). Verification + launch are user-completed in the app's own modals via shortcuts.
  t("create_address_list_campaign",
    "Create an ADDRESS-LIST postcard campaign (the audience comes from a CSV the user uploads) with its design, in one step. GATHER the required fields first — campaign name (<=20 chars), a postcard design (template_bundle_id), and a disclaimer (<=500 chars). If a required field is missing the tool returns `missing_required`. If the chosen design has a QR code you MUST provide `qr_url` (https://). Leaves a DRAFT with its design attached; NEXT the user attaches their CSV address list via the uploader card you render — do NOT claim the audience is set or the campaign launched.",
    {
      campaign_name: z.string().optional().describe("REQUIRED, <= 20 characters"),
      template_bundle_id: z.string().optional().describe("REQUIRED — the postcard design bundle"),
      disclaimer_text: z.string().optional().describe("REQUIRED, <= 500 characters; for compliance"),
      start_date: z.string().optional().describe("ISO date; defaults to today if omitted"),
      qr_url: z.string().optional().describe("https:// landing page — required only if the design has a QR element"),
    },
    W,
    async (a) => {
      const missing = [];
      if (!a.campaign_name?.trim()) missing.push("campaign_name");
      if (!a.template_bundle_id) missing.push("template_bundle_id");
      if (!a.disclaimer_text?.trim()) missing.push("disclaimer_text");
      if (missing.length) return { missing_required: missing, note: "Ask the user for these fields, then call create_address_list_campaign again." };
      if (a.campaign_name.trim().length > 20) return { error: "Campaign name must be 20 characters or fewer." };
      if (a.disclaimer_text.length > 500) return { error: "Disclaimer text must be 500 characters or fewer." };
      if (a.qr_url && !/^https:\/\//i.test(a.qr_url)) return { error: "The QR landing-page URL must start with https://." };

      // QR gate — same as create_campaign: block BEFORE creating anything.
      const bundleRes = await callApi("getTemplateBundleById", "GET", { bundle_id: a.template_bundle_id }, userJwt);
      const gb = guard(bundleRes); if (gb) return gb;
      const b = payload(bundleRes);
      const hasQr = QR_ELEMENT_RE.test(`${b?.front_template?.html ?? ""}\n${b?.back_template?.html ?? ""}`);
      if (hasQr && !a.qr_url) return { missing_required: ["qr_url"], note: "The selected design has a QR code. Ask the user for the landing-page URL (https://) and call the tool again with qr_url." };

      const s1 = await callApi("createCampaignV2", "POST", null, userJwt, {
        step: 1,
        campaign_name: a.campaign_name.trim(),
        target_type: "Address List",
        disclaimer_text: a.disclaimer_text,
        ...(a.start_date ? { start_date: a.start_date } : {}),
      });
      const g1 = guard(s1); if (g1) return g1;
      const campaign_id = payload(s1)?.id;
      if (!campaign_id) return { error: "Could not create the campaign (no id returned)." };

      const s2 = await callApi("createCampaignV2", "POST", null, userJwt, { step: 2, campaign_id, template_bundle_id: a.template_bundle_id });
      const g2 = guard(s2); if (g2) return { ...g2, campaign_id, note: "The campaign was created but attaching the design failed. Use update_campaign to retry." };

      if (hasQr && a.qr_url) {
        const qr = await callApi("linkQRCodeToCampaign", "POST", null, userJwt, { campaign_id, qr_url: a.qr_url });
        const gq = guard(qr); if (gq) return { ...gq, campaign_id, note: "Design attached but linking the QR URL failed." };
      }

      return {
        campaign_id,
        campaign_name: a.campaign_name.trim(),
        status: "Draft",
        note: "Address-list campaign created as a draft with its design attached. NEXT: render the CSV uploader card for this campaign so the user can attach their address list. After that: optional address verification ($0.025/address, user-completed) or skip, then the user launches in the launch screen. Nothing is uploaded, verified, or launched yet.",
      };
    });

  t("remove_invalid_addresses",
    "Exclude every INVALID address (missing mandatory fields) from a campaign's uploaded address list, in bulk.",
    { list_id: z.string().describe("the csv address list id") },
    W,
    async (a) => {
      const res = await callApi("removeAllInvalidAddresses", "POST", null, userJwt, { list_id: a.list_id });
      const g = guard(res); if (g) return g;
      const r = payload(res);
      return { list_id: a.list_id, excluded: r?.updated_count ?? 0 };
    });

  t("remove_duplicate_addresses",
    "Exclude every DUPLICATE address from a campaign's uploaded address list, in bulk (the first occurrence of each address stays).",
    { list_id: z.string().describe("the csv address list id") },
    W,
    async (a) => {
      const res = await callApi("removeAllDuplicateAddresses", "POST", null, userJwt, { list_id: a.list_id });
      const g = guard(res); if (g) return g;
      const r = payload(res);
      return { list_id: a.list_id, excluded: r?.excluded_count ?? 0 };
    });

  t("delete_addresses",
    "Remove specific addresses from a campaign's uploaded address list (they won't receive postcards). Irreversible for this list.",
    { list_id: z.string(), address_ids: z.array(z.string()).min(1).describe("ids of the addresses to remove") },
    D,
    async (a) => {
      const res = await callApi("deleteCSVAddresses", "POST", null, userJwt, { list_id: a.list_id, address_ids: a.address_ids });
      const g = guard(res); if (g) return g;
      const r = payload(res);
      return { list_id: a.list_id, removed: r?.updated_count ?? a.address_ids.length };
    });

  t("set_verification_skip",
    "Set whether an address-list campaign SKIPS the optional paid address verification ($0.025/address). skip=true lets it launch unverified; skip=false re-enables the verification requirement. This toggles intent only — it never charges; actual verification is completed by the user in the app.",
    { csv_address_list_id: z.string(), skip: z.boolean() },
    W,
    async (a) => {
      const res = await callApi("updateCampaignVerification", "POST", null, userJwt, { csv_address_list_id: a.csv_address_list_id, skip_address_verification: a.skip });
      return guard(res) ?? { csv_address_list_id: a.csv_address_list_id, skip_address_verification: a.skip };
    });

  // ── Branding (3C-2) ──────────────────────────────────────────────────────────
  // Setting a logo requires a FILE and happens via the ImageUploader card (client-side);
  // removing the company logo and updating the theme are plain JSON writes, so they're tools.
  t("update_branding_theme",
    "Update the user's branding theme: the three brand colors (hex) and the two font names. These become the defaults used across their postcard designs. All five values are required by the server, so carry over current values for anything the user isn't changing.",
    {
      primary_color: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "hex color like #E17019"),
      secondary_color: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "hex color"),
      accent_color: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "hex color"),
      heading_font: z.string().min(1).describe("font family name, e.g. Poppins"),
      body_font: z.string().min(1).describe("font family name"),
    },
    W,
    async (a) => {
      const res = await callApi("updateBrandingSettings", "POST", null, userJwt, {
        theme: {
          colors: { primary: a.primary_color, secondary: a.secondary_color, accent: a.accent_color },
          fonts: { primary: { name: a.heading_font }, body: { name: a.body_font } },
        },
      });
      return guard(res) ?? { updated: true, colors: [a.primary_color, a.secondary_color, a.accent_color], fonts: [a.heading_font, a.body_font] };
    });

  t("remove_company_logo",
    "Remove the organization's company logo. (SETTING a logo needs a file — that's done through the image-upload card, not this tool.)",
    {},
    D,
    async () => {
      const res = await callApi("updateCompanyLogo", "POST", null, userJwt, { company_logo: null });
      return guard(res) ?? { removed: true };
    });

  // ── Agency: team management (3C-3) ──────────────────────────────────────────
  // All three V3 endpoints are agency-gated server-side (caller must be OWNER/ADMIN of an agency
  // org AND of every target org) — 403s surface as friendly role messages via guard().
  const memberRole = z.enum(["ADMIN", "MARKETER", "TECHNICIAN"]);
  t("invite_user",
    "Invite a NEW user by email and grant them access to one or more of the organizations you manage. Sends them a set-password invitation email. Requires the email, a role, and which organizations they get. grant_agency_access=true additionally gives them access to your agency workspace (for ADMINs you trust with the whole portfolio).",
    {
      email: z.string().email(),
      role: memberRole,
      organization_ids: z.array(z.string()).optional().describe("orgs to grant — required unless grant_agency_access is true"),
      full_name: z.string().optional(),
      grant_agency_access: z.boolean().optional(),
    },
    W,
    async (a) => {
      if (!a.grant_agency_access && !(a.organization_ids?.length)) {
        return { missing_required: ["organization_ids"], note: "Ask which organization(s) the user should get access to (or whether to grant agency access)." };
      }
      const res = await callApi("createUserV3", "POST", null, userJwt, {
        email: a.email,
        role: a.role,
        ...(a.organization_ids?.length ? { organization_ids: a.organization_ids } : {}),
        ...(a.full_name ? { fullName: a.full_name } : {}),
        ...(a.grant_agency_access !== undefined ? { grant_agency_access: a.grant_agency_access } : {}),
      });
      const g = guard(res); if (g) {
        if (res.status === 409) return { error: "A user with that email already exists — use edit_user_access to change their organizations or role instead." };
        if (/USER_INVITATION_FAILED/i.test(res.body ?? "")) return { error: "The invitation email couldn't be sent to that address — double-check the email and try again." };
        return g;
      }
      const u = payload(res)?.user ?? payload(res);
      return { user_id: u?.id, email: a.email, role: a.role, organizations_granted: u?.organization_ids ?? a.organization_ids ?? [], note: "Invitation email sent — they set their password from it." };
    });

  t("edit_user_access",
    "Change an EXISTING team member's role and/or grant them access to more organizations. organization_ids is the list of orgs to grant/update; role is required when any of those is a NEW grant. Cannot change an organization OWNER's role, and you cannot edit yourself.",
    {
      user_id: z.string(),
      organization_ids: z.array(z.string()).min(1),
      role: memberRole.optional(),
    },
    W,
    async (a) => {
      const res = await callApi("editUserV3", "POST", null, userJwt, { user_id: a.user_id, organization_ids: a.organization_ids, ...(a.role ? { role: a.role } : {}) });
      const g = guard(res); if (g) {
        if (/ROLE_REQUIRED_FOR_NEW_GRANTS/i.test(res.body ?? "")) return { missing_required: ["role"], note: "One of those organizations is a new grant for this user — ask which role they should have there." };
        return g;
      }
      const r = payload(res);
      return { user_id: a.user_id, results: r?.results ?? [], organizations: r?.organization_ids ?? a.organization_ids };
    });

  t("revoke_user_access",
    "Remove a team member's access to specific organizations. Their account survives (this is NOT a delete) — they just lose those organizations. Cannot revoke an organization's OWNER or yourself; agency-workspace access is not revocable this way.",
    { user_id: z.string(), organization_ids: z.array(z.string()).min(1) },
    D,
    async (a) => {
      const res = await callApi("revokeUserAccessV3", "POST", null, userJwt, { user_id: a.user_id, organization_ids: a.organization_ids });
      const g = guard(res); if (g) {
        if (/CANNOT_REVOKE_OWNER/i.test(res.body ?? "")) return { error: "That user OWNS one of those organizations — ownership can't be revoked, only transferred (which I can't do)." };
        return g;
      }
      const r = payload(res);
      return { user_id: a.user_id, results: r?.results ?? [], skipped_agency_orgs: r?.dropped_agency_organization_ids ?? [] };
    });

  // ── Agency: settings + template sharing (3C-3) ───────────────────────────────
  t("update_agency_settings",
    "Update the agency workspace's details: name, industry, and/or website. At least one field is required. (The agency LOGO needs a file — that's the image-upload card, not this tool.) Requires OWNER/ADMIN of the agency.",
    {
      agency_name: z.string().optional(),
      industry: z.string().optional(),
      website_url: z.string().optional(),
    },
    W,
    async (a) => {
      if (!a.agency_name && !a.industry && !a.website_url) return { error: "Provide at least one of: agency name, industry, website." };
      const body = {};
      if (a.agency_name !== undefined) body.agency_name = a.agency_name;
      if (a.industry !== undefined) body.industry = a.industry;
      if (a.website_url !== undefined) body.agency_website_url = a.website_url;
      const res = await callApi("editAgencySettings", "POST", null, userJwt, body);
      const g = guard(res); if (g) return g;
      const ag = payload(res)?.agency ?? payload(res);
      return { updated: true, agency_name: ag?.agency_name, industry: ag?.industry, website_url: ag?.agency_website_url };
    });

  t("share_agency_template",
    "Share an agency-owned postcard design with one or more client organizations (they can then use it in their campaigns). ADDS to the existing share list. Requires OWNER/ADMIN of the agency and of every target organization.",
    { bundle_id: z.string(), organization_ids: z.array(z.string()).min(1) },
    W,
    async (a) => {
      const res = await callApi("shareTemplateBundleV3", "POST", null, userJwt, { template_bundle_id: a.bundle_id, organization_ids: a.organization_ids });
      const g = guard(res); if (g) return g;
      const r = payload(res);
      return { bundle_id: a.bundle_id, shared_with: r?.shared_with_organization_ids ?? [] };
    });

  t("unshare_agency_template",
    "Stop sharing an agency-owned postcard design with specific client organizations (removes them from the share list).",
    { bundle_id: z.string(), organization_ids: z.array(z.string()).min(1) },
    W,
    async (a) => {
      const res = await callApi("unshareTemplateBundleV3", "POST", null, userJwt, { template_bundle_id: a.bundle_id, organization_ids: a.organization_ids });
      const g = guard(res); if (g) return g;
      const r = payload(res);
      return { bundle_id: a.bundle_id, shared_with: r?.shared_with_organization_ids ?? [] };
    });

  t("delete_template_bundle",
    "Delete a postcard design bundle permanently (removes it from PostGrid too). Irreversible — confirm the user means this design. Requires OWNER/ADMIN of the design's owning organization.",
    { bundle_id: z.string() },
    D,
    async (a) => {
      // This edge fn uniquely requires the PostGrid key in the BODY (create/update use their own env).
      if (!POSTGRID_POSTCARD_API_KEY) return { error: "Design deletion isn't available right now — it needs additional server configuration. The user can delete it from the Templates page." };
      const res = await callApi("deleteTemplateBundle", "POST", null, userJwt, { template_bundle_id: a.bundle_id, postgridApiKey: POSTGRID_POSTCARD_API_KEY });
      return guard(res) ?? { bundle_id: a.bundle_id, deleted: true };
    });
}
