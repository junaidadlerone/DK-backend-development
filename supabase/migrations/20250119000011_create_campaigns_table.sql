-- Create Campaigns table
CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  referral_id uuid REFERENCES referrals(id) ON DELETE CASCADE,
  status jsonb DEFAULT '{"id": null, "name": "Draft"}'::jsonb,
  current_step integer DEFAULT 0,

  -- Step 2: Template selection
  template_id text,

  -- Step 3: Offer details
  offer_data jsonb DEFAULT '{}'::jsonb,

  -- Step 4: Business details and images
  business_data jsonb DEFAULT '{}'::jsonb,

  -- Step 5 & 6: To be added later
  additional_data jsonb DEFAULT '{}'::jsonb,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for faster queries
CREATE INDEX idx_campaigns_organization_id ON campaigns(organization_id);
CREATE INDEX idx_campaigns_referral_id ON campaigns(referral_id);
CREATE INDEX idx_campaigns_status ON campaigns USING gin ((status));
CREATE INDEX idx_campaigns_created_at ON campaigns(created_at DESC);

-- Enable RLS
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything (for edge functions)
CREATE POLICY "Service role can manage all campaigns"
  ON campaigns
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Users can view campaigns in their organization
CREATE POLICY "Users can view campaigns in their organization"
  ON campaigns
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

-- Add comment
COMMENT ON TABLE campaigns IS 'Campaigns table storing multi-step campaign creation data linked to referrals and organizations';
COMMENT ON COLUMN campaigns.current_step IS 'Current step in campaign creation process (0-6)';
COMMENT ON COLUMN campaigns.template_id IS 'PostGrid template ID selected in step 2';
COMMENT ON COLUMN campaigns.offer_data IS 'Offer details from step 3: offer_headline, offer_description, start_date, end_date, cta_text, disclaimer_text';
COMMENT ON COLUMN campaigns.business_data IS 'Business details from step 4: business_name, phone, website, qr_url, before_image_url, after_image_url';
