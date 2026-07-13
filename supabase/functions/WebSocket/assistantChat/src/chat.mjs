/**
 * POST /chat — DoorKnocker+ assistant, Tier 1.
 *
 * The stripped namiGateway spine (ai_audiobook_backend/.../namiGateway/src/index.mjs):
 * validate the user's Supabase JWT, call Flowise's streaming Prediction API, re-frame its
 * SSE events into the frontend contract, and mirror messages into chat_sessions /
 * chat_messages so the existing history sidebar keeps working.
 *
 *   body     { message, session_id? }         (mode / context are accepted and IGNORED in
 *                                              Tier 1 — Tier 2 consumes context, Tier 3 mode)
 *   auth     Authorization: Bearer <user's Supabase JWT>
 *   stream   data: {delta}                     token text
 *            data: {error}                     one friendly line (raw detail stays in logs)
 *            data: {done, session_id, awaiting_approval:false}
 *
 * Deliberately absent (Tier 3 machinery in namiGateway): HITL sentinels/human_input,
 * auto/manual modes, thinking labels, job frames, refresh accumulation, GenUI, MCP,
 * the live-state context preamble, and the tool-markup leak filters (no tools → no leaks).
 * Session-ownership check on resume is adopted from chatKabuki (namiGateway lacks it).
 */

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const FLOWISE_URL = process.env.FLOWISE_URL ?? "";
const FLOWISE_FLOW_ID = process.env.FLOWISE_FLOW_ID ?? "";
const FLOWISE_API_KEY = process.env.FLOWISE_API_KEY ?? "";

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

  const { message, session_id } = req.body ?? {};
  // `mode` and `context` may also arrive — accepted and ignored in Tier 1.
  if (typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

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

    const predictionBody = {
      question: message,
      streaming: true,
      chatId: sessionId,
      overrideConfig: { sessionId },   // Flowise memory scope; Tier 2 adds vars.userJwt etc.
    };

    // ── Delta emitter ─────────────────────────────────────────────────────────
    // Human-voice guarantee kept from namiGateway: strip em-dashes deterministically
    // (the prompt bans them, the model sometimes ignores that). Em-dash always; a
    // SPACED en-dash too; a bare en-dash survives so ranges like "1–3" aren't mangled.
    // A small keep-back buffer, cut at whitespace, so a dash split across two token
    // chunks is still caught. (namiGateway's LEAK_MARKERS are gone — no tools, no
    // tool-markup leaks — which is all that emitter additionally handled.)
    const deDash = (s) => s.replace(/\s*—\s*/g, ", ").replace(/\s+–\s+/g, ", ");
    const KEEP_BACK = 4;
    let pendingText = "";
    let assistantReply = "";
    const emitDelta = (chunk) => {
      if (!chunk) return;                       // Flowise leads with empty token events
      pendingText += chunk;
      const safeEnd = pendingText.length - KEEP_BACK;
      if (safeEnd <= 0) return;
      const region = pendingText.slice(0, safeEnd);
      const cut = Math.max(region.lastIndexOf(" "), region.lastIndexOf("\n"), region.lastIndexOf("\t")) + 1;
      if (cut > 0) {
        const out = deDash(pendingText.slice(0, cut));
        assistantReply += out;
        send({ delta: out });
        pendingText = pendingText.slice(cut);
      }
    };
    const flushDeltas = () => {
      if (!pendingText) return;
      const out = deDash(pendingText);
      assistantReply += out;
      send({ delta: out });
      pendingText = "";
    };

    // Raw upstream errors are logged, never forwarded (they read as a crash).
    const friendlyError = (raw) => {
      console.error("[/chat] turn error:", (typeof raw === "string" ? raw : JSON.stringify(raw ?? "")).slice(0, 600));
      return "Something went wrong on my end. Please try that again in a moment.";
    };
    let turnError = null;

    const handleEvent = (ev, data) => {
      switch (ev) {
        case "token": emitDelta(data); break;
        case "error": turnError = data; break;
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
          handleEvent(payload.event, payload.data);
        }
      }
    };

    await runAttempt();
    // Retry once, but only if nothing user-visible streamed yet (namiGateway's rule).
    if (turnError && !assistantReply && !upstreamAbort.signal.aborted) {
      console.warn("[/chat] recoverable turn error — retrying once");
      turnError = null;
      pendingText = "";
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
