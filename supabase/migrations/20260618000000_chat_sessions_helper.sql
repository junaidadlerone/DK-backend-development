-- Helper function to list a user's chat sessions with title + message count
-- Used by the getChatSessions Edge Function for the conversation history UI

CREATE OR REPLACE FUNCTION get_user_chat_sessions(p_user_id uuid)
RETURNS TABLE (
  id            uuid,
  created_at    timestamptz,
  title         text,
  message_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    cs.id,
    cs.created_at,
    LEFT(
      COALESCE(
        (
          SELECT content
          FROM chat_messages
          WHERE session_id = cs.id AND role = 'user'
          ORDER BY created_at ASC
          LIMIT 1
        ),
        'New conversation'
      ),
      60
    ) AS title,
    (
      SELECT COUNT(*)
      FROM chat_messages
      WHERE session_id = cs.id
    ) AS message_count
  FROM chat_sessions cs
  WHERE cs.user_id = p_user_id
  ORDER BY cs.created_at DESC
  LIMIT 20;
$$;
