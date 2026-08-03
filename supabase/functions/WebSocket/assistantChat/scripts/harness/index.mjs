// Replay harness for the gateway's turn logic (F1, 2026-07-31).
//
// WHY A REPLAY HARNESS AND NOT UNIT TESTS:
// the HITL defects do not live in any single function — they live in the ORDER in which
// `handleEvent` is called over per-request closure state (`outstanding`, `lastActionId`,
// `pendingAutoResume`, `sawPermission`, the attempt budget). Asserting that
// `permissionTitle(undefined) === "Confirming this action"` proves nothing that reading the
// source doesn't. The only test that can go genuinely RED for the real bug is one that feeds the
// real upstream event SEQUENCE through the real handler.
//
// So: stand up one HTTP server that impersonates every upstream the gateway talks to (Flowise's
// prediction stream, the MCP's tools/list + jobs + live-context, and Supabase's JWKS + REST), then
// mount the REAL `chatHandler` against it and read the SSE frames it produces.
//
// Fixtures under ./fixtures are CAPTURED FROM PRODUCTION FLOWISE (see DK_TRACE_FRAMES in
// chat.mjs), not hand-invented — that is the whole point. A guessed fixture would only prove the
// gateway agrees with my guess.
import express from "express";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { randomUUID } from "node:crypto";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

// Mirrors the production annotation contract: a write is auto-approvable only when it declares
// readOnlyHint:false AND destructiveHint:false. Reads declare readOnlyHint:true. The gateway
// derives its whole auto-approve policy from this shape (chat.mjs refreshToolSafety).
const DEFAULT_TOOLS = [
  { name: "search_referrals", annotations: { readOnlyHint: true } },
  { name: "get_referral", annotations: { readOnlyHint: true } },
  { name: "update_referral", annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: "create_referral", annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: "delete_referral", annotations: { readOnlyHint: false, destructiveHint: true } },
  { name: "update_campaign", annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: "emit_ui", annotations: { readOnlyHint: false, destructiveHint: false } },
];

/**
 * One server impersonating Flowise + the MCP + Supabase. Everything the gateway needs, nothing it
 * doesn't: persistence is answered successfully because it is not what these tests are about.
 */
