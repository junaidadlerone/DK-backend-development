/**
 * dk-assistant-chat — DoorKnocker+ assistant service (Cloud Run).
 *
 * Tier 1 endpoints:
 *  GET  /health        — health check
 *  POST /api/inngest   — Inngest serve endpoint (hourly Notion→Pinecone KB sync + on-demand)
 *  POST /admin/sync    — queue a KB sync now (header x-admin-secret: $ADMIN_SYNC_SECRET)
 *  POST /chat          — [runbook §4 — added next] JWT verify → Flowise Prediction API →
 *                        SSE {delta}/{done,session_id}/{error} → persist chat_sessions/messages
 *
 * Modeled on Kabuki's production services: the Express/Inngest scaffold follows
 * chatKabuki/index.js; the (upcoming) chat spine follows namiGateway/src/index.mjs.
 */

import "dotenv/config";
import express from "express";
import { serve as inngestServe } from "inngest/express";
import { inngest, syncNotionKb } from "./sync.mjs";

const PORT = process.env.PORT || 8080;
const ADMIN_SYNC_SECRET = process.env.ADMIN_SYNC_SECRET ?? "";

const app = express();
app.use(express.json());

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

// ── POST /chat — runbook §4 lands here ────────────────────────────────────────
// (namiGateway spine: authenticate → ensureSession → Flowise prediction stream →
//  token→{delta} translation → persistTurn → {done, session_id})

// ── Startup ───────────────────────────────────────────────────────────────────

const requiredForSync = ["NOTION_TOKEN", "NOTION_DATABASE_ID", "OPENAI_KEY", "PINECONE_API_KEY"];
for (const name of requiredForSync) {
  if (!process.env[name]) console.warn(`[startup] WARNING: ${name} is not set — the KB sync will fail until it is`);
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[dk-assistant-chat] listening on :${PORT}`);
  console.log(`[dk-assistant-chat] config: notion=${!!process.env.NOTION_TOKEN} openai=${!!process.env.OPENAI_KEY} pinecone=${!!process.env.PINECONE_API_KEY} index=${process.env.PINECONE_INDEX_NAME ?? "doorknocker-kb"} inngest_signing=${!!process.env.INNGEST_SIGNING_KEY} inngest_event=${!!process.env.INNGEST_EVENT_KEY} admin_sync=${!!ADMIN_SYNC_SECRET}`);
});
