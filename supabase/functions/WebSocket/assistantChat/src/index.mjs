/**
 * dk-assistant-chat — DoorKnocker+ assistant service (Cloud Run).
 *
 * Tier 1 endpoints:
 *  GET  /health        — health check
 *  POST /api/inngest   — Inngest serve endpoint (hourly Notion→Pinecone KB sync + on-demand)
 *  POST /admin/sync    — queue a KB sync now (header x-admin-secret: $ADMIN_SYNC_SECRET)
 *  POST /chat          — JWT verify → Flowise Prediction API (Agentflow) →
 *                        SSE {delta}/{done,session_id}/{error} → persist chat_sessions/messages
 *
 * Modeled on Kabuki's production services: the Express/Inngest scaffold follows
 * chatKabuki/index.js; the chat spine (src/chat.mjs) follows namiGateway/src/index.mjs.
 */

import "dotenv/config";
import express from "express";
import { serve as inngestServe } from "inngest/express";
import { inngest, syncNotionKb } from "./sync.mjs";
import { chatHandler } from "./chat.mjs";

const PORT = process.env.PORT || 8080;
const ADMIN_SYNC_SECRET = process.env.ADMIN_SYNC_SECRET ?? "";

const app = express();

// CORS — the browser calls /chat cross-origin with Authorization + JSON, which
// triggers a preflight. Mirrors namiGateway's permissive headers.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, apikey, x-client-info");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  next();
});

app.use(express.json({ limit: "5mb" }));

// ── Health ────────────────────────────────────────────────────────────────────

app.get("/health", (_, res) => res.json({ status: "healthy", service: "dk-assistant-chat" }));
app.get("/",       (_, res) => res.json({ status: "healthy", service: "dk-assistant-chat" }));

// ── Inngest serve (cron + event-triggered KB sync) ────────────────────────────

app.use("/api/inngest", inngestServe({ client: inngest, functions: [syncNotionKb] }));

// ── Admin: queue a KB sync on demand ──────────────────────────────────────────

app.post("/admin/sync", async (req, res) => {
  if (!ADMIN_SYNC_SECRET) return res.status(503).json({ error: "ADMIN_SYNC_SECRET not configured" });
  if (req.headers["x-admin-secret"] !== ADMIN_SYNC_SECRET) return res.status(401).json({ error: "Unauthorized" });
  try {
    await inngest.send({ name: "kb/sync.requested", data: { requested_at_route: "/admin/sync" } });
    return res.status(202).json({ queued: true });
  } catch (err) {
    console.error(`[admin/sync] failed to queue: ${err.message}`);
    return res.status(500).json({ error: "Failed to queue sync" });
  }
});

// ── Chat (Tier-1 spine — see src/chat.mjs) ────────────────────────────────────

app.post("/chat", chatHandler);

// ── Startup ───────────────────────────────────────────────────────────────────

const requiredForSync = ["NOTION_TOKEN", "NOTION_DATABASE_ID", "OPENAI_KEY", "PINECONE_API_KEY"];
for (const name of requiredForSync) {
  if (!process.env[name]) console.warn(`[startup] WARNING: ${name} is not set — the KB sync will fail until it is`);
}
const requiredForChat = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "FLOWISE_URL", "FLOWISE_FLOW_ID", "FLOWISE_API_KEY"];
for (const name of requiredForChat) {
  if (!process.env[name]) console.warn(`[startup] WARNING: ${name} is not set — POST /chat will return 503 until it is`);
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[dk-assistant-chat] listening on :${PORT}`);
  console.log(`[dk-assistant-chat] config: notion=${!!process.env.NOTION_TOKEN} openai=${!!process.env.OPENAI_KEY} pinecone=${!!process.env.PINECONE_API_KEY} index=${process.env.PINECONE_INDEX_NAME ?? "doorknocker-kb"} inngest_signing=${!!process.env.INNGEST_SIGNING_KEY} inngest_event=${!!process.env.INNGEST_EVENT_KEY} admin_sync=${!!ADMIN_SYNC_SECRET} supabase=${!!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY} flowise=${!!process.env.FLOWISE_URL && !!process.env.FLOWISE_FLOW_ID}`);
});
