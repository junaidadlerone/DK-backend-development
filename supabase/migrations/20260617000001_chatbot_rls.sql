-- Enable RLS on all chatbot tables
-- Edge Functions use the service role client which bypasses RLS.
-- These policies protect direct DB access (e.g. Supabase dashboard, client-side calls).

alter table knowledge_chunks  enable row level security;
alter table chat_sessions      enable row level security;
alter table chat_messages      enable row level security;
alter table reviews            enable row level security;

-- ─── knowledge_chunks ────────────────────────────────────────────────────────
-- Any authenticated user may read the knowledge base (it's app-wide content).
-- Writes are service-role only (embed script) — no client policy needed.

create policy "knowledge_chunks: authenticated users can read"
  on knowledge_chunks
  for select
  to authenticated
  using (true);

-- ─── chat_sessions ───────────────────────────────────────────────────────────
-- Users may only see and update sessions they own.
-- INSERT is handled by the service role Edge Function.

create policy "chat_sessions: users can read own sessions"
  on chat_sessions
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "chat_sessions: users can update own sessions"
  on chat_sessions
  for update
  to authenticated
  using (user_id = auth.uid());

-- ─── chat_messages ───────────────────────────────────────────────────────────
-- Users may only read messages that belong to their own sessions.
-- INSERT is handled by the service role Edge Function.

create policy "chat_messages: users can read own messages"
  on chat_messages
  for select
  to authenticated
  using (
    session_id in (
      select id from chat_sessions where user_id = auth.uid()
    )
  );

-- ─── reviews ─────────────────────────────────────────────────────────────────
-- Users may read their own reviews and insert new ones.
-- INSERT via the submitReview Edge Function (service role) also bypasses this,
-- but the policy below allows direct client inserts as a fallback.

create policy "reviews: users can read own reviews"
  on reviews
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "reviews: users can insert own reviews"
  on reviews
  for insert
  to authenticated
  with check (user_id = auth.uid());
