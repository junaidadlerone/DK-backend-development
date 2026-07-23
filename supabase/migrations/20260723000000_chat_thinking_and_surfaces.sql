-- DK+ assistant (Tier 3.5) — persist chat "thinking" labels + GenUI surfaces in the DB, so a
-- reloaded conversation renders faithfully across browsers/devices. Replaces the frontend-only
-- localStorage cache (messageExtras), which only survived on the same browser profile.
-- Ported from the Kabuki/Nami reference migration 20260722000000_chat_thinking_and_surfaces.sql.
--
--  1. chat_messages.thinking — ordered array of the progress labels shown during that
--     assistant turn (null on user rows / turns with none).
--  2. chat_surfaces — one row per GenUI surface (a {type:"ui",…} card). Keyed by
--     (session_id, surface_id) so re-emitting the same surface_id REPLACES it in place,
--     matching the gateway's GenUI semantics. `interaction` is null until the user acts on the
--     card; the gateway sets it when the click's surface_id arrives on the next /chat POST, so
--     reload shows the resolved/locked state instead of a fresh actionable card.
--
-- All writes are service-role (the dk-assistant-chat gateway); the SELECT policy mirrors
-- chat_messages (owner via session).

alter table public.chat_messages add column if not exists thinking jsonb;

create table if not exists public.chat_surfaces (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.chat_sessions(id) on delete cascade,
  message_id  uuid references public.chat_messages(id) on delete set null,  -- null for a pause-turn approval card (no assistant row yet)
  surface_id  text not null,                     -- the GenUI surface id (stable per surface)
  frame       jsonb not null,                    -- the cleaned {type:"ui", surface_id, root, components, data_model} frame as sent to the browser
  interaction jsonb,                             -- null until resolved: { resolved, button_id?, action?, prompt?, display?, resolved_at }
  seq         integer,                           -- emit order within a turn (stable ordering when created_at ties)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (session_id, surface_id)                -- re-emit → upsert/replace in place
);

create index if not exists chat_surfaces_session_idx on public.chat_surfaces (session_id, created_at);

alter table public.chat_surfaces enable row level security;

drop policy if exists "chat_surfaces: users can read surfaces in own sessions" on public.chat_surfaces;
create policy "chat_surfaces: users can read surfaces in own sessions"
  on public.chat_surfaces
  for select
  to authenticated
  using (
    session_id in (
      select id from public.chat_sessions where user_id = auth.uid()
    )
  );
