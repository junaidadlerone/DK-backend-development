-- Migration: Create campaign_csv_address_lists table and link to campaigns
-- Date: 2026-04-09

-- 1. Create the campaign_csv_address_lists table
CREATE TABLE IF NOT EXISTS campaign_csv_address_lists (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
    list_name text NOT NULL,
    original_filename text,
    addresses jsonb DEFAULT '[]'::jsonb,
    operation_history jsonb DEFAULT '[]'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 2. Add csv_address_list_id to campaigns table
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS csv_address_list_id uuid REFERENCES campaign_csv_address_lists(id) ON DELETE SET NULL;

-- 2.1 Add csv_address_list_id to launch_ready_campaign_data table
ALTER TABLE launch_ready_campaign_data ADD COLUMN IF NOT EXISTS csv_address_list_id uuid REFERENCES campaign_csv_address_lists(id) ON DELETE SET NULL;

-- 3. Create indexes
CREATE INDEX IF NOT EXISTS idx_campaign_csv_address_lists_organization_id ON campaign_csv_address_lists(organization_id);
CREATE INDEX IF NOT EXISTS idx_campaign_csv_address_lists_campaign_id ON campaign_csv_address_lists(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_csv_address_list_id ON campaigns(csv_address_list_id);
CREATE INDEX IF NOT EXISTS idx_launch_ready_campaign_data_csv_address_list_id ON launch_ready_campaign_data(csv_address_list_id);

-- 4. Enable RLS
ALTER TABLE campaign_csv_address_lists ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for campaign_csv_address_lists

-- Service role can do everything
CREATE POLICY "Service role can manage address lists"
  ON campaign_csv_address_lists
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users select policy
CREATE POLICY "Users can view address lists in their organization"
  ON campaign_csv_address_lists
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT id FROM organizations
      WHERE owner_id = auth.uid()
      OR auth.uid() = ANY(
        SELECT jsonb_array_elements_text(organization_members)::uuid
      )
    )
  );

-- Authenticated users insert policy
CREATE POLICY "Users can create address lists in their organization"
  ON campaign_csv_address_lists
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT id FROM organizations
      WHERE owner_id = auth.uid()
      OR auth.uid() = ANY(
        SELECT jsonb_array_elements_text(organization_members)::uuid
      )
    )
  );

-- Authenticated users update policy
CREATE POLICY "Users can update address lists in their organization"
  ON campaign_csv_address_lists
  FOR UPDATE
  TO authenticated
  USING (
    organization_id IN (
      SELECT id FROM organizations
      WHERE owner_id = auth.uid()
      OR auth.uid() = ANY(
        SELECT jsonb_array_elements_text(organization_members)::uuid
      )
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT id FROM organizations
      WHERE owner_id = auth.uid()
      OR auth.uid() = ANY(
        SELECT jsonb_array_elements_text(organization_members)::uuid
      )
    )
  );

-- 6. Add Comments
COMMENT ON TABLE campaign_csv_address_lists IS 'Stores CSV-imported address lists for file-based campaign targeting';
COMMENT ON COLUMN campaigns.csv_address_list_id IS 'Link to the CSV-imported address list used for this campaign';
