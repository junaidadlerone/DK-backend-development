-- Create launch_ready_campaign_data table
CREATE TABLE IF NOT EXISTS launch_ready_campaign_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  zone_id UUID NOT NULL REFERENCES location_zones(id) ON DELETE CASCADE,
  validated_addresses INTEGER NOT NULL DEFAULT 0,
  final_cost NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  amount_per_postcard NUMERIC(10, 2) NOT NULL DEFAULT 3.00,
  verified_addresses JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add launch_ready_id column to campaigns table
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS launch_ready_id UUID REFERENCES launch_ready_campaign_data(id) ON DELETE SET NULL;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_launch_ready_campaign_data_campaign_id ON launch_ready_campaign_data(campaign_id);
CREATE INDEX IF NOT EXISTS idx_launch_ready_campaign_data_zone_id ON launch_ready_campaign_data(zone_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_launch_ready_id ON campaigns(launch_ready_id);

-- Add comments
COMMENT ON TABLE launch_ready_campaign_data IS 'Stores campaign launch data including verified addresses and cost calculations';
COMMENT ON COLUMN launch_ready_campaign_data.validated_addresses IS 'Number of addresses that were successfully validated';
COMMENT ON COLUMN launch_ready_campaign_data.final_cost IS 'Total cost calculated as validated_addresses * amount_per_postcard';
COMMENT ON COLUMN launch_ready_campaign_data.amount_per_postcard IS 'Cost per postcard (default: 3.00)';
COMMENT ON COLUMN launch_ready_campaign_data.verified_addresses IS 'Array of verified address objects';
COMMENT ON COLUMN campaigns.launch_ready_id IS 'Reference to launch_ready_campaign_data for this campaign';

-- Enable RLS
ALTER TABLE launch_ready_campaign_data ENABLE ROW LEVEL SECURITY;

-- RLS Policies for launch_ready_campaign_data
-- Policy for authenticated users to view data for their organization's campaigns
CREATE POLICY "Users can view launch data for their organization campaigns"
  ON launch_ready_campaign_data
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM campaigns c
      JOIN organizations o ON c.organization_id = o.id
      WHERE c.id = launch_ready_campaign_data.campaign_id
      AND (
        o.owner_id = auth.uid()
        OR o.organization_members @> jsonb_build_array(jsonb_build_object('member_uid', auth.uid()::text))
      )
    )
  );

-- Policy for ADMIN/MARKETER users to insert/update launch data
CREATE POLICY "ADMIN/MARKETER can manage launch data for their organization"
  ON launch_ready_campaign_data
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM campaigns c
      JOIN organizations o ON c.organization_id = o.id
      WHERE c.id = launch_ready_campaign_data.campaign_id
      AND (
        o.owner_id = auth.uid()
        OR (
          o.organization_members @> jsonb_build_array(jsonb_build_object('member_uid', auth.uid()::text))
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(o.organization_members) AS member
            WHERE member->>'member_uid' = auth.uid()::text
            AND member->>'member_role' IN ('ADMIN', 'MARKETER')
          )
        )
      )
    )
  );

-- Policy to allow public read access (for the getCampaignLaunchData API)
CREATE POLICY "Public can view launch data"
  ON launch_ready_campaign_data
  FOR SELECT
  USING (true);
