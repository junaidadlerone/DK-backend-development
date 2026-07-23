-- DK+ assistant (Tier 3.5) — DB staging for the emit_ui job side-channel.
--
-- Previously the MCP buffered a tool's GenUI frames in a per-process in-memory Map and the
-- gateway fetched them via GET /jobs/:id/events. With more than one Cloud Run instance the GET
-- can land on an instance that never saw the job → 404 → the card silently never renders.
-- This table makes the side-channel stateless across instances: the MCP writes the frames here
-- (service role) when emit_ui runs, and the /jobs read serves from the DB (delete-on-read),
-- with the old in-memory Map kept as a same-instance fast path.
--
-- Rows are transient (seconds of life): deleted when drained, and swept opportunistically on
-- write when older than an hour. No user-facing reads — service-role only, so RLS is enabled
-- with no policies (deny-all to clients).

create table if not exists public.chat_ui_jobs (
  job_id     uuid primary key,
  user_id    uuid not null,          -- owner (from the MCP call's JWT); /jobs read re-checks it
  frames     jsonb not null,         -- array of validated {type:"ui",…} frames buffered by emit_ui
  created_at timestamptz not null default now()
);

create index if not exists chat_ui_jobs_created_idx on public.chat_ui_jobs (created_at);

alter table public.chat_ui_jobs enable row level security;
