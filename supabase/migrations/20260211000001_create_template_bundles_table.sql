-- Create template_bundles table
-- This table tracks pairs of front and back templates as a single bundle

CREATE TABLE IF NOT EXISTS template_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_front_id UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  template_back_id UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  is_universal BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX idx_template_bundles_organization_id ON template_bundles(organization_id);
CREATE INDEX idx_template_bundles_front_id ON template_bundles(template_front_id);
CREATE INDEX idx_template_bundles_back_id ON template_bundles(template_back_id);
CREATE INDEX idx_template_bundles_is_universal ON template_bundles(is_universal);

-- Enable RLS
ALTER TABLE template_bundles ENABLE ROW LEVEL SECURITY;

-- Policy: Service role has full access (for Edge Functions)
CREATE POLICY "Service role has full access to template bundles"
  ON template_bundles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Authenticated users can view bundles in their organization or universal bundles
CREATE POLICY "Users can view bundles in their organization or universal"
  ON template_bundles
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
    OR is_universal = true
  );

-- Trigger to update updated_at timestamp
CREATE TRIGGER update_template_bundles_updated_at
  BEFORE UPDATE ON template_bundles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comment
COMMENT ON TABLE template_bundles IS 'Tracks pairs of front and back templates as bundles';
COMMENT ON COLUMN template_bundles.template_front_id IS 'Reference to the front template';
COMMENT ON COLUMN template_bundles.template_back_id IS 'Reference to the back template';
COMMENT ON COLUMN template_bundles.organization_id IS 'Organization that owns this bundle (NULL for universal bundles)';
COMMENT ON COLUMN template_bundles.is_universal IS 'Whether this bundle is available to all organizations';