export async function startMockStack({ tools = DEFAULT_TOOLS } = {}) {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { alg: "ES256", use: "sig", kid: "harness" });

  const state = {
    failSurfaceSelect: false, // make chat_surfaces SELECTs fail (pre-migration column)
    consumedSurfaces: new Map(), // surface_id -> interaction, remembered ACROSS turns (see below)
    frames: [],        // upstream SSE frames to replay on the next prediction call
    framesByCall: null, // or an array of frame-arrays, one per successive call (retries/resumes)
    uiFrames: [],      // frames the MCP jobs side channel should hand back
    predictions: [],   // every prediction request body the gateway sent (assert nudges/resumes here)
    restCalls: [],     // every Supabase REST call (method + path)
  };

  const app = express();
  app.use(express.json({ limit: "20mb" }));

  // ── Supabase: JWKS (the gateway verifies ES256 locally against this) ──────────
  app.get("/auth/v1/.well-known/jwks.json", (_req, res) => res.json({ keys: [jwk] }));

  // ── Supabase: REST. Persistence is not under test — succeed, but record the calls so a test
  // can assert that (say) a surface upsert happened without asserting on its result.
  app.all(/^\/rest\/v1\/.*/, (req, res) => {
    state.restCalls.push({ method: req.method, path: req.path, body: req.body });
    // Simulate a column the migration has not added yet (D4's chat_surfaces.state): PostgREST answers
    // 42703 "column does not exist". A deploy that lands ahead of its migration must degrade, not fail,
    // so that ordering has to be testable.
    if (state.failSurfaceSelect && req.method === "GET" && req.path.includes("chat_surfaces")) {
      res.status(400).json({ code: "42703", message: 'column chat_surfaces.state does not exist' });
      return;
    }
    // chat_surfaces is the ONE table this mock keeps real state for. The surface lifecycle is
    // cross-TURN by nature — a card consumed in turn 2 must still read as consumed in turn 9 — and a
    // canned row cannot express that, so the reported "stale card reappears many turns later" bug was
    // untestable until this existed. Everything else stays a canned success; persistence is not what
    // these suites are about.
    if (req.path.includes("chat_surfaces")) {
      const eqValue = (key) => {
        const raw = req.query?.[key];
        return typeof raw === "string" && raw.startsWith("eq.") ? raw.slice(3) : null;
      };
      if (req.method === "PATCH" && req.body?.state === "consumed") {
        const sid = eqValue("surface_id");
        if (sid) state.consumedSurfaces.set(sid, req.body.interaction ?? null);
      }
      if (req.method === "GET" && eqValue("state") === "consumed") {
        res.status(200).json([...state.consumedSurfaces].map(([surface_id, interaction]) => ({
          surface_id, interaction, state: "consumed",
        })));
        return;
      }
    }
    const row = { id: "00000000-0000-4000-8000-000000000001" };
    // supabase-js `.single()` asks for a bare object via Accept; everything else expects an array.
    const wantsObject = String(req.headers.accept ?? "").includes("pgrst.object");
    res.status(200).json(wantsObject ? row : [row]);
  });

  // ── Flowise: the prediction stream ───────────────────────────────────────────
  app.post("/api/v1/prediction/:flowId", (req, res) => {
    const callIndex = state.predictions.length;
    state.predictions.push(req.body);
    const frames = state.framesByCall
      ? (state.framesByCall[callIndex] ?? [])
      : state.frames;
    res.writeHead(200, SSE_HEADERS);
    for (const f of frames) {
      res.write(`data: ${JSON.stringify({ event: f.ev, data: f.data })}\n\n`);
    }
    res.end();
  });

  // ── MCP: tools/list drives the auto-approve policy ───────────────────────────
  app.post("/mcp", (_req, res) => res.json({ jsonrpc: "2.0", id: 1, result: { tools } }));
  // ── MCP: live-context prefetch (kept empty; context composition isn't under test) ──
  app.post("/live-context", (_req, res) => res.json({ context: "" }));
  // ── MCP: the emit_ui jobs side channel ───────────────────────────────────────
  app.get("/jobs/:id/events", (_req, res) => {
    res.writeHead(200, SSE_HEADERS);
    for (const f of state.uiFrames) res.write(`data: ${JSON.stringify(f)}\n\n`);
    res.end();
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const url = `http://127.0.0.1:${server.address().port}`;

  return {
    url,
    state,
    /** Replay the same frames for every upstream call this turn. */
    setFrames(frames) { state.frames = frames; state.framesByCall = null; },
    /** Replay a DIFFERENT frame set per successive upstream call — for retries and resumes. */
    setFramesByCall(list) { state.framesByCall = list; },
    setUiFrames(frames) { state.uiFrames = frames; },
    reset() { state.frames = []; state.framesByCall = null; state.uiFrames = []; state.predictions.length = 0; state.restCalls.length = 0; state.failSurfaceSelect = false; },
    /** Surface lifecycle is cross-turn, so reset() deliberately KEEPS it; use this to start clean. */
    clearConsumedSurfaces() { state.consumedSurfaces.clear(); },
    set failSurfaceSelect(v) { state.failSurfaceSelect = !!v; },
    get failSurfaceSelect() { return state.failSurfaceSelect; },
    async mintToken({ sub = randomUUID(), expiresIn = "10m" } = {}) {
      return new SignJWT({ role: "authenticated" })
        .setProtectedHeader({ alg: "ES256", kid: jwk.kid })
        .setSubject(sub)
        .setIssuer(`${url}/auth/v1`)
        .setIssuedAt()
        .setExpirationTime(expiresIn)
        .sign(privateKey);
    },
    async close() { await new Promise((r) => server.close(r)); },
  };
}

/**
 * Mount the REAL chatHandler against the mock stack.
 * chat.mjs reads its env (and builds the JWKS client) at module load, so the env must be set
 * BEFORE the dynamic import — which also means one gateway per test process.
 */
export async function startGateway(mock) {
  process.env.SUPABASE_URL = mock.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "harness-service-role-key";
  process.env.FLOWISE_URL = mock.url;
  process.env.FLOWISE_API_KEY = "harness-flowise-key";
  process.env.FLOWISE_FLOW_ID = "harness-flow";
  process.env.ASSISTANT_MCP_URL = mock.url;
  process.env.AGENT_NODE_ID = "agentAgentflow_0";

  const { chatHandler } = await import("../../src/chat.mjs");
  const app = express();
  app.use(express.json({ limit: "20mb" }));
  app.post("/chat", chatHandler);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async close() { await new Promise((r) => server.close(r)); },
  };
}

/** POST a turn and return every SSE frame the gateway streamed back, in order. */
export async function runTurn(gateway, token, body) {
  const res = await fetch(`${gateway.url}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const frames = [];
  for (const line of text.split(/\n/)) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    try { frames.push(JSON.parse(t.slice(5))); } catch { /* ignore keep-alives */ }
  }
  return { status: res.status, frames, text };
}

// ── Frame helpers ─────────────────────────────────────────────────────────────
export const uiFrames = (frames) => frames.filter((f) => f?.type === "ui");
export const thinkingLabels = (frames) => frames.filter((f) => f?.type === "thinking").map((f) => f.delta);
export const deltaText = (frames) => frames.filter((f) => typeof f?.delta === "string" && !f.type).map((f) => f.delta).join("");
export const doneFrame = (frames) => frames.find((f) => f?.done);

/** Every human-readable string inside a GenUI frame — what the user can actually read on the card. */
export function frameTexts(frame) {
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === "string" && ["text", "title", "label", "caption", "subtitle", "proceedLabel"].includes(k)) out.push(v);
      else if (v && typeof v === "object") walk(v);
    }
  };
  walk(frame);
  return out;
}

/** True when the card offers a live Approve control. */
export const hasApproveButton = (frame) =>
  frameTexts(frame).some((t) => /^approve$/i.test(t.trim()));
