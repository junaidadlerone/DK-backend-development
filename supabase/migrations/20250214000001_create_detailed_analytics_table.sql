-- Create detailed_analytics table for caching getAnalyticsPageData responses
CREATE TABLE IF NOT EXISTS detailed_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  analytics_type VARCHAR(50) NOT NULL DEFAULT 'OVERVIEW',
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  start_date DATE,
  end_date DATE,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_detailed_analytics_org_type ON detailed_analytics(organization_id, analytics_type);
CREATE INDEX IF NOT EXISTS idx_detailed_analytics_campaign ON detailed_analytics(campaign_id);
CREATE INDEX IF NOT EXISTS idx_detailed_analytics_dates ON detailed_analytics(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_detailed_analytics_updated_at ON detailed_analytics(updated_at);

-- Add composite index for cache lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_detailed_analytics_cache_key
  ON detailed_analytics(organization_id, analytics_type, COALESCE(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(start_date, '1900-01-01'::date), COALESCE(end_date, '1900-01-01'::date));

-- Add comments
COMMENT ON TABLE detailed_analytics IS 'Caches detailed analytics data for getAnalyticsPageData API';
COMMENT ON COLUMN detailed_analytics.analytics_type IS 'Type of analytics (e.g., OVERVIEW)';
COMMENT ON COLUMN detailed_analytics.campaign_id IS 'Optional campaign_id for single campaign analytics';
COMMENT ON COLUMN detailed_analytics.start_date IS 'Optional start date for date range filtering';
COMMENT ON COLUMN detailed_analytics.end_date IS 'Optional end date for date range filtering';
COMMENT ON COLUMN detailed_analytics.data IS 'Cached analytics data as JSONB';

-- Enable RLS
ALTER TABLE detailed_analytics ENABLE ROW LEVEL SECURITY;

-- RLS Policy for viewing cached analytics
CREATE POLICY "Users can view analytics for their organization"
  ON detailed_analytics
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = detailed_analytics.organization_id
      AND (
        o.owner_id = auth.uid()
        OR o.organization_members @> jsonb_build_array(jsonb_build_object('member_uid', auth.uid()::text))
      )
    )
  );

-- RLS Policy for inserting/updating cached analytics
CREATE POLICY "System can manage analytics cache"
  ON detailed_analytics
  FOR ALL
  USING (true)
  WITH CHECK (true);
