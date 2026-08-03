// Job buffer — the emit_ui side channel.
// MCP tool results are request/response, so a (possibly large) UI frame can't ride back
// through Flowise without re-entering the model's context. emit_ui buffers the validated
// frame in a job instead and returns a tiny {ok, ui_job_id} ack; the gateway then pulls the
// buffered frame from GET /jobs/:id/events and forwards it onto the chat SSE as {type:"ui"}.
// (Ported from namiMcp jobs.mjs minus the WS pump — Phase 2 has no long-running tools.)
//
// Tier 3.5: the buffer is ALSO staged in the chat_ui_jobs table (service role). The in-memory
// Map is a per-process cache, so with more than one Cloud Run instance the gateway's GET could
// land on an instance that never saw the job → 404 → the card silently never rendered. The DB
// row makes the side-channel stateless across instances: memory is the same-instance fast
// path; the DB is the cross-instance truth. Rows are transient — deleted when drained via the
// DB path and swept on write when older than an hour.
import { randomUUID } from "node:crypto";
import { adminSupabase } from "./supabase.mjs";

const jobs = new Map(); // id -> { id, userId, status, events: [], listeners: Set, createdAt }
const JOB_TTL_MS = 30 * 60_000; // GC finished jobs after 30 min

export function createJob(userId, label) {
  const job = {
    id: randomUUID(),
    userId,
    label: label ?? null,
    status: "running", // running | completed | error
    result: null,
    events: [],        // replay buffer for late subscribers
    listeners: new Set(),
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

export function jobEmit(job, frame) {
  job.events.push(frame);
  for (const fn of job.listeners) { try { fn(frame); } catch { /* listener gone */ } }
}

// Stage the finished job's frames in the DB for cross-instance reads. Fire-and-forget: the
// row is normally in place long before the gateway's GET arrives (the ui_job_id has to travel
// tool→Flowise→gateway first), and the /jobs handler retries the DB read once to cover the
// remaining sliver. A failed insert only degrades to the old same-instance-only behaviour.
function stageJob(job) {
  adminSupabase
    .from("chat_ui_jobs")
    .insert({ job_id: job.id, user_id: job.userId, frames: job.events })
    .then(({ error }) => { if (error) console.error("[jobs] DB stage failed:", error.message); });
  // Opportunistic sweep of abandoned rows (drained rows are deleted on read).
  adminSupabase
    .from("chat_ui_jobs")
    .delete()
    .lt("created_at", new Date(Date.now() - 3_600_000).toISOString())
    .then(({ error }) => { if (error) console.error("[jobs] DB sweep failed:", error.message); });
}

export function jobComplete(job, result) {
  job.status = "completed";
  job.result = result;
  jobEmit(job, { type: "completed", result });
  stageJob(job);
}

export function jobFail(job, message) {
  job.status = "error";
  jobEmit(job, { type: "error", message });
  stageJob(job);
}

export function getJob(id) { return jobs.get(id); }

// GC old jobs
setInterval(() => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, j] of jobs) if (j.status !== "running" && j.createdAt < cutoff) jobs.delete(id);
}, 60_000).unref();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readStagedJob(id) {
  const { data, error } = await adminSupabase
    .from("chat_ui_jobs")
    .select("user_id, frames")
    .eq("job_id", id)
    .maybeSingle();
  if (error) { console.error("[jobs] DB read failed:", error.message); return null; }
  return data ?? null;
}

// Express handler: GET /jobs/:id/events — SSE stream (replay + live). Owner-only.
// Memory first (same instance), then the DB stage (any instance), with one short retry to
// cover an in-flight stage insert.
export async function jobEventsHandler(req, res) {
  const job = jobs.get(req.params.id);

  const sseHead = () => res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  const send = (frame) => res.write(`data: ${JSON.stringify(frame)}\n\n`);

  if (job) {
    if (job.userId !== req.auth.userId) { res.status(403).json({ error: "Forbidden" }); return; }
    sseHead();
    for (const frame of job.events) send(frame); // replay
    if (job.status !== "running") {
      res.end();
      // CONSUME ON DRAIN (2026-07-31). This used to return without deleting, so a FINISHED job's
      // frames stayed replayable for the life of the process — and because the gateway harvests
      // ui_job_ids with a regex over the whole upstream payload, a job id that reappeared in a later
      // turn's node snapshot re-rendered an old card into a new turn (the delete-a-campaign turn
      // that came back with a live audience builder and two launch buttons). The DB path already
      // deletes on read; this is the same single-use contract for the in-memory path.
      // Only finished jobs are consumed — a client reconnecting mid-stream still gets its replay.
      jobs.delete(req.params.id);
      return;
    }
    job.listeners.add(send);
    const done = (frame) => { if (frame.type === "completed" || frame.type === "error") res.end(); };
    job.listeners.add(done);
    req.on("close", () => { job.listeners.delete(send); job.listeners.delete(done); });
    return;
  }

  // Not on this instance — serve from the DB stage (delete-on-read).
  let staged = await readStagedJob(req.params.id);
  if (!staged) { await sleep(300); staged = await readStagedJob(req.params.id); }
  if (!staged) { res.status(404).json({ error: "Job not found" }); return; }
  if (staged.user_id !== req.auth.userId) { res.status(403).json({ error: "Forbidden" }); return; }
  sseHead();
  for (const frame of (Array.isArray(staged.frames) ? staged.frames : [])) send(frame);
  res.end();
  adminSupabase
    .from("chat_ui_jobs")
    .delete()
    .eq("job_id", req.params.id)
    .then(({ error }) => { if (error) console.error("[jobs] DB drain-delete failed:", error.message); });
}
