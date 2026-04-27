-- Template Audit Reports Table
-- Stores the results of universal template audits against PostGrid,
-- including an AI-generated summary of any detected issues.

DROP TABLE IF EXISTS template_audit_reports CASCADE;

CREATE TABLE template_audit_reports (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at        timestamptz NOT NULL DEFAULT now(),

  -- High-level counts for quick querying / dashboards
  total                   integer NOT NULL DEFAULT 0,
  active                  integer NOT NULL DEFAULT 0,
  deleted_from_postgrid   integer NOT NULL DEFAULT 0,
  deleted_in_db_only      integer NOT NULL DEFAULT 0,
  deleted_everywhere      integer NOT NULL DEFAULT 0,
  check_errors            integer NOT NULL DEFAULT 0,

  -- Full per-template breakdown
  report_data   jsonb       NOT NULL DEFAULT '[]'::jsonb,

  -- AI-generated plain-English summary of the findings
  openai_summary text,

  created_at    timestamptz DEFAULT now()
);

COMMENT ON TABLE template_audit_reports IS
  'Stores periodic audit results comparing universal templates in the DB against PostGrid.';

COMMENT ON COLUMN template_audit_reports.deleted_from_postgrid IS
  'Templates that exist in the DB (not soft-deleted) but are absent on PostGrid.';
COMMENT ON COLUMN template_audit_reports.deleted_in_db_only IS
  'Templates soft-deleted in the DB that are still present on PostGrid.';
COMMENT ON COLUMN template_audit_reports.deleted_everywhere IS
  'Templates soft-deleted in the DB AND absent on PostGrid.';
COMMENT ON COLUMN template_audit_reports.report_data IS
  'Full per-template audit entries as a JSON array.';
COMMENT ON COLUMN template_audit_reports.openai_summary IS
  'AI-generated summary of the audit findings, populated only when issues are detected.';

-- Index for date-range queries on audit history
CREATE INDEX idx_template_audit_reports_run_at ON template_audit_reports(run_at DESC);

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE template_audit_reports ENABLE ROW LEVEL SECURITY;

-- Service role: full access (used by the auditUniversalTemplates edge function)
CREATE POLICY "Service role has full access to template audit reports"
  ON template_audit_reports
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ADMIN: read all audit reports
CREATE POLICY "Admins can view all template audit reports"
  ON template_audit_reports
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role = 'ADMIN'
    )
  );
