-- Snapshot of work item state at each briefing run.
-- Midday compares to morning; dayend compares to morning for full-day delta.
CREATE TABLE IF NOT EXISTS daily_briefing_snapshots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  snapshot_date  DATE        NOT NULL,
  briefing_type  TEXT        NOT NULL CHECK (briefing_type IN ('morning','midday','dayend')),
  items          JSONB       NOT NULL,
  UNIQUE (snapshot_date, briefing_type)
);

-- One row per day written by dayend; powers the trend line shown in evening briefings.
CREATE TABLE IF NOT EXISTS daily_progress_log (
  log_date        DATE PRIMARY KEY,
  total_active    INT,
  total_shipped   INT,
  total_uat       INT,
  total_in_dev    INT,
  total_blocked   INT,
  completion_pct  NUMERIC(5,2),
  velocity        INT,
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Enable pg_net for pg_cron → Edge Function HTTP calls (safe no-op if already enabled)
CREATE EXTENSION IF NOT EXISTS pg_net;
