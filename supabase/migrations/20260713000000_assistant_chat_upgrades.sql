-- DoorKnocker+ AI assistant (Tier 1) — chat schema upgrades.
-- Fills the gaps vs the Kabuki reference schema found during the dk-assistant-chat E2E:
--  1. touch_chat_session trigger (updated_at never moved on message insert — verified missing)
--  2. get_chat_sessions RPC (richer session list: last-message preview + updated_at ordering;
--     used by the upgraded getChatSessions edge function; coexists with the legacy
--     get_user_chat_sessions helper until that function is retired)
--  3. title backfill (the old chat function never wrote chat_sessions.title — the legacy
--     helper computed it at read time; persist it so title-column readers see the same value)
--  4. drop the duplicate (session_id, created_at) index on chat_messages
-- RLS is already in place (20260617000001_chatbot_rls.sql) — no policy changes needed;
-- writes go through service-role edge functions / the dk-assistant-chat Cloud Run service.

-- ── 1. Trigger: keep chat_sessions.updated_at current when a message lands ────
CREATE OR REPLACE FUNCTION public.touch_chat_session()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.chat_sessions SET updated_at = now() WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_chat_message_insert ON public.chat_messages;
CREATE TRIGGER on_chat_message_insert
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_chat_session();

-- ── 2. RPC: sessions with last-message preview (single query, no N+1) ─────────
CREATE OR REPLACE FUNCTION public.get_chat_sessions(p_user_id UUID)
RETURNS TABLE (
  id              UUID,
  title           TEXT,
  last_message    TEXT,
  last_role       TEXT,
  message_count   BIGINT,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    cs.id,
    cs.title,
    last_msg.content  AS last_message,
    last_msg.role     AS last_role,
    COALESCE(cnt.n, 0) AS message_count,
    cs.created_at,
    cs.updated_at
  FROM public.chat_sessions cs
  LEFT JOIN LATERAL (
    SELECT content, role
    FROM public.chat_messages
    WHERE session_id = cs.id AND role IN ('user', 'assistant')
    ORDER BY created_at DESC
    LIMIT 1
  ) last_msg ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS n
    FROM public.chat_messages
    WHERE session_id = cs.id AND role IN ('user', 'assistant')
  ) cnt ON true
  WHERE cs.user_id = p_user_id
  ORDER BY cs.updated_at DESC NULLS LAST;
$$;

-- ── 3. Backfill titles for pre-existing sessions (old chat never wrote them) ──
-- Mirrors the legacy get_user_chat_sessions computation: first user message, 60 chars.
-- (Correlated subquery — an UPDATE's FROM/LATERAL cannot reference the update target.)
UPDATE public.chat_sessions cs
SET title = LEFT((
  SELECT content
  FROM public.chat_messages
  WHERE session_id = cs.id AND role = 'user'
  ORDER BY created_at ASC
  LIMIT 1
), 60)
WHERE cs.title IS NULL
  AND EXISTS (
    SELECT 1 FROM public.chat_messages
    WHERE session_id = cs.id AND role = 'user'
  );

-- ── 4. Drop the duplicate index (identical twin of ..._session_id_created_at_idx) ──
DROP INDEX IF EXISTS public.chat_messages_session_idx;
