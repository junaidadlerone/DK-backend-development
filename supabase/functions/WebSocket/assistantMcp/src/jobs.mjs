// Job buffer — the emit_ui side channel.
// MCP tool results are request/response, so a (possibly large) UI frame can't ride back
// through Flowise without re-entering the model's context. emit_ui buffers the validated
// frame in a job instead and returns a tiny {ok, ui_job_id} ack; the gateway then pulls the
// buffered frame from GET /jobs/:id/events and forwards it onto the chat SSE as {type:"ui"}.
// (Ported from namiMcp jobs.mjs minus the WS pump — Phase 2 has no long-running tools.)
import { randomUUID } from "node:crypto";

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

export function jobComplete(job, result) {
  job.status = "completed";
  job.result = result;
  jobEmit(job, { type: "completed", result });
}

export function jobFail(job, message) {
  job.status = "error";
  jobEmit(job, { type: "error", message });
}

export function getJob(id) { return jobs.get(id); }

// GC old jobs
setInterval(() => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, j] of jobs) if (j.status !== "running" && j.createdAt < cutoff) jobs.delete(id);
}, 60_000).unref();

// Express handler: GET /jobs/:id/events — SSE stream (replay + live). Owner-only.
export function jobEventsHandler(req, res) {
  const job = jobs.get(req.params.id);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.userId !== req.auth.userId) { res.status(403).json({ error: "Forbidden" }); return; }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  const send = (frame) => res.write(`data: ${JSON.stringify(frame)}\n\n`);

  for (const frame of job.events) send(frame); // replay
  if (job.status !== "running") { res.end(); return; }

  job.listeners.add(send);
  const done = (frame) => { if (frame.type === "completed" || frame.type === "error") res.end(); };
  job.listeners.add(done);
  req.on("close", () => { job.listeners.delete(send); job.listeners.delete(done); });
}
