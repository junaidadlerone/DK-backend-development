-- Add metrics columns to campaigns table
ALTER TABLE campaigns ADD COLUMN postcards_sent integer DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN scan_rate decimal(5,2) DEFAULT 0.00;
ALTER TABLE campaigns ADD COLUMN leads_gen integer DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN total_spent decimal(10,2) DEFAULT 0.00;
ALTER TABLE campaigns ADD COLUMN roi decimal(10,2) DEFAULT 0.00;

-- Add comments
COMMENT ON COLUMN campaigns.postcards_sent IS 'Number of postcards sent in this campaign';
COMMENT ON COLUMN campaigns.scan_rate IS 'QR code scan rate percentage';
COMMENT ON COLUMN campaigns.leads_gen IS 'Number of leads generated';
COMMENT ON COLUMN campaigns.total_spent IS 'Total amount spent on campaign';
COMMENT ON COLUMN campaigns.roi IS 'Return on investment percentage';

-- Create Campaign History table
CREATE TABLE IF NOT EXISTS campaign_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  user_name text NOT NULL,
  action text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for faster lookups
CREATE INDEX idx_campaign_history_campaign_id ON campaign_history(campaign_id);
CREATE INDEX idx_campaign_history_user_id ON campaign_history(user_id);
CREATE INDEX idx_campaign_history_created_at ON campaign_history(created_at DESC);

-- Enable RLS
ALTER TABLE campaign_history ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything (for edge functions)
CREATE POLICY "Service role can manage all campaign history"
  ON campaign_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Users can view campaign history in their organization
CREATE POLICY "Users can view campaign history in their organization"
  ON campaign_history
  FOR SELECT
  TO authenticated
  USING (
    campaign_id IN (
      SELECT id FROM campaigns
      WHERE organization_id IN (
        SELECT id FROM organizations
        WHERE owner_id = auth.uid()
        OR auth.uid() = ANY(
          SELECT jsonb_array_elements_text(organization_members)::uuid
        )
      )
    )
  );

-- Add comment
COMMENT ON TABLE campaign_history IS 'Campaign history table logging all campaign actions';
