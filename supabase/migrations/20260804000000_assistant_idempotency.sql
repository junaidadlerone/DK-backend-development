-- Durable create-once for the assistant (D6 follow-up, 2026-08-04).
--
-- WHY. Reported live: two campaigns were created from identical arguments — same name, template,
-- disclaimer and QR url — in one conversation, minutes apart, both from a "proceed" approval. The user
-- then saw two audience builders, which was the correct rendering of an incorrect state.
--
-- D6 already keys creates on (user, tool, canonicalized args) and it did not help, for a reason that was
-- written down when it shipped: the record lived in PROCESS MEMORY with a 120-second window. That cannot
-- span a user pausing to look at what they just made, and it does not survive a Cloud Run instance
-- change either — and the MCP is stateless per request by design.
--
-- WHY A LONGER WINDOW IS SAFE HERE. The key is the EXACT canonicalized arguments. Two creates that agree
-- on every field are a repeat, not a second thing the user wants: nobody deliberately makes two
-- campaigns with the same name, template, disclaimer and QR link. And the suppressed call returns the
-- FIRST result, so the agent can tell the user what already exists. If they genuinely want another, they
-- change something — a different name is a different key — which is a better conversation than silently
-- creating two.
--
-- Deliberately NOT session-scoped: the same request repeated in a new conversation is still a repeat.
--
-- WHAT THIS TABLE HOLDS: a hash of the arguments (never the arguments), and the tool result that was
-- returned, so a duplicate can be answered with the same ids rather than new ones. Service-role only.

create table if not exists public.assistant_idempotency (
  -- sha256 of (user id | tool | canonicalized args). The arguments themselves are never stored.
  key         text primary key,
  user_id     uuid not null,
  tool        text not null,
  -- The successful result, replayed verbatim so a duplicate answers with the SAME entity.
  result      jsonb not null,
  created_at  timestamptz not null default now()
);

comment on table public.assistant_idempotency is
  'Create-once records for assistant write tools. Key is a hash of (user, tool, canonicalized args); the arguments are never stored. Written and read only by the dk-assistant-mcp service role.';

-- Reads are always by primary key; this index serves the expiry sweep below.
create index if not exists assistant_idempotency_created_idx
  on public.assistant_idempotency (created_at);

alter table public.assistant_idempotency enable row level security;

-- No policies at all: the service role bypasses RLS, and nothing else has any business here. Stated
-- explicitly because an RLS-enabled table with no policy is easy to mistake for an oversight.
revoke all on public.assistant_idempotency from anon, authenticated;

-- Housekeeping. Records older than the suppression window are useless; keeping them would grow the
-- table forever and slightly widen the odds of a stale suppression after a schema or pricing change.
-- Called by the MCP opportunistically rather than on a cron, so there is nothing extra to operate.
create or replace function public.prune_assistant_idempotency(older_than interval default interval '48 hours')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.assistant_idempotency where created_at < now() - older_than;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.prune_assistant_idempotency(interval) from anon, authenticated;
