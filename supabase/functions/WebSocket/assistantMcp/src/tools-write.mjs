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
import { QR_ELEMENT_RE, makeGuard, normalizePhone, payload, roleAreaDenial, wrap as wrapShared } from "./tool-helpers.mjs";
import { POSTGRID_POSTCARD_API_KEY } from "./env.mjs";

// Shared plumbing (tool-helpers.mjs) with the write-flavored guard tone. The 400/422 branch
// sanitizes the upstream body before surfacing it (never raw — it can carry internal codes/ids).
const wrap = (fn) => wrapShared(fn, "write tool");
const guard = makeGuard("write");

// ── Referral field canonicalization (bug-bash 2026-07-24) ─────────────────────
// The app's form submits state as the FULL NAME from world_states ("Illinois", never "IL") and
// job_type as {id: <job_types uuid>, name} — the backend stores whatever it's given verbatim
// (no FK checks), so a raw "IL" or a name-only job type saves but renders as EMPTY selectors in
// the app's forms and keeps the referral from ever reaching "Ready". Resolve both here against
// the same public endpoints the form uses (getAllStatesV2 / getAllJobs), cached in-process.
const DEFAULT_COUNTRY = "United States of America";
const optionCache = new Map(); // key -> { list, expiresAt }
async function cachedList(key, fetcher) {
  const hit = optionCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.list;
  const list = await fetcher();
  if (list) optionCache.set(key, { list, expiresAt: Date.now() + 10 * 60_000 });
  return list ?? hit?.list ?? null;
}
async function statesForCountry(country, userJwt) {
  return cachedList(`states:${country.toLowerCase()}`, async () => {
    const res = await callApi("getAllStatesV2", "GET", { country_name: country }, userJwt);
    const list = res && !res.__error ? payload(res) : null;
    return Array.isArray(list) ? list : null; // [{ name, code }]
  });
}
async function jobTypes(userJwt) {
  return cachedList("jobs", async () => {
    const res = await callApi("getAllJobs", "GET", null, userJwt);
    const list = res && !res.__error ? payload(res) : null;
    return Array.isArray(list) ? list : null; // [{ id: uuid, name }]
  });
}
// Mutates a copy of home_owner_info: fills the default country and canonicalizes the state
// ("IL" or "illinois" → "Illinois"). Unresolvable values stay verbatim (the server accepts
// them; better saved-as-typed than dropped).
async function canonicalizeAddress(hoi, userJwt) {
  if (!hoi?.address) return hoi;
  const address = { ...hoi.address };
  if (!address.country?.trim() && (address.state || address.city || address.street_address)) {
    address.country = DEFAULT_COUNTRY;
  }
  if (address.state?.trim() && address.country?.trim()) {
    const states = await statesForCountry(address.country.trim(), userJwt);
    if (states) {
      const q = address.state.trim().toLowerCase();
      // world_states codes are ISO-prefixed ("US-IL") — match against both the full code and
      // its bare tail, so "IL", "us-il" and "Illinois" all canonicalize to "Illinois".
      const match =
        states.find((s) => s.name?.toLowerCase() === q) ??
        states.find((s) => s.code?.toLowerCase() === q) ??
        states.find((s) => s.code?.toLowerCase().split("-").pop() === q);
      if (match?.name) address.state = match.name;
    }
  }
  return { ...hoi, address };
}
// Resolves a job type given by NAME to the app's {id, name}. AUTO-ACCEPTS ONLY an exact
// (case-insensitive) name match — with 700+ job types, a fuzzy auto-pick is worse than asking
// (an early draft substring-matched "Roofing" to "Waterproofing"). Anything inexact returns
// {unresolved: {message, options}} with word-level close matches for the user to pick from.
const jobWords = (s) => (s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
async function resolveJobType(jt, userJwt) {
  if (!jt || (jt.id && jt.name)) return { job_type: jt };
  const list = await jobTypes(userJwt);
  if (!list) return { job_type: jt }; // lookup unavailable — save as given rather than block
  const q = (jt.name ?? "").trim().toLowerCase();
  if (!q) return { job_type: jt };
  const exact = list.find((j) => j.name?.toLowerCase() === q);
  if (exact) return { job_type: { id: exact.id, name: exact.name } };
  // Close matches: every query word must line up with a name word (equal, or a ≥4-char prefix
  // in either direction — "roofing"↔"roof" matches, "roofing"↔"waterproofing" does not).
  const qw = jobWords(q);
  const wordsMatch = (a, b) => a === b || (a.length >= 4 && b.startsWith(a)) || (b.length >= 4 && a.startsWith(b));
  const close = qw.length
    ? list.filter((j) => {
        const nw = jobWords(j.name);
        return qw.every((w) => nw.some((n) => wordsMatch(w, n)));
      })
    : [];
  const options = (close.length ? close : list).slice(0, 12).map((j) => j.name);
  return {
    unresolved: {
      message: `"${jt.name}" isn't an exact job type in the app. Ask the user to pick one${close.length ? " of these close matches" : ""}: ${options.join(", ")}.`,
      options,
    },
  };
}

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

// App-verified caps on SUPPLIED referral fields (bug-bash follow-up 2026-07-28): the app's own
// forms enforce these limits client-side; the assistant's tools previously passed anything
// through and let the upstream 400/422 surface a sanitized-but-vague error. Validate up front so
// the model gets a specific, actionable note — same { missing_required, note } envelope the
// job_type/referrer_name checks already use — instead of a generic bounce. Every field here is
// still OPTIONAL: these only fire when a value is actually supplied, and phone stays optional too
// (no phone, no complaint). Returns { error } to short-circuit, or the (possibly phone-normalized)
// home_owner_info to use.
function checkHomeOwnerInfo(hoi) {
  if (!hoi) return { hoi };
  const out = { ...hoi };
  if (out.name != null && out.name.trim()) {
    const trimmedName = out.name.trim();
    const words = trimmedName.split(/\s+/).filter(Boolean);
    if (words.length < 2) {
      return { error: { missing_required: ["referrer_name"], note: "That name needs a first and last name — ask the user for the full name." } };
    }
    out.name = trimmedName;
  }
  if (out.phone != null && out.phone.trim()) {
    const pn = normalizePhone(out.phone);
    if (!pn.ok) {
      return { error: { missing_required: ["phone"], note: "That phone number isn't a valid format. Ask the user for the full number with area code (or the country code if it isn't a US number), then call the tool again." } };
    }
    out.phone = pn.phone;
  }
  const addr = out.address;
  if (addr) {
    if (addr.street_address != null && addr.street_address.length > 100) {
      return { error: { missing_required: ["street_address"], note: "That street address is too long (max 100 characters) — ask the user for a shorter version." } };
    }
    if (addr.city != null && addr.city.length > 50) {
      return { error: { missing_required: ["city"], note: "That city name is too long (max 50 characters)." } };
    }
    if (addr.zip != null && addr.zip.trim() && !/^\d{5}(-\d{4})?$/.test(addr.zip.trim())) {
      return { error: { missing_required: ["zip"], note: "That zip code isn't a valid format. Ask the user for a 5-digit zip or ZIP+4 (e.g. 12345 or 12345-6789)." } };
    }
    // Write trimmed address values back into the outgoing payload
    if (addr.street_address != null) addr.street_address = addr.street_address.trim();
    if (addr.city != null) addr.city = addr.city.trim();
    if (addr.zip != null) addr.zip = addr.zip.trim();
  }
  return { hoi: out };
}
// Same pattern for job_details caps (value ceiling, notes length). job_type is resolved
// separately (resolveJobType) — this only covers the plain-value caps.
function checkJobDetails(jd) {
  if (!jd) return { ok: true };
  if (jd.value != null) {
    if (typeof jd.value !== "number" || !Number.isFinite(jd.value) || jd.value <= 0 || jd.value > 9_999_999) {
      return { error: { missing_required: ["job_value"], note: "The job value must be a number greater than 0 and no more than 9,999,999." } };
    }
  }
  if (jd.notes != null && jd.notes.length > 250) {
    return { error: { missing_required: ["notes"], note: "Notes must be 250 characters or fewer — ask the user to shorten them." } };
  }
  return { ok: true };
}

export function registerWriteTools(server, { userJwt }) {
  const W = { readOnlyHint: false, destructiveHint: false };
  const D = { readOnlyHint: false, destructiveHint: true };
  // Optional `area` gates the tool by the caller's per-org role (roleAreaDenial) — mirrors the
  // app's menu matrix (technicians: no campaigns/templates; marketers: no template management).
  const t = (name, description, inputSchema, annotations, handler, area) =>
    server.registerTool(name, { description, inputSchema, annotations }, wrap(async (a) =>
      (await roleAreaDenial(userJwt, area)) ?? handler(a)));

  // ── Referrals ──────────────────────────────────────────────────────────────
  t("create_referral",
    "Create a new referral. Gather the referrer's details and job info from the user; NEVER fill owner consent or a signature — those are the user's to complete in the app. State may be given as a name or abbreviation ('IL' works); job type is given by NAME and matched to the app's real job-type list (a non-matching name returns the valid options to offer the user). Referrer name must be a first and last name (two words minimum). Phone is OPTIONAL but if given must be a real number, e.g. +17135550123 or (713) 555-0123 — US numbers can omit +1. Job value must be a number > 0 and <= 9,999,999. Notes are optional and must be 250 characters or fewer. Zip must be 5 digits or ZIP+4 (12345 or 12345-6789). The referral is created in DRAFT. Use the returned `missing_to_finalize` list to prompt the user for any still-missing required fields (name, full address, job type, job value), then tell them to complete the consent + signature section in the app to finalize it.",
    { home_owner_info: homeOwnerInfo, job_details: jobDetails },
    W,
    async (a) => {
      const body = {};
      if (a.home_owner_info) {
        const check = checkHomeOwnerInfo(await canonicalizeAddress(a.home_owner_info, userJwt));
        if (check.error) return check.error;
        body.home_owner_info = check.hoi;
      }
      if (a.job_details) {
        const jdCheck = checkJobDetails(a.job_details);
        if (jdCheck.error) return jdCheck.error;
        body.job_details = { ...a.job_details };
        if (a.job_details.job_type) {
          const jr = await resolveJobType(a.job_details.job_type, userJwt);
          if (jr.unresolved) return { missing_required: ["job_type"], valid_job_types: jr.unresolved.options, note: jr.unresolved.message };
          body.job_details.job_type = jr.job_type;
        }
      }
      const res = await callApi("createReferral", "POST", null, userJwt, body);
      const g = guard(res); if (g) return g;
      const r = payload(res);
      const missing = referralMissingToFinalize(body.home_owner_info ?? a.home_owner_info, body.job_details ?? a.job_details);
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
    "Edit an existing referral (referrer details, job info, notes, or status). Notes live in job_details.notes (<= 250 characters). Phone is OPTIONAL but if given must be a real number, e.g. +17135550123 or (713) 555-0123 — US numbers can omit +1. Job value must be a number > 0 and <= 9,999,999. Zip must be 5 digits or ZIP+4 (12345 or 12345-6789). NEVER set owner consent or a signature. Pass only the fields being changed. The returned `missing_to_finalize` reflects the referral's CURRENT state after the edit — prompt the user for anything still missing.",
    { id: z.string().describe("referral UUID"), home_owner_info: homeOwnerInfo, job_details: jobDetails, status: z.string().optional().describe("e.g. Draft, Ready — only if the user explicitly asks to change status") },
    W,
    async (a) => {
      const body = { id: a.id };
      if (a.home_owner_info) {
        const check = checkHomeOwnerInfo(await canonicalizeAddress(a.home_owner_info, userJwt));
        if (check.error) return check.error;
        body.home_owner_info = check.hoi;
      }
      if (a.job_details) {
        const jdCheck = checkJobDetails(a.job_details);
        if (jdCheck.error) return jdCheck.error;
        body.job_details = { ...a.job_details };
        if (a.job_details.job_type) {
          const jr = await resolveJobType(a.job_details.job_type, userJwt);
          if (jr.unresolved) return { missing_required: ["job_type"], valid_job_types: jr.unresolved.options, note: jr.unresolved.message };
          body.job_details.job_type = jr.job_type;
        }
      }
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

  // Wrong-target guard for destructive tools (bug-bash 2026-07-24): a hallucinated/stale id
  // once deleted a DIFFERENT campaign than the one the user named, and nothing caught it. Every
  // named delete now requires the target's NAME alongside the id; the tool fetches the record
  // and refuses on mismatch, naming what the id actually belongs to.
  const nameMismatch = (expected, actual, kind) => {
    const e = (expected ?? "").trim().toLowerCase();
    const act = (actual ?? "").trim().toLowerCase();
    if (!e || !act || e === act) return null;
    return {
      error: `STOP — that id belongs to the ${kind} "${actual}", not "${expected}". Nothing was deleted. Look the ${kind} up again (fresh list/search in THIS conversation) and retry with the matching id and name.`,
    };
  };

  t("delete_referral",
    "Delete a referral permanently (also removes its gallery images). Irreversible. Pass BOTH the id AND the referrer's exact name — the tool verifies they match before deleting (a mismatch deletes nothing).",
    { id: z.string().describe("referral UUID"), referrer_name: z.string().optional().describe("REQUIRED — the referral's referrer name, for verification") },
    D,
    async (a) => {
      if (!a.referrer_name?.trim()) return { missing_required: ["referrer_name"], note: "Pass the referrer's exact name with the id — it's verified against the record before deleting." };
      const rb = await callApi("getReferralById", "POST", null, userJwt, { id: a.id });
      const gr = guard(rb); if (gr) return gr;
      const actual = payload(rb)?.home_owner_info?.name ?? null;
      const mm = nameMismatch(a.referrer_name, actual, "referral"); if (mm) return mm;
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
      campaign_id: z.string().optional().describe("ONLY to resume a draft this tool already created whose design/QR step failed — skips re-creating and retries attaching (both retry steps are safe to re-run)"),
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

      // 3. step 1 — metadata (creates the Draft campaign). Skipped on a RESUME (a.campaign_id
      //    set): the draft already exists, we only retry the failed attach/link steps — both
      //    idempotent (step 2 re-sets the same design; the QR link re-writes the same URL).
      let campaign_id = a.campaign_id;
      if (!campaign_id) {
        const s1 = await callApi("createCampaignV2", "POST", null, userJwt, {
          step: 1,
          campaign_name: a.campaign_name.trim(),
          target_type: a.target_type === "referral" ? "Referrals" : "Location Zone",
          ...(a.target_type === "referral" ? { referral_id: a.referral_id } : {}),
          disclaimer_text: a.disclaimer_text,
          ...(a.start_date ? { start_date: a.start_date } : {}),
        });
        const g1 = guard(s1); if (g1) return g1;
        campaign_id = payload(s1)?.id;
        if (!campaign_id) return { error: "Could not create the campaign (no id returned)." };
      }

      // 4. step 2 — attach the design.
      const s2 = await callApi("createCampaignV2", "POST", null, userJwt, { step: 2, campaign_id, template_bundle_id: a.template_bundle_id });
      const g2 = guard(s2); if (g2) return { ...g2, campaign_id, note: "The campaign draft exists but attaching the design failed. Retry by calling create_campaign again with the SAME fields plus this campaign_id — it resumes instead of creating a duplicate." };

      // 5. link the QR URL if the design uses one.
      if (hasQr && a.qr_url) {
        const qr = await callApi("linkQRCodeToCampaign", "POST", null, userJwt, { campaign_id, qr_url: a.qr_url });
        const gq = guard(qr); if (gq) return { ...gq, campaign_id, note: "Design attached but linking the QR URL failed. Retry by calling create_campaign again with the SAME fields plus this campaign_id — it resumes instead of creating a duplicate." };
      }

      return {
        campaign_id,
        campaign_name: a.campaign_name.trim(),
        status: "Draft",
        note: "Campaign created as a draft with its design attached. NEXT: set the mailing audience (map targeting) for it, then the user completes consents + payment to launch in the app. The audience isn't set yet, and it hasn't been launched.",
      };
    }, "campaigns");

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
    }, "campaigns");

  t("delete_campaign",
    "Delete a campaign permanently. Irreversible — confirm the user really means this campaign. Pass BOTH the id AND the campaign's exact name — the tool verifies they match before deleting (a mismatch deletes nothing). Get the id fresh from list/search in THIS conversation; never reuse a remembered id.",
    { id: z.string().describe("campaign UUID"), name: z.string().optional().describe("REQUIRED — the campaign's exact name, for verification") },
    D,
    async (a) => {
      if (!a.name?.trim()) return { missing_required: ["name"], note: "Pass the campaign's exact name with the id — it's verified against the record before deleting." };
      const cb = await callApi("getCampaignById", "POST", null, userJwt, { id: a.id });
      const gc = guard(cb); if (gc) return gc;
      const actual = payload(cb)?.campaign_name ?? null;
      const mm = nameMismatch(a.name, actual, "campaign"); if (mm) return mm;
      const res = await callApi("deleteCampaign", "DELETE", null, userJwt, { id: a.id });
      return guard(res) ?? { id: a.id, name: actual ?? a.name, deleted: true };
    }, "campaigns");

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
      // getTemplateBundleById returns template fields in snake_case (postcard_size) — hedge
      // camelCase too, like the read-side bundleRow, in case the shape ever normalizes.
      const postcardSize = b?.front_template?.postcard_size ?? b?.front_template?.postcardSize
        ?? b?.back_template?.postcard_size ?? b?.back_template?.postcardSize;
      if (!html_front || !html_back || !postcardSize) return { error: "Couldn't read the source design's contents to duplicate it." };
      const baseName = (b?.front_template?.description ?? "Design").replace(/\s+Front$/i, "");
      const description = a.new_name?.trim() || `${baseName} (Copy)`;
      const res = await callApi("createNewTemplateBundle", "POST", null, userJwt, { description, html_front, html_back, postcardSize });
      const g = guard(res); if (g) return g;
      const nb = payload(res);
      const newId = nb?.bundle?.id ?? nb?.id;
      return {
        id: newId,
        name: description,
        postcardSize,
        note: `Duplicated. SHOW the user the new design: emit a PostcardPreview block with bundleId "${newId}".`,
      };
    }, "template_management");

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
      return guard(res) ?? {
        bundle_id: a.bundle_id,
        updated: true,
        note: `Updated. SHOW the user the design: emit a PostcardPreview block with bundleId "${a.bundle_id}".`,
      };
    }, "template_management");

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
      campaign_id: z.string().optional().describe("ONLY to resume a draft this tool already created whose design/QR step failed — skips re-creating and retries attaching (both retry steps are safe to re-run)"),
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

      // Step 1 is skipped on a RESUME (a.campaign_id set) — same semantics as create_campaign.
      let campaign_id = a.campaign_id;
      if (!campaign_id) {
        const s1 = await callApi("createCampaignV2", "POST", null, userJwt, {
          step: 1,
          campaign_name: a.campaign_name.trim(),
          target_type: "Address List",
          disclaimer_text: a.disclaimer_text,
          ...(a.start_date ? { start_date: a.start_date } : {}),
        });
        const g1 = guard(s1); if (g1) return g1;
        campaign_id = payload(s1)?.id;
        if (!campaign_id) return { error: "Could not create the campaign (no id returned)." };
      }

      const s2 = await callApi("createCampaignV2", "POST", null, userJwt, { step: 2, campaign_id, template_bundle_id: a.template_bundle_id });
      const g2 = guard(s2); if (g2) return { ...g2, campaign_id, note: "The campaign draft exists but attaching the design failed. Retry by calling create_address_list_campaign again with the SAME fields plus this campaign_id — it resumes instead of creating a duplicate." };

      if (hasQr && a.qr_url) {
        const qr = await callApi("linkQRCodeToCampaign", "POST", null, userJwt, { campaign_id, qr_url: a.qr_url });
        const gq = guard(qr); if (gq) return { ...gq, campaign_id, note: "Design attached but linking the QR URL failed. Retry by calling create_address_list_campaign again with the SAME fields plus this campaign_id — it resumes instead of creating a duplicate." };
      }

      return {
        campaign_id,
        campaign_name: a.campaign_name.trim(),
        status: "Draft",
        note: "Address-list campaign created as a draft with its design attached. NEXT: render the CSV uploader card for this campaign so the user can attach their address list. After that: optional address verification ($0.025/address, user-completed) or skip, then the user launches in the launch screen. Nothing is uploaded, verified, or launched yet.",
      };
    }, "campaigns");

  t("remove_invalid_addresses",
    "Exclude every INVALID address (missing mandatory fields) from a campaign's uploaded address list, in bulk.",
    { list_id: z.string().describe("the csv address list id") },
    W,
    async (a) => {
      const res = await callApi("removeAllInvalidAddresses", "POST", null, userJwt, { list_id: a.list_id });
      const g = guard(res); if (g) return g;
      const n = payload(res)?.updated_count;
      // Never assert a false "0" — if the count field is ever absent, say "done" without a number.
      return typeof n === "number"
        ? { list_id: a.list_id, excluded: n }
        : { list_id: a.list_id, done: true, note: "Invalid addresses were excluded; the exact count wasn't reported — use get_address_list for current totals." };
    }, "campaigns");

  t("remove_duplicate_addresses",
    "Exclude every DUPLICATE address from a campaign's uploaded address list, in bulk (the first occurrence of each address stays).",
    { list_id: z.string().describe("the csv address list id") },
    W,
    async (a) => {
      const res = await callApi("removeAllDuplicateAddresses", "POST", null, userJwt, { list_id: a.list_id });
      const g = guard(res); if (g) return g;
      const n = payload(res)?.excluded_count ?? payload(res)?.updated_count; // fn returns excluded_count (updated_count on the no-op path)
      return typeof n === "number"
        ? { list_id: a.list_id, excluded: n }
        : { list_id: a.list_id, done: true, note: "Duplicates were excluded; the exact count wasn't reported — use get_address_list for current totals." };
    }, "campaigns");

  t("delete_addresses",
    "Remove specific addresses from a campaign's uploaded address list (they won't receive postcards). Irreversible for this list.",
    { list_id: z.string(), address_ids: z.array(z.string()).min(1).describe("ids of the addresses to remove") },
    D,
    async (a) => {
      const res = await callApi("deleteCSVAddresses", "POST", null, userJwt, { list_id: a.list_id, address_ids: a.address_ids });
      const g = guard(res); if (g) return g;
      const r = payload(res);
      return { list_id: a.list_id, removed: r?.updated_count ?? a.address_ids.length };
    }, "campaigns");

  t("set_verification_skip",
    "Set whether an address-list campaign SKIPS the optional paid address verification ($0.025/address). skip=true lets it launch unverified; skip=false re-enables the verification requirement. This toggles intent only — it never charges; actual verification is completed by the user in the app.",
    { csv_address_list_id: z.string(), skip: z.boolean() },
    W,
    async (a) => {
      const res = await callApi("updateCampaignVerification", "POST", null, userJwt, { csv_address_list_id: a.csv_address_list_id, skip_address_verification: a.skip });
      return guard(res) ?? { csv_address_list_id: a.csv_address_list_id, skip_address_verification: a.skip };
    }, "campaigns");

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
    }, "template_management");

  t("unshare_agency_template",
    "Stop sharing an agency-owned postcard design with specific client organizations (removes them from the share list).",
    { bundle_id: z.string(), organization_ids: z.array(z.string()).min(1) },
    W,
    async (a) => {
      const res = await callApi("unshareTemplateBundleV3", "POST", null, userJwt, { template_bundle_id: a.bundle_id, organization_ids: a.organization_ids });
      const g = guard(res); if (g) return g;
      const r = payload(res);
      return { bundle_id: a.bundle_id, shared_with: r?.shared_with_organization_ids ?? [] };
    }, "template_management");

  t("delete_template_bundle",
    "Delete a postcard design bundle permanently (removes it from PostGrid too). Irreversible — confirm the user means this design. Pass BOTH the bundle id AND the design's exact name — the tool verifies they match before deleting. Requires OWNER/ADMIN of the design's owning organization.",
    { bundle_id: z.string(), name: z.string().optional().describe("REQUIRED — the design's exact name, for verification") },
    D,
    async (a) => {
      // This edge fn uniquely requires the PostGrid key in the BODY (create/update use their own env).
      if (!POSTGRID_POSTCARD_API_KEY) return { error: "Design deletion isn't available right now — it needs additional server configuration. The user can delete it from the Templates page." };
      if (!a.name?.trim()) return { missing_required: ["name"], note: "Pass the design's exact name with the bundle id — it's verified against the record before deleting." };
      const bb = await callApi("getTemplateBundleById", "GET", { bundle_id: a.bundle_id }, userJwt);
      const gb = guard(bb); if (gb) return gb;
      const p = payload(bb);
      const actual = (p?.front_template?.description ?? p?.back_template?.description ?? "").replace(/\s+(front|back)$/i, "").trim() || null;
      const mm = nameMismatch(a.name, actual, "design"); if (mm) return mm;
      const res = await callApi("deleteTemplateBundle", "POST", null, userJwt, { template_bundle_id: a.bundle_id, postgridApiKey: POSTGRID_POSTCARD_API_KEY });
      return guard(res) ?? { bundle_id: a.bundle_id, name: actual ?? a.name, deleted: true };
    }, "template_management");

  // ── Organizations (3C-4) ─────────────────────────────────────────────────────
  // createOrganization inserts a BLANK org; the V1 completeOnboarding step-dispatch fn (accepts
  // organization_id on every step — no org switch needed) fills it. Step 4 MUST always run (even
  // with no invites) — it sets team_onboarding_completed, the only thing that marks the org
  // complete; without it the org is a "Setup N of 4" artifact that traps users in the wizard.
  // The logo is REQUIRED (mirrors the onboarding UI) and must be a URL (gallery/https) — the
  // JSON path; never multipart (that branch has a latent backend bug). theme is deliberately
  // NEVER sent: V1 step 3 would write it to the CALLER's user-level branding_settings.
  const ZIP_RE = /^\d{5}(-\d{4})?$/;
  const orgOnboardingFields = {
    business_name: z.string().optional().describe("REQUIRED"),
    industry: z.string().optional().describe("REQUIRED"),
    country: z.string().optional().describe("REQUIRED (e.g. United States of America)"),
    street_address: z.string().optional().describe("REQUIRED"),
    city: z.string().optional().describe("REQUIRED"),
    state: z.string().optional().describe("REQUIRED"),
    zip: z.string().optional().describe("REQUIRED, ##### or #####-####"),
    logo_url: z.string().optional().describe("REQUIRED — an https:// image URL (upload via the image card or pick from the gallery)"),
    business_email: z.string().optional(),
    phone: z.string().optional(),
    website: z.string().optional(),
    invite_emails: z.array(z.object({ email: z.string().email(), role: memberRole.optional() })).optional().describe("teammates to invite during setup (optional)"),
  };
  const onboardingStepCalls = {
    1: (a, orgId) => callApi("completeOnboarding", "POST", null, userJwt, {
      step: 1, organization_id: orgId, business_name: a.business_name, industry: a.industry,
      ...(a.phone ? { business_phone_number: a.phone } : {}),
      ...(a.business_email ? { business_email: a.business_email } : {}),
      ...(a.website ? { website_url: a.website } : {}),
    }),
    2: (a, orgId) => callApi("completeOnboarding", "POST", null, userJwt, {
      step: 2, organization_id: orgId, country: a.country, street_address: a.street_address, city: a.city, state: a.state, zip: a.zip,
    }),
    3: (a, orgId) => callApi("completeOnboarding", "POST", null, userJwt, { step: 3, organization_id: orgId, company_logo: a.logo_url }),
    4: (a, orgId) => callApi("completeOnboarding", "POST", null, userJwt, { step: 4, organization_id: orgId, team_member_ids: [], invite_emails: a.invite_emails ?? [] }),
  };
  const STEP_REQUIREMENTS = { 1: ["business_name", "industry"], 2: ["country", "street_address", "city", "state", "zip"], 3: ["logo_url"], 4: [] };
  const missingForSteps = (a, steps) => {
    const miss = [];
    for (const s of steps) for (const f of STEP_REQUIREMENTS[s]) if (!a[f]?.trim?.() && !a[f]) miss.push(f);
    if (steps.includes(2) && a.zip && !ZIP_RE.test(a.zip)) miss.push("zip (format #####)");
    if (steps.includes(3) && a.logo_url && !/^https?:\/\//i.test(a.logo_url)) miss.push("logo_url (must be an http(s) URL)");
    return [...new Set(miss)];
  };
  const runOnboardingSteps = async (a, orgId, steps) => {
    for (const s of steps) {
      const res = await onboardingStepCalls[s](a, orgId);
      const g = guard(res);
      if (g) return { ...g, organization_id: orgId, failed_step: s, note: `The organization exists but onboarding stopped at step ${s}. Fix the issue and use complete_org_onboarding to finish it.` };
    }
    return null;
  };

  t("create_client_organization",
    "Create a NEW client organization and complete its full setup in one step (agency owners/admins only). GATHER everything first: business name, industry, full address (country/street/city/state/zip), and a LOGO (an image URL — have the user upload one via the image card or pick a gallery image). Optional: business email, phone, website, and teammates to invite. Returns `missing_required` for anything absent. After success, offer to switch into the new organization. Do NOT claim the organization is ready until this returns success.",
    orgOnboardingFields,
    W,
    async (a) => {
      const missing = missingForSteps(a, [1, 2, 3, 4]);
      if (missing.length) return { missing_required: missing, note: "Ask the user for these, then call create_client_organization again. The logo can come from the image-upload card or their gallery." };
      const created = await callApi("createOrganization", "POST", null, userJwt, {});
      const gc = guard(created);
      if (gc) {
        if (/MULTI_ORG_NOT_ENABLED|FORBIDDEN/i.test(created.body ?? "")) return { error: "Creating organizations needs an agency account. If they want multiple organizations, they can switch their account to an agency first." };
        return gc;
      }
      const orgId = payload(created)?.organization_id ?? created?.organization_id;
      if (!orgId) return { error: "Could not create the organization (no id returned)." };
      const failed = await runOnboardingSteps(a, orgId, [1, 2, 3, 4]);
      if (failed) return failed;
      return {
        organization_id: orgId,
        business_name: a.business_name.trim(),
        onboarding_complete: true,
        invites_sent: (a.invite_emails ?? []).map((i) => i.email),
        note: "The organization is fully set up (details, address, logo, team step). Offer the user a switch button to start working in it.",
      };
    });

  t("complete_org_onboarding",
    "Finish the setup of an organization that's stuck mid-onboarding ('Setup N of 4'). Pass the organization id plus whatever fields its REMAINING steps need — the tool checks what's missing, runs only the unfinished steps, and always completes the final team step. Use when the user's organization list shows an org that isn't fully set up.",
    { organization_id: z.string(), ...orgOnboardingFields },
    W,
    async (a) => {
      const stepRes = await callApi("getOnboardingStep", "GET", { organization_id: a.organization_id }, userJwt);
      const gs = guard(stepRes); if (gs) return gs;
      const sp = payload(stepRes);
      const completed = sp?.completed_step ?? 0;
      if (completed >= 4) return { organization_id: a.organization_id, onboarding_complete: true, note: "This organization's setup is already complete." };
      const steps = [1, 2, 3, 4].filter((s) => s > completed);
      const missing = missingForSteps(a, steps);
      if (missing.length) return { missing_required: missing, note: `Setup is at step ${completed} of 4 — the remaining steps need these fields. Ask the user, then call again.` };
      const failed = await runOnboardingSteps(a, a.organization_id, steps);
      if (failed) return failed;
      return { organization_id: a.organization_id, onboarding_complete: true, steps_run: steps, note: "Setup finished. Offer the user a switch button if they want to work in it now." };
    });

  t("switch_to_agency_account",
    "Convert the user's account to an AGENCY account. IRREVERSIBLE (only support can undo it) and allowed once per account. What happens: a NEW agency organization is created, the user's current business becomes its first client (all its data and members untouched), and the user gains agency-wide admin powers. BEFORE calling this, you MUST have told the user, in plain words: it can't be undone, a new agency workspace is created, their business becomes its first client, and one account can only ever have one agency. Requires the agency's name and a logo (image URL). NEVER suggest this conversion yourself — only act on the user's explicit request.",
    {
      agency_name: z.string().optional().describe("REQUIRED, the new agency's name (<=120 chars)"),
      logo_url: z.string().optional().describe("REQUIRED — an https:// image URL for the agency logo"),
      agency_type: z.enum(["Marketing agency", "Lead-generation agency", "Print/mail agency", "Consulting", "Other"]).optional(),
      website_url: z.string().optional(),
      first_client_organization_id: z.string().optional().describe("which of their businesses becomes the first client (defaults to the active one)"),
    },
    D,
    async (a) => {
      const missing = [];
      if (!a.agency_name?.trim()) missing.push("agency_name");
      if (!a.logo_url) missing.push("logo_url");
      if (missing.length) return { missing_required: missing, note: "Ask the user for these (the logo can come from the image-upload card), then call again." };
      if (a.agency_name.trim().length > 120) return { error: "The agency name must be 120 characters or fewer." };
      if (!/^https?:\/\//i.test(a.logo_url)) return { error: "The logo must be an http(s) image URL — upload one via the image card first." };
      // Pre-check: already an agency → friendly early exit (matches the backend's ALREADY_AGENCY gate).
      const orgsRes = await callApi("getUserOrganizations", "GET", null, userJwt);
      if (!orgsRes?.__error) {
        const orgs = payload(orgsRes);
        const arr = Array.isArray(orgs) ? orgs : (orgs?.organizations ?? []);
        if (arr.some((o) => (o.is_agency ?? o.isAgencyAccount) === true)) {
          return { error: "This account already has an agency — an account can only ever have one." };
        }
      }
      const res = await callApi("switchToAgencyAccount", "POST", null, userJwt, {
        agency_name: a.agency_name.trim(),
        agency_logo: a.logo_url,
        ...(a.agency_type ? { agency_type: a.agency_type } : {}),
        ...(a.website_url ? { website_url: a.website_url } : {}),
        ...(a.first_client_organization_id ? { organization_id: a.first_client_organization_id } : {}),
      });
      const g = guard(res);
      if (g) {
        if (/ALREADY_AGENCY/i.test(res.body ?? "")) return { error: "This account already has an agency — an account can only ever have one." };
        if (/NO_BUSINESS_ORG/i.test(res.body ?? "")) return { error: "There's no business organization on this account to convert." };
        return g;
      }
      const r = payload(res);
      return {
        agency_organization_id: r?.agency?.organization_id,
        agency_name: r?.agency?.agency_name ?? a.agency_name.trim(),
        first_client: r?.first_client ? { organization_id: r.first_client.organization_id, business_name: r.first_client.business_name } : null,
        note: "The account is now an agency. IMPORTANT: the app needs a refresh to see it — render an OrgSwitchButton with refresh_account=true and this agency_organization_id so the user can enter their new agency workspace. Their business is the agency's first client, untouched.",
      };
    });
}
