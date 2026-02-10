-- Add organization_id to referrals table
ALTER TABLE referrals ADD COLUMN organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;

-- Create index for organization-based queries
CREATE INDEX idx_referrals_organization_id ON referrals(organization_id);

-- Update RLS policies to be organization-based
DROP POLICY IF EXISTS "Authenticated users can view referrals" ON referrals;

CREATE POLICY "Users can view referrals in their organization"
  ON referrals
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
COMMENT ON COLUMN referrals.organization_id IS 'Organization that owns this referral';
