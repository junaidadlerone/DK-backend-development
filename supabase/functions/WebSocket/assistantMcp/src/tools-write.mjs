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

export function registerWriteTools(server, { userJwt }) {
  const W = { readOnlyHint: false, destructiveHint: false };
  const D = { readOnlyHint: false, destructiveHint: true };
  const t = (name, description, inputSchema, annotations, handler) =>
    server.registerTool(name, { description, inputSchema, annotations }, wrap(handler));

  // ── Referrals ──────────────────────────────────────────────────────────────
  t("create_referral",
    "Create a new referral. Fill the referrer's details and job info from what the user gives you; NEVER fill owner consent or a signature — those are the user's to complete. The referral is created in DRAFT; after it's created, tell the user to open it and complete the consent section to finalize it.",
    { home_owner_info: homeOwnerInfo, job_details: jobDetails },
    W,
    async (a) => {
      const body = {};
      if (a.home_owner_info) body.home_owner_info = a.home_owner_info;
      if (a.job_details) body.job_details = a.job_details;
      const res = await callApi("createReferral", "POST", null, userJwt, body);
      const g = guard(res); if (g) return g;
      const r = payload(res);
      return { id: r?.id, status: r?.status?.name ?? r?.status ?? "Draft", note: "Created as a draft. Ask the user to complete the consent section to finalize it." };
    });

  t("update_referral",
    "Edit an existing referral (referrer details, job info, notes, or status). Notes live in job_details.notes. NEVER set owner consent or a signature. Pass only the fields being changed.",
    { id: z.string().describe("referral UUID"), home_owner_info: homeOwnerInfo, job_details: jobDetails, status: z.string().optional().describe("e.g. Draft, Ready — only if the user explicitly asks to change status") },
    W,
    async (a) => {
      const body = { id: a.id };
      if (a.home_owner_info) body.home_owner_info = a.home_owner_info;
      if (a.job_details) body.job_details = a.job_details;
      if (a.status) body.status = a.status;
      const res = await callApi("updateReferralById", "PATCH", null, userJwt, body);
      return guard(res) ?? { id: a.id, updated: true };
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
}
