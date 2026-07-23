-- DK+ assistant (Tier 3.5) — record which files a user's chat turn attached, so a reloaded
-- conversation shows the attachment chips (cross-browser).
-- Ported from the Kabuki/Nami reference migration 20260722120000_chat_message_attachment.sql,
-- with one DK+ adaptation: composer attachments are HELD IN THE BROWSER (they never pass
-- through the assistant and are only consumed client-side by uploader cards), so there is no
-- file id/url to store — this column keeps the lightweight marker metadata only, as an array:
--   [{ "name": "spring.csv", "kind": "csv", "size": 18234 }, …]
-- Written by the dk-assistant-chat gateway (service role) on the user's chat_messages row;
-- read back by getChatHistory.
alter table public.chat_messages add column if not exists attachment jsonb;
