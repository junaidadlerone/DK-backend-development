-- DK+ assistant (Tier 3.5) — per-MESSAGE response feedback (thumbs up/down on an assistant
-- reply), replacing the per-session ReviewPrompt in the chat. One row per (message, user);
-- re-rating upserts in place and toggling a rating off deletes the row. `comment` is the
-- optional free-text a user can add on a thumbs-down.
--
-- Writes go through the dk-assistant-chat gateway's /feedback route (service role, after
-- verifying the caller owns the session); the SELECT policy lets a user read back their own
-- ratings (getChatHistory also returns them as my_rating per assistant message).

create table if not exists public.chat_message_feedback (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  rating     text not null check (rating in ('up', 'down')),
  comment    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_id, user_id)                   -- one rating per user per message; re-rate → upsert
);

create index if not exists chat_message_feedback_session_idx
  on public.chat_message_feedback (session_id);

alter table public.chat_message_feedback enable row level security;

drop policy if exists "chat_message_feedback: users can read own feedback" on public.chat_message_feedback;
create policy "chat_message_feedback: users can read own feedback"
  on public.chat_message_feedback
  for select
  to authenticated
  using (user_id = auth.uid());
