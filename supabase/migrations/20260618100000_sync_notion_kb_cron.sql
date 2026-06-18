-- Hourly cron job: sync Notion KB → Supabase pgvector
-- Calls the syncNotionKB Edge Function every hour at :00
-- pg_cron and pg_net are enabled by default on all Supabase projects

SELECT cron.schedule(
  'sync-notion-kb',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url          := 'https://xnflihspegizweqidvow.supabase.co/functions/v1/syncNotionKB',
    headers      := jsonb_build_object(
                      'Content-Type',  'application/json',
                      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuZmxpaHNwZWdpendlcWlkdm93Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkyNjQ0MiwiZXhwIjoyMDg2NTAyNDQyfQ.aXgRvCDrqSJhlEF-bOoCaATVdBz6ctromOKm8x04FJ0'
                    ),
    body         := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
