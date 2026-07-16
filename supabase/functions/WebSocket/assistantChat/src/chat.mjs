/**
 * POST /chat — DoorKnocker+ assistant, Tiers 1–2.
 *
 * The namiGateway spine (ai_audiobook_backend/.../namiGateway/src/index.mjs): validate the
 * user's Supabase JWT, call Flowise's streaming Prediction API, re-frame its SSE events into
 * the frontend contract, and mirror messages into chat_sessions / chat_messages.
 *
 *   body     { message, session_id?, context? }   (mode accepted and ignored until Tier 3)
 *   auth     Authorization: Bearer <user's Supabase JWT>
 *   stream   data: {delta}                        token text (leak-filtered, de-dashed)
 *            data: {type:"thinking", delta}       live tool-call steps (Tier 2)
 *            data: {type:"ui", ...}               generative-UI surfaces from emit_ui (Tier 2)
 *            data: {error}                        one friendly line (raw detail stays in logs)
 *            data: {done, session_id, awaiting_approval:false}
 *
 * Tier-2 branches (re-enabled from namiGateway): vars threading (userJwt + page ids →
 * overrideConfig.vars → Flowise customMCP header), context preamble injection,
 * calledTools→thinking, usedTools→ui_job_id→inlineJobEvents→{type:"ui"}, leak/redact filters.
 * `context` accepts BOTH shapes: the legacy widget's {page:"Dashboard", path:"/dashboard",
 * entity?} (page token derived from path — zero frontend changes needed) and the Stage-F
 * {page:"dashboard", campaign_id?, template_id?, zone_id?, referral_id?}.
 *
 * Still absent (Tier 3): HITL sentinels/human_input, auto/manual modes, refresh frames,
 * {type:"job"} announcements. Session-ownership check on resume is from chatKabuki.
 */

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const FLOWISE_URL = process.env.FLOWISE_URL ?? "";
const FLOWISE_FLOW_ID = process.env.FLOWISE_FLOW_ID ?? "";
const FLOWISE_API_KEY = process.env.FLOWISE_API_KEY ?? "";
const ASSISTANT_MCP_URL = (process.env.ASSISTANT_MCP_URL ?? "").replace(/\/+$/, "");

// Lazy/conditional client so a sync-only deployment (no chat env vars yet) still boots.
const chatConfigured = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY && FLOWISE_URL && FLOWISE_FLOW_ID);
const adminSupabase = SUPABASE_URL && SUPABASE_SERVICE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) : null;

// ── auth (namiGateway verbatim) ───────────────────────────────────────────────
async function authenticate(req) {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const { data, error } = await adminSupabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return { userId: data.user.id, userJwt: token };
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
  [/^\/agency/, () => ({ page: "agency" })],
  [/^\/team/, () => ({ page: "team" })],
  [/^\/settings/, () => ({ page: "settings" })],
  [/^\/profile/, () => ({ page: "profile" })],
];
const ENTITY_ID_KEY = { campaign: "campaign_id", template: "template_id", templateBundle: "template_id", zone: "zone_id", referral: "referral_id" };

export function normalizeContext(context) {
  if (!context || typeof context !== "object") return null;
  // Stage-F shape: already tokenized (lowercase page, snake_case ids).
  if (context.campaign_id || context.template_id || context.zone_id || context.referral_id
      || (typeof context.page === "string" && /^[a-z_]+$/.test(context.page) && !context.path)) {
    const { page, campaign_id, template_id, zone_id, referral_id } = context;
    return { page: page ?? "unknown", campaign_id, template_id, zone_id, referral_id };
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
  return out;
}

// ── thinking labels (Tier 2) — one per MCP tool ───────────────────────────────
const THINKING_LABELS = {
  // Flowise reports the agent's Pinecone knowledge attachment as a tool call too.
  doorknocker_product_docs: "Checking the product docs…",
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
};
const thinkingLabel = (tool) => THINKING_LABELS[tool] ?? `Running ${String(tool).replace(/_/g, " ")}…`;

// ── leak filters + redaction (Tier 2) ─────────────────────────────────────────
// Flowise synthesizes "Attempting to use tool…" text around tool pauses, and
// deepseek can leak raw tool markup; strip both plus any literal emit_ui markup.
const LEAK_MARKERS = ["Attempting to use tool", "｜DSML｜", "<emit_ui", "<emitui"];
const KEEP_BACK = Math.max(...LEAK_MARKERS.map((m) => m.length)) - 1;
const deDash = (s) => s.replace(/\s*—\s*/g, ", ").replace(/\s+–\s+/g, ", ");
// Redact infra strings the model must never surface (tool names, service hosts, api paths).
const redact = (s) => s
  .replace(/https?:\/\/[^\s)\]]*run\.app[^\s)\]]*/gi, "our system")
  .replace(/https?:\/\/[^\s)\]]*supabase\.co[^\s)\]]*/gi, "our system")
  .replace(/\/api\/v\d[^\s)\]]*/gi, "our system")
  .replace(/\b(?:get|list|search|emit)_[a-z][a-z_]+\b/g, "our system");
const clean = (s) => redact(deDash(s));

