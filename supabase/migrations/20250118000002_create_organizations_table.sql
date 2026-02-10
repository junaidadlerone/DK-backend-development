-- Create Organizations table
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name text,
  registration_number text,
  industry text,
  business_address text,
  business_email text,
  phone_number text,
  website_url text,
  organization_members jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(owner_id)
);

-- Create index on owner_id for faster lookups
CREATE INDEX idx_organizations_owner_id ON organizations(owner_id);

-- Create GIN index on organization_members for faster JSONB queries
CREATE INDEX idx_organizations_members ON organizations USING GIN (organization_members);

-- Enable RLS
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own organization (as owner)
CREATE POLICY "Users can view own organization as owner"
  ON organizations
  FOR SELECT
  USING (auth.uid() = owner_id);

-- Policy: Users can view organization they are a member of
CREATE POLICY "Users can view organization as member"
  ON organizations
  FOR SELECT
  USING (
    organization_members @> jsonb_build_array(
      jsonb_build_object('member_uid', auth.uid()::text)
    )
  );

-- Policy: Owners can update their own organization
CREATE POLICY "Owners can update own organization"
  ON organizations
  FOR UPDATE
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- Policy: Service role can insert organizations (for signUp function)
CREATE POLICY "Service role can insert organizations"
  ON organizations
  FOR INSERT
  WITH CHECK (true);

-- Policy: Service role can update organizations (for createUser function)
CREATE POLICY "Service role can update organizations"
  ON organizations
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Add trigger to update updated_at timestamp
CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comment
COMMENT ON TABLE organizations IS 'Stores organization information with owner and members';
