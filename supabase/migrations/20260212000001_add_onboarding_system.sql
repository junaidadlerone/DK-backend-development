-- Add onboarding field to users table
ALTER TABLE profiles
ADD COLUMN onboarding BOOLEAN DEFAULT false;

-- Create onboarding table
CREATE TABLE IF NOT EXISTS onboarding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  business_name TEXT,
  business_industry TEXT,
  business_phone_number TEXT,
  website_url TEXT,
  country TEXT,
  street_address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  company_logo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX idx_onboarding_organization_id ON onboarding(organization_id);

-- Enable RLS
ALTER TABLE onboarding ENABLE ROW LEVEL SECURITY;

-- Policy: Service role has full access (for Edge Functions)
CREATE POLICY "Service role has full access to onboarding"
  ON onboarding
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Authenticated users can view onboarding for their organization
CREATE POLICY "Users can view onboarding for their organization"
  ON onboarding
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT id FROM organizations
      WHERE owner_id = auth.uid()
      OR auth.uid()::text = ANY(
        SELECT jsonb_array_elements_text(organization_members->'member_uid')
      )
    )
  );

-- Policy: Authenticated users can update onboarding for their organization
CREATE POLICY "Users can update onboarding for their organization"
  ON onboarding
  FOR UPDATE
  TO authenticated
  USING (
    organization_id IN (
      SELECT id FROM organizations
      WHERE owner_id = auth.uid()
      OR auth.uid()::text = ANY(
        SELECT jsonb_array_elements_text(organization_members->'member_uid')
      )
    )
  );

-- Policy: Authenticated users can insert onboarding for their organization
CREATE POLICY "Users can insert onboarding for their organization"
  ON onboarding
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT id FROM organizations
      WHERE owner_id = auth.uid()
    )
  );

-- Trigger to update updated_at timestamp
CREATE TRIGGER update_onboarding_updated_at
  BEFORE UPDATE ON onboarding
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comments
COMMENT ON TABLE onboarding IS 'Stores business onboarding information for organizations';
COMMENT ON COLUMN onboarding.organization_id IS 'Reference to the organization';
COMMENT ON COLUMN onboarding.business_name IS 'Name of the business';
COMMENT ON COLUMN onboarding.business_industry IS 'Industry/sector of the business';
COMMENT ON COLUMN onboarding.business_phone_number IS 'Business contact phone number';
COMMENT ON COLUMN onboarding.website_url IS 'Business website URL';
COMMENT ON COLUMN onboarding.company_logo IS 'URL or path to company logo';
COMMENT ON COLUMN profiles.onboarding IS 'Whether user has completed onboarding';