// GenUI frames are forwarded raw, so the same hygiene applies inside them —
// deDash every string; redact only human-visible text fields (URLs/ids survive).
const VISIBLE_TEXT_KEYS = new Set(["text", "title", "label", "caption", "subtitle", "proceedLabel"]);
const deepClean = (val, key) => {
  if (typeof val === "string") return VISIBLE_TEXT_KEYS.has(key) ? clean(val) : deDash(val);
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
async function inlineJobEvents(jobId, userJwt, send) {
  if (!ASSISTANT_MCP_URL) return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(`${ASSISTANT_MCP_URL}/jobs/${jobId}/events`, {
      headers: { Authorization: `Bearer ${userJwt}` },
      signal: ctrl.signal,
    });
    if (!r.ok || !r.body) { clearTimeout(timer); return; }
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
        if (frame.type === "ui") send(cleanUiFrame(frame));
      }
    }
    clearTimeout(timer);
  } catch { /* buffered-frame fetch is best-effort */ }
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
async function persistTurn(sessionId, userMessage, assistantReply) {
  const rows = [];
  if (userMessage) rows.push({ session_id: sessionId, role: "user", content: userMessage });
  if (assistantReply) rows.push({ session_id: sessionId, role: "assistant", content: assistantReply });
  if (rows.length) await adminSupabase.from("chat_messages").insert(rows);
}

// ── the handler ───────────────────────────────────────────────────────────────
export async function chatHandler(req, res) {
  if (!chatConfigured) {
    res.status(503).json({ error: "Chat is not configured on this deployment" });
    return;
  }

  const auth = await authenticate(req);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { message, session_id, context } = req.body ?? {};
  // `mode` may also arrive — accepted and ignored until Tier 3.
  if (typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  const ctx = normalizeContext(context);

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
    let question = message;
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

    const predictionBody = {
      question,
      streaming: true,
      chatId: sessionId,
      overrideConfig: {
        sessionId,
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

    // ── Delta emitter (namiGateway pattern) ───────────────────────────────────
    // Buffers with a keep-back margin so split LEAK_MARKERS are still caught, cuts
    // only at whitespace (so redact() always sees complete URLs/identifiers), and
    // applies clean() = redact(deDash(…)) to everything emitted. On a marker hit,
    // everything from the marker on is suppressed for the rest of the turn.
    let pendingText = "";
    let assistantReply = "";
    let suppressRest = false;
    const earliestMarker = (s) => LEAK_MARKERS.map((m) => s.indexOf(m)).filter((i) => i !== -1).sort((a, b) => a - b)[0];
    const emitDelta = (chunk) => {
      if (suppressRest || !chunk) return;       // Flowise leads with empty token events
      pendingText += chunk;
      const hit = earliestMarker(pendingText);
      if (hit !== undefined) {
        const before = clean(pendingText.slice(0, hit).replace(/\s+$/, ""));
        if (before) { assistantReply += before; send({ delta: before }); }
        pendingText = ""; suppressRest = true; return;
      }
      const safeEnd = pendingText.length - KEEP_BACK;
      if (safeEnd <= 0) return;
      const region = pendingText.slice(0, safeEnd);
      const cut = Math.max(region.lastIndexOf(" "), region.lastIndexOf("\n"), region.lastIndexOf("\t")) + 1;
      if (cut > 0) {
        const out = clean(pendingText.slice(0, cut));
        assistantReply += out;
        send({ delta: out });
        pendingText = pendingText.slice(cut);
      }
    };
    const flushDeltas = () => {
      if (suppressRest || !pendingText) { pendingText = ""; return; }
      const hit = earliestMarker(pendingText);
      const out = clean(hit !== undefined ? pendingText.slice(0, hit).replace(/\s+$/, "") : pendingText);
      if (out) { assistantReply += out; send({ delta: out }); }
      pendingText = "";
    };

    // Raw upstream errors are logged, never forwarded (they read as a crash).
    const friendlyError = (raw) => {
      console.error("[/chat] turn error:", (typeof raw === "string" ? raw : JSON.stringify(raw ?? "")).slice(0, 600));
      return "Something went wrong on my end. Please try that again in a moment.";
    };
    let turnError = null;

    const seenJobIds = new Set();
    const handleEvent = async (ev, data) => {
      switch (ev) {
        case "token": emitDelta(data); break;
        case "error": turnError = data; break;
        // Tier 2: a tool has been CALLED but not yet returned → live thinking step.
        case "calledTools":
          for (const t of (Array.isArray(data) ? data : [])) {
            if (t?.tool && !t?.toolOutput) send({ type: "thinking", delta: thinkingLabel(t.tool) });
          }
          break;
        // Tier 2: a tool RETURNED — if it was emit_ui, drain its buffered {type:"ui"}
        // frame from the MCP jobs side channel onto this stream.
        case "usedTools":
          for (const t of (Array.isArray(data) ? data : [])) {
            const out = typeof t?.toolOutput === "string" ? t.toolOutput : JSON.stringify(t?.toolOutput ?? "");
            const um = out.match(/\\?"ui_job_id\\?"\s*:\s*\\?"([0-9a-f-]{36})\\?"/i);
            if (um && !seenJobIds.has(um[1])) {
              seenJobIds.add(um[1]);
              await inlineJobEvents(um[1], auth.userJwt, send);
            }
          }
          break;
        // agentFlowEvent / nextAgentFlow / agentFlowExecutedData / metadata /
        // usageMetadata / end → internal; unknown events are ignored by design.
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
      while (true) {
        const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
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
    // Retry once, but only if nothing user-visible streamed yet (namiGateway's rule).
    if (turnError && !assistantReply && !upstreamAbort.signal.aborted) {
      console.warn("[/chat] recoverable turn error — retrying once");
      turnError = null;
      pendingText = "";
      suppressRest = false;
      seenJobIds.clear();
      await runAttempt();
    }

    flushDeltas();

    if (turnError) send({ error: friendlyError(turnError) });
    // Persist the user's message always (their history should show what they asked),
    // the assistant's reply only if something actually streamed.
    await persistTurn(sessionId, message, assistantReply || null);
    send({ done: true, session_id: sessionId, awaiting_approval: false });
    res.end();
  } catch (e) {
    console.error("[/chat] error:", e.message);
    try {
      send({ error: "Something went wrong on my end. Please try that again." });
      res.end();
    } catch { /* client gone */ }
  }
}
